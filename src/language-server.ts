import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createMessageConnection, IPCMessageReader, IPCMessageWriter } from "vscode-jsonrpc/node";

import { version } from "./version.js";

import type { Diagnostic, FileDiagnostics, Options } from "./types.js";

interface ConfigurationParams {
  items: Array<{ section?: string }>;
}

interface PublishDiagnosticsParams {
  uri: string;
  diagnostics: Diagnostic[];
}

interface DocumentReadyParams {
  uri: string;
}

interface LogMessageParams {
  message: string;
}

interface DocumentState {
  path: string;
  diagnostics?: Diagnostic[];
  ready: boolean;
  projectChecked: boolean;
  resolve: (result: FileDiagnostics) => void;
  promise: Promise<FileDiagnostics>;
}

interface ServerRuntime {
  stderr: string;
  stopping: boolean;
}

interface VoidDeferred {
  promise: Promise<void>;
  resolve: () => void;
}

interface FailureDeferred {
  promise: Promise<never>;
  reject: (error: unknown) => void;
}

interface DocumentQueue {
  nextIndex: number;
}

type LanguageServerProcess = ReturnType<typeof spawn>;
type LanguageServerConnection = ReturnType<typeof createMessageConnection>;

interface LanguageServerSession {
  child: LanguageServerProcess;
  connection: LanguageServerConnection;
  states: Map<string, DocumentState>;
  runtime: ServerRuntime;
  serverReady: Promise<void>;
  serverFailure: Promise<never>;
}

const maximumDocumentOpenConcurrency = 1;

const languageIds: Record<string, string> = {
  ".astro": "astro",
  ".css": "css",
  ".erb": "erb",
  ".html": "html",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".php": "php",
  ".razor": "razor",
  ".rb": "ruby",
  ".svelte": "svelte",
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".vue": "vue",
};

function createDocumentState(filePath: string): DocumentState {
  const pendingDocumentResolve = (_result: FileDiagnostics): void => undefined;

  const completion = {
    resolve: pendingDocumentResolve,
  };

  const promise = new Promise<FileDiagnostics>((resolve) => {
    completion.resolve = resolve;
  });

  const resolve = completion.resolve;

  return {
    path: filePath,
    ready: false,
    projectChecked: false,
    resolve,
    promise,
  };
}

function createVoidDeferred(): VoidDeferred {
  const pendingResolve = (): void => undefined;

  const completion = {
    resolve: pendingResolve,
  };

  const promise = new Promise<void>((resolve) => {
    completion.resolve = resolve;
  });

  const resolve = completion.resolve;

  return { promise, resolve };
}

function createFailureDeferred(): FailureDeferred {
  const pendingReject = (_error: unknown): void => undefined;

  const completion = {
    reject: pendingReject,
  };

  const promise = new Promise<never>((_resolve, reject) => {
    completion.reject = reject;
  });

  const reject = completion.reject;

  return { promise, reject };
}

function completeDocument(state: DocumentState): void {
  if (!state.ready || !state.projectChecked || state.diagnostics === undefined) {
    return;
  }

  const path = state.path;

  const diagnostics = state.diagnostics;

  const result = { path, diagnostics };

  state.resolve(result);
}

