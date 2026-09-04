import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { executeCli } from "../src/app.js";

import type { CliDependencies, CliOutput } from "../src/app.js";
import type { Diagnostic, FileDiagnostics } from "../src/types.js";

function diagnostic(severity: 1 | 2, code: string, message: string): Diagnostic {
  return {
    range: {
      start: { line: 0, character: 1 },
      end: { line: 0, character: 5 },
    },
    severity,
    code,
    message,
  };
}

function captureOutput(): {
  output: CliOutput;
  stdout: string[];
  stderr: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout,
    stderr,
    output: {
      log: (message) => stdout.push(message),
      error: (message) => stderr.push(message),
    },
  };
}

async function createFixture(context: test.TestContext, files: string[]): Promise<string> {
  const cwd = await mkdtemp(path.join(tmpdir(), "headwind-cli-"));
  context.after(() => rm(cwd, { recursive: true, force: true }));
  await Promise.all(files.map((file) => writeFile(path.join(cwd, file), "fixture")));
  return cwd;
}

test("waits for linting to finish and prints one aggregated report", async (context) => {
  const cwd = await createFixture(context, ["b.html", "a.html"]);
  const captured = captureOutput();
  let finish = (_results: FileDiagnostics[]): void => undefined;
  let markStarted = (): void => undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const dependencies: CliDependencies = {
    lintFiles: () =>
      new Promise((resolve) => {
        finish = resolve;
        markStarted();
      }),
  };

  const execution = executeCli(
    ["--cwd", cwd, "--no-color", "*.html"],
    captured.output,
    dependencies,
  );
  await started;
  assert.deepEqual(captured.stdout, []);

  finish([
    {
      path: path.join(cwd, "a.html"),
      diagnostics: [diagnostic(2, "cssConflict", "Conflicting classes.")],
    },
    {
      path: path.join(cwd, "b.html"),
      diagnostics: [diagnostic(1, "invalidApply", "Invalid apply.")],
    },
  ]);

  assert.equal(await execution, 1);
  assert.equal(captured.stdout.length, 1);
  assert.match(captured.stdout[0] ?? "", /a\.html[\s\S]*b\.html/);
  assert.match(captured.stdout[0] ?? "", /2 problems \(1 error, 1 warning\)/);
  assert.deepEqual(captured.stderr, []);
});

test("applies warning limits and quiet mode", async (context) => {
  const cwd = await createFixture(context, ["index.html"]);
  const result: FileDiagnostics = {
    path: path.join(cwd, "index.html"),
    diagnostics: [diagnostic(2, "cssConflict", "Conflicting classes.")],
  };
  const dependencies: CliDependencies = {
    lintFiles: async () => [result],
  };

  const limited = captureOutput();
  const limitedCode = await executeCli(
    ["--cwd", cwd, "--no-color", "--max-warnings", "0", "index.html"],
    limited.output,
    dependencies,
  );
  assert.equal(limitedCode, 1);
  assert.match(limited.stdout.join("\n"), /exceeds --max-warnings 0/);

  const quiet = captureOutput();
  const quietCode = await executeCli(
    ["--cwd", cwd, "--no-color", "--quiet", "index.html"],
    quiet.output,
    dependencies,
  );
  assert.equal(quietCode, 0);
  assert.match(quiet.stdout[0] ?? "", /No Tailwind CSS problems found/);
  assert.doesNotMatch(quiet.stdout[0] ?? "", /Conflicting classes/);
});

test("emits machine-readable JSON", async (context) => {
  const cwd = await createFixture(context, ["index.html"]);
  const captured = captureOutput();
  const dependencies: CliDependencies = {
    lintFiles: async () => [
      {
        path: path.join(cwd, "index.html"),
        diagnostics: [diagnostic(1, "invalidApply", "Invalid apply.")],
      },
    ],
  };

  const code = await executeCli(
    ["--cwd", cwd, "--format", "json", "index.html"],
    captured.output,
    dependencies,
  );
  const report = JSON.parse(captured.stdout[0] ?? "[]") as Array<{
    errorCount: number;
    messages: Array<{ ruleId: string; line: number; column: number }>;
  }>;

  assert.equal(code, 1);
  assert.equal(report[0]?.errorCount, 1);
  assert.deepEqual(report[0]?.messages[0], {
    ruleId: "invalidApply",
    severity: 1,
    message: "Invalid apply.",
    line: 1,
    column: 2,
    endLine: 1,
    endColumn: 6,
  });
});

test("returns a runtime exit code when no files match", async (context) => {
  const cwd = await createFixture(context, []);
  const captured = captureOutput();
  const dependencies: CliDependencies = {
    lintFiles: async () => {
      throw new Error("Linting should not run.");
    },
  };

  const code = await executeCli(
    ["--cwd", cwd, "--no-color", "*.html"],
    captured.output,
    dependencies,
  );

  assert.equal(code, 2);
  assert.deepEqual(captured.stdout, []);
  assert.match(captured.stderr[0] ?? "", /No files matched/);
});
