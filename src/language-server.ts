import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createMessageConnection, IPCMessageReader, IPCMessageWriter } from "vscode-jsonrpc/node";

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
  let resolve = (_result: FileDiagnostics): void => undefined;
  const promise = new Promise<FileDiagnostics>((complete) => {
    resolve = complete;
  });

  return {
    path: filePath,
    ready: false,
    projectChecked: false,
    resolve,
    promise,
  };
}

function completeDocument(state: DocumentState): void {
  if (!state.ready || !state.projectChecked || state.diagnostics === undefined) {
    return;
  }

  state.resolve({ path: state.path, diagnostics: state.diagnostics });
}

function withTimeout<T>(promise: Promise<T>, timeout: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeout);
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
}

function serverPath(): string {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve("@tailwindcss/language-server/package.json");
  return path.join(path.dirname(packagePath), "bin", "tailwindcss-language-server");
}

function configuration(options: Options, section?: string): unknown {
  if (section === "editor") {
    return { tabSize: 2 };
  }

  if (section === "tailwindCSS") {
    return {
      validate: true,
      ...(options.config
        ? { experimental: { configFile: path.relative(options.cwd, options.config) } }
        : {}),
    };
  }

  return null;
}

export async function lintFiles(
  files: string[],
  options: Options,
  executablePath = serverPath(),
): Promise<FileDiagnostics[]> {
  const child = spawn(process.execPath, [executablePath, "--node-ipc"], {
    cwd: options.cwd,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const connection = createMessageConnection(
    new IPCMessageReader(child),
    new IPCMessageWriter(child),
  );
  const errorStream = child.stderr;
  if (!errorStream) {
    child.kill();
    throw new Error("Unable to read errors from the Tailwind language server.");
  }
  const states = new Map<string, DocumentState>();
  let stderr = "";
  let stopping = false;
  let serverReadyResolve = (): void => undefined;
  const serverReady = new Promise<void>((resolve) => {
    serverReadyResolve = resolve;
  });
  const serverFailure = new Promise<never>((_resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (!stopping) {
        const detail =
          stderr.trim() || `exit code ${code ?? "unknown"}, signal ${signal ?? "none"}`;
        reject(new Error(`Tailwind language server stopped unexpectedly: ${detail}`));
      }
    });
  });

  errorStream.setEncoding("utf8");
  errorStream.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-8000);
  });

  const captureLog = (params: LogMessageParams): void => {
    stderr = `${stderr}\n${params.message}`.slice(-8000);
  };

  connection.onRequest((method, params: unknown) => {
    if (method === "workspace/configuration") {
      const request = params as ConfigurationParams;
      return request.items.map((item) => configuration(options, item.section));
    }

    if (method === "workspace/workspaceFolders") {
      return [{ uri: pathToFileURL(options.cwd).href, name: path.basename(options.cwd) }];
    }

    return null;
  });
  connection.onNotification("window/logMessage", captureLog);
  connection.onNotification("window/showMessage", captureLog);
  connection.onNotification("@/tailwindCSS/warn", captureLog);
  connection.onNotification("@/tailwindCSS/serverReady", serverReadyResolve);
  connection.onNotification(
    "textDocument/publishDiagnostics",
    (params: PublishDiagnosticsParams) => {
      const state = states.get(params.uri);
      if (!state) {
        return;
      }

      state.diagnostics = params.diagnostics;
      completeDocument(state);
    },
  );
  connection.onNotification("@/tailwindCSS/documentReady", async (params: DocumentReadyParams) => {
    const state = states.get(params.uri);
    if (!state) {
      return;
    }

    state.ready = true;
    const project = await connection.sendRequest<unknown>("@/tailwindCSS/getProject", {
      uri: params.uri,
    });
    state.projectChecked = true;
    if (project === null) {
      state.diagnostics = [];
    }
    completeDocument(state);
  });
  connection.listen();

  try {
    const rootUri = pathToFileURL(options.cwd).href;
    await withTimeout(
      Promise.race([
        connection.sendRequest("initialize", {
          processId: process.pid,
          rootPath: options.cwd,
          rootUri,
          workspaceFolders: [{ uri: rootUri, name: path.basename(options.cwd) }],
          capabilities: {
            workspace: {
              configuration: true,
              workspaceFolders: true,
            },
            textDocument: {
              codeAction: {},
              codeLens: {},
              colorProvider: {},
              completion: {},
              documentLink: {},
              hover: {},
              publishDiagnostics: {},
            },
          },
          initializationOptions: { testMode: true },
          clientInfo: { name: "headwind", version: "0.1.0" },
        }),
        serverFailure,
      ]),
      options.timeout,
      "Timed out while initializing the Tailwind language server.",
    );
    await connection.sendNotification("initialized", {});
    await withTimeout(
      Promise.race([serverReady, serverFailure]),
      options.timeout,
      "Timed out while the Tailwind language server was starting.",
    );

    for (const filePath of files) {
      const uri = pathToFileURL(filePath).href;
      const state = createDocumentState(filePath);
      states.set(uri, state);
      const text = await readFile(filePath, "utf8");
      await connection.sendNotification("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId: languageIds[path.extname(filePath).toLowerCase()] ?? "html",
          version: 1,
          text,
        },
      });
    }

    const pending = Promise.all(Array.from(states.values(), (state) => state.promise));
    return await withTimeout(
      Promise.race([pending, serverFailure]),
      options.timeout,
      `Timed out waiting for ${files.length} ${files.length === 1 ? "file" : "files"} to finish.`,
    );
  } finally {
    stopping = true;
    try {
      await withTimeout(
        connection.sendRequest("shutdown"),
        Math.min(options.timeout, 1000),
        "Timed out while stopping the Tailwind language server.",
      );
      await connection.sendNotification("exit");
    } catch {
      child.kill();
    }
    connection.dispose();
  }
}