function withTimeout<T>(
  promise: Promise<T>,
  timeout: number,
  message: string | (() => string),
): Promise<T> {
  const timedPromise = new Promise<T>((resolve, reject) => {
    const rejectForTimeout = (): void => {
      if (typeof message === "function") {
        const timeoutError = new Error(message());

        reject(timeoutError);

        return;
      }

      const timeoutError = new Error(message);

      reject(timeoutError);
    };

    const timer = setTimeout(rejectForTimeout, timeout);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

  return timedPromise;
}

function serverPath(): string {
  const require = createRequire(import.meta.url);

  const packagePath = require.resolve("@tailwindcss/language-server/package.json");

  const packageDirectory = path.dirname(packagePath);

  const executablePath = path.join(packageDirectory, "bin", "tailwindcss-language-server");

  return executablePath;
}

function tailwindConfiguration(options: Options): unknown {
  if (!options.config) {
    return { validate: true };
  }

  const configFile = path.relative(options.cwd, options.config);

  const experimental = { configFile };

  return {
    validate: true,
    experimental,
  };
}

function configuration(options: Options, section?: string): unknown {
  if (section === "editor") {
    return { tabSize: 2 };
  }

  if (section === "tailwindCSS") {
    const tailwind = tailwindConfiguration(options);

    return tailwind;
  }

  return null;
}

function appendServerError(runtime: ServerRuntime, message: string): void {
  const combinedError = `${runtime.stderr}${message}`;

  const recentError = combinedError.slice(-8000);

  runtime.stderr = recentError;
}

function appendServerLog(runtime: ServerRuntime, params: LogMessageParams): void {
  const logMessage = `\n${params.message}`;

  appendServerError(runtime, logMessage);
}

function unexpectedExitDetail(
  runtime: ServerRuntime,
  code: number | null,
  signal: NodeJS.Signals | null,
): string {
  const reportedError = runtime.stderr.trim();

  if (reportedError) {
    return reportedError;
  }

  return `exit code ${code ?? "unknown"}, signal ${signal ?? "none"}`;
}

function createServerFailure(child: LanguageServerProcess, runtime: ServerRuntime): Promise<never> {
  const serverFailure = new Promise<never>((_resolve, reject) => {
    child.once("error", reject);

    child.once("exit", (code, signal) => {
      if (runtime.stopping) {
        return;
      }

      const detail = unexpectedExitDetail(runtime, code, signal);

      const message = `Tailwind language server stopped unexpectedly: ${detail}`;

      const error = new Error(message);

      reject(error);
    });
  });

  return serverFailure;
}

function requireErrorStream(
  child: LanguageServerProcess,
): NonNullable<LanguageServerProcess["stderr"]> {
  const errorStream = child.stderr;

  if (errorStream) {
    return errorStream;
  }

  child.kill();

  const error = new Error("Unable to read errors from the Tailwind language server.");

  throw error;
}

function workspaceFolders(options: Options): Array<{ uri: string; name: string }> {
  const workspaceUrl = pathToFileURL(options.cwd);

  const uri = workspaceUrl.href;

  const name = path.basename(options.cwd);

  const workspaceFolder = { uri, name };

  return [workspaceFolder];
}

function registerRequestHandlers(connection: LanguageServerConnection, options: Options): void {
  connection.onRequest((method, params: unknown) => {
    if (method === "workspace/configuration") {
      const request = params as ConfigurationParams;

      const configuredItems = request.items.map((item) => {
        const configuredItem = configuration(options, item.section);

        return configuredItem;
      });

      return configuredItems;
    }

    if (method === "workspace/workspaceFolders") {
      const folders = workspaceFolders(options);

      return folders;
    }

    return null;
  });
}

function handlePublishedDiagnostics(
  states: Map<string, DocumentState>,
  params: PublishDiagnosticsParams,
): void {
  const state = states.get(params.uri);

  if (!state) {
    return;
  }

  state.diagnostics = params.diagnostics;

  completeDocument(state);
}

async function handleDocumentReady(
  connection: LanguageServerConnection,
  states: Map<string, DocumentState>,
  params: DocumentReadyParams,
): Promise<void> {
  const state = states.get(params.uri);

  if (!state) {
    return;
  }

  state.ready = true;

  const uri = params.uri;

  const project = await connection.sendRequest<unknown>("@/tailwindCSS/getProject", {
    uri,
  });

  state.projectChecked = true;

  if (project === null) {
    state.diagnostics = [];
  }

  completeDocument(state);
}

function registerNotificationHandlers(
  connection: LanguageServerConnection,
  states: Map<string, DocumentState>,
  runtime: ServerRuntime,
  serverReadyResolve: () => void,
  rejectServerFailure: (error: unknown) => void,
): void {
  const captureLog = (params: LogMessageParams): void => {
    appendServerLog(runtime, params);
  };

  connection.onNotification("window/logMessage", captureLog);

  connection.onNotification("window/showMessage", captureLog);

  connection.onNotification("@/tailwindCSS/warn", captureLog);

  connection.onNotification("@/tailwindCSS/serverReady", serverReadyResolve);

  const publishDiagnostics = (params: PublishDiagnosticsParams): void => {
    handlePublishedDiagnostics(states, params);
  };

  connection.onNotification("textDocument/publishDiagnostics", publishDiagnostics);

  const documentReady = async (params: DocumentReadyParams): Promise<void> => {
    try {
      await handleDocumentReady(connection, states, params);
    } catch (error) {
      rejectServerFailure(error);
    }
  };

  connection.onNotification("@/tailwindCSS/documentReady", documentReady);
}

function startLanguageServer(options: Options, executablePath: string): LanguageServerSession {
  const processArguments = [executablePath, "--node-ipc"];

  const cwd = options.cwd;

  const stdio: ["ignore", "ignore", "pipe", "ipc"] = ["ignore", "ignore", "pipe", "ipc"];

  const spawnOptions = { cwd, stdio };

  const child = spawn(process.execPath, processArguments, spawnOptions);

  const messageReader = new IPCMessageReader(child);

  const messageWriter = new IPCMessageWriter(child);

  const connection = createMessageConnection(messageReader, messageWriter);

  const errorStream = requireErrorStream(child);

  const states = new Map<string, DocumentState>();

  const runtime: ServerRuntime = { stderr: "", stopping: false };

  const serverReadyDeferred = createVoidDeferred();

  const handlerFailure = createFailureDeferred();

  const processFailure = createServerFailure(child, runtime);

  const failurePromises = [processFailure, handlerFailure.promise];

  const serverFailure = Promise.race(failurePromises);

  errorStream.setEncoding("utf8");

  const captureErrorChunk = (chunk: string): void => {
    appendServerError(runtime, chunk);
  };

  errorStream.on("data", captureErrorChunk);

  registerRequestHandlers(connection, options);

  registerNotificationHandlers(
    connection,
    states,
    runtime,
    serverReadyDeferred.resolve,
    handlerFailure.reject,
  );

  connection.listen();

  const serverReady = serverReadyDeferred.promise;

  return {
    child,
    connection,
    states,
    runtime,
    serverReady,
    serverFailure,
  };
}

function initializationParams(options: Options): object {
  const processId = process.pid;

  const rootPath = options.cwd;

  const rootUrl = pathToFileURL(options.cwd);

  const rootUri = rootUrl.href;

  const folders = workspaceFolders(options);

  const workspace = {
    configuration: true,
    workspaceFolders: true,
  };

  const codeAction = {};

  const codeLens = {};

  const colorProvider = {};

  const completion = {};

  const documentLink = {};

  const hover = {};

  const publishDiagnostics = {};

  const textDocument = {
    codeAction,
    codeLens,
    colorProvider,
    completion,
    documentLink,
    hover,
    publishDiagnostics,
  };

  const capabilities = { workspace, textDocument };

  const initializationOptions = { testMode: true };

  const clientInfo = { name: "veritymark", version };

  return {
    processId,
    rootPath,
    rootUri,
    workspaceFolders: folders,
    capabilities,
    initializationOptions,
    clientInfo,
  };
}

async function initializeLanguageServer(
  session: LanguageServerSession,
  options: Options,
): Promise<void> {
  const parameters = initializationParams(options);

  const initializationRequest = session.connection.sendRequest("initialize", parameters);

  const initialization = Promise.race([initializationRequest, session.serverFailure]);

  await withTimeout(
    initialization,
    options.timeout,
    "Timed out while initializing the Tailwind language server.",
  );

  await session.connection.sendNotification("initialized", {});

  const startup = Promise.race([session.serverReady, session.serverFailure]);

  await withTimeout(
    startup,
    options.timeout,
    "Timed out while the Tailwind language server was starting.",
  );
}

function languageId(filePath: string): string {
  const extension = path.extname(filePath);

  const normalizedExtension = extension.toLowerCase();

  const configuredLanguageId = languageIds[normalizedExtension];

  const resolvedLanguageId = configuredLanguageId ?? "html";

  return resolvedLanguageId;
}

async function openDocument(
  connection: LanguageServerConnection,
  states: Map<string, DocumentState>,
  filePath: string,
): Promise<DocumentState> {
  const fileUrl = pathToFileURL(filePath);

  const uri = fileUrl.href;

  const state = createDocumentState(filePath);

  states.set(uri, state);

  const text = await readFile(filePath, "utf8");

  const documentLanguageId = languageId(filePath);

  const textDocument = {
    uri,
    languageId: documentLanguageId,
    version: 1,
    text,
  };

  await connection.sendNotification("textDocument/didOpen", {
    textDocument,
  });

  return state;
}

async function openDocuments(session: LanguageServerSession, files: string[]): Promise<void> {
  const workerCount = Math.min(maximumDocumentOpenConcurrency, files.length);

  const nextIndex = 0;

  const queue = { nextIndex };

  const length = workerCount;

  const workerSlots = { length };

  const startWorker = (): Promise<void> => {
    const worker = openQueuedDocuments(session, files, queue);

    return worker;
  };

  const workers = Array.from(workerSlots, startWorker);

  const completion = Promise.all(workers);

  await completion;
}

async function openQueuedDocuments(
  session: LanguageServerSession,
  files: string[],
  queue: DocumentQueue,
): Promise<void> {
  while (queue.nextIndex < files.length) {
    const fileIndex = queue.nextIndex;

    queue.nextIndex++;

    const filePath = files[fileIndex];

    if (!filePath) {
      continue;
    }

    const state = await openDocument(session.connection, session.states, filePath);

    await Promise.race([state.promise, session.serverFailure]);
  }
}

function completionMessage(session: LanguageServerSession, files: string[], cwd: string): string {
  const pendingFiles = files.filter((filePath) => {
    const fileUrl = pathToFileURL(filePath);

    const state = session.states.get(fileUrl.href);

    return !state || !state.ready || !state.projectChecked || state.diagnostics === undefined;
  });

  const fileCount = pendingFiles.length;

  let noun = "files";

  if (fileCount === 1) {
    noun = "file";
  }

  const displayedFiles = pendingFiles.slice(0, 5).map((filePath) => path.relative(cwd, filePath));

  const remainingCount = fileCount - displayedFiles.length;

  let remaining = "";

  if (remainingCount > 0) {
    remaining = ` (+${remainingCount} more)`;
  }

  const paths = displayedFiles.join(", ");

  if (!paths) {
    return `Timed out waiting for ${fileCount} ${noun} to finish.`;
  }

  return `Timed out waiting for ${fileCount} ${noun} to finish: ${paths}${remaining}.`;
}

async function collectDiagnostics(
  session: LanguageServerSession,
  files: string[],
  timeout: number,
  cwd: string,
): Promise<FileDiagnostics[]> {
  const states = session.states.values();

  const documentPromises = Array.from(states, (state) => state.promise);

  const pending = Promise.all(documentPromises);

  const diagnostics = Promise.race([pending, session.serverFailure]);

  const timeoutMessage = (): string => completionMessage(session, files, cwd);

  const results = await withTimeout(diagnostics, timeout, timeoutMessage);

  return results;
}

async function stopLanguageServer(session: LanguageServerSession, timeout: number): Promise<void> {
  session.runtime.stopping = true;

  try {
    const shutdownTimeout = Math.min(timeout, 1000);

    const shutdownRequest = session.connection.sendRequest("shutdown");

    await withTimeout(
      shutdownRequest,
      shutdownTimeout,
      "Timed out while stopping the Tailwind language server.",
    );

    await session.connection.sendNotification("exit");
  } catch {
    session.child.kill();
  }

  session.connection.dispose();
}

export async function lintFiles(
  files: string[],
  options: Options,
  executablePath = serverPath(),
): Promise<FileDiagnostics[]> {
  const session = startLanguageServer(options, executablePath);

  try {
    await initializeLanguageServer(session, options);

    const openingDocuments = Promise.race([openDocuments(session, files), session.serverFailure]);

    const timeoutMessage = (): string => completionMessage(session, files, options.cwd);

    await withTimeout(openingDocuments, options.timeout, timeoutMessage);

    const results = await collectDiagnostics(session, files, options.timeout, options.cwd);

    return results;
  } finally {
    await stopLanguageServer(session, options.timeout);
  }
}
