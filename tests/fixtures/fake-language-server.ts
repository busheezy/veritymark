import { setTimeout } from "node:timers/promises";

import { createMessageConnection, IPCMessageReader, IPCMessageWriter } from "vscode-jsonrpc/node";

interface OpenDocumentParams {
  textDocument: {
    uri: string;
    text: string;
  };
}

const connection = createMessageConnection(
  new IPCMessageReader(process),
  new IPCMessageWriter(process),
);
let shutdown = false;

connection.onRequest((method, params: unknown) => {
  if (method === "initialize") {
    return { capabilities: {} };
  }

  if (method === "@/tailwindCSS/getProject") {
    const document = params as { uri: string };
    return document.uri.includes("no-project") ? null : { version: "4.0.0" };
  }

  if (method === "shutdown") {
    shutdown = true;
  }

  return null;
});

connection.onNotification("initialized", () =>
  connection.sendNotification("@/tailwindCSS/serverReady"),
);

connection.onNotification("textDocument/didOpen", async (params: OpenDocumentParams) => {
  const { uri, text } = params.textDocument;
  if (uri.includes("no-project")) {
    await connection.sendNotification("@/tailwindCSS/documentReady", { uri });
    return;
  }

  const diagnostics = [];
  if (text.includes("ERROR")) {
    diagnostics.push({
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 6 },
      },
      severity: 1,
      code: "invalidTailwindDirective",
      message: "Invalid Tailwind directive.",
    });
  }

  if (text.includes("WARNING")) {
    diagnostics.push({
      range: {
        start: { line: 1, character: 2 },
        end: { line: 1, character: 9 },
      },
      severity: 2,
      code: "cssConflict",
      message: "Conflicting Tailwind classes.",
    });
  }

  if (text.includes("SLOW")) {
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
  process.exit(shutdown ? 0 : 1);
});

connection.listen();
