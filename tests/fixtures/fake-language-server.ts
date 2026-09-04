import { setTimeout } from "node:timers/promises";

import { createMessageConnection, IPCMessageReader, IPCMessageWriter } from "vscode-jsonrpc/node";

interface OpenDocumentParams {
  textDocument: {
    uri: string;
    text: string;
  };
}

interface FakeRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

interface FakeDiagnostic {
  range: FakeRange;
  severity: number;
  code: string;
  message: string;
}

const messageReader = new IPCMessageReader(process);

const messageWriter = new IPCMessageWriter(process);

const connection = createMessageConnection(messageReader, messageWriter);

const serverState = { shutdown: false };

function createRange(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
): FakeRange {
  const start = { line: startLine, character: startCharacter };

  const end = { line: endLine, character: endCharacter };

  return { start, end };
}

function createDiagnostic(
  range: FakeRange,
  severity: number,
  code: string,
  message: string,
): FakeDiagnostic {
  return { range, severity, code, message };
}

function projectForDocument(uri: string): object | null {
  const hasNoProject = uri.includes("no-project");

  if (hasNoProject) {
    return null;
  }

  return { version: "4.0.0" };
}

function exitCode(): number {
  if (serverState.shutdown) {
    return 0;
  }

  return 1;
}

connection.onRequest((method, params: unknown) => {
  if (method === "initialize") {
    const capabilities = {};

    return { capabilities };
  }

  if (method === "@/tailwindCSS/getProject") {
    const document = params as { uri: string };

    const project = projectForDocument(document.uri);

    return project;
  }

  if (method === "shutdown") {
    serverState.shutdown = true;
  }

  return null;
});

const notifyServerReady = async (): Promise<void> => {
  await connection.sendNotification("@/tailwindCSS/serverReady");
};

connection.onNotification("initialized", notifyServerReady);

connection.onNotification("textDocument/didOpen", async (params: OpenDocumentParams) => {
  const { uri, text } = params.textDocument;

  const hasNoProject = uri.includes("no-project");

  if (hasNoProject) {
    await connection.sendNotification("@/tailwindCSS/documentReady", { uri });

    return;
  }

  const diagnostics: FakeDiagnostic[] = [];

  const hasError = text.includes("ERROR");

  if (hasError) {
    const errorRange = createRange(0, 1, 0, 6);

    const error = createDiagnostic(
      errorRange,
      1,
      "invalidTailwindDirective",
      "Invalid Tailwind directive.",
    );

    diagnostics.push(error);
  }

  const hasWarning = text.includes("WARNING");

  if (hasWarning) {
    const warningRange = createRange(1, 2, 1, 9);

    const warning = createDiagnostic(
      warningRange,
      2,
      "cssConflict",
      "Conflicting Tailwind classes.",
    );

    diagnostics.push(warning);
  }

  const isSlow = text.includes("SLOW");

  if (isSlow) {
    await connection.sendNotification("@/tailwindCSS/documentReady", { uri });

    await setTimeout(50);

    await connection.sendNotification("textDocument/publishDiagnostics", {
      uri,
      diagnostics,
    });

    return;
  }

  await connection.sendNotification("textDocument/publishDiagnostics", {
    uri,
    diagnostics,
  });

  await connection.sendNotification("@/tailwindCSS/documentReady", { uri });
});

connection.onNotification("exit", () => {
  connection.dispose();

  const code = exitCode();

  process.exit(code);
});

connection.listen();
