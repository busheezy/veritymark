import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { executeCli } from "../src/app.js";

import type { CliDependencies, CliOutput } from "../src/app.js";
import type { Diagnostic, FileDiagnostics } from "../src/types.js";

function diagnostic(severity: 1 | 2, code: string, message: string): Diagnostic {
  const start = { line: 0, character: 1 };

  const end = { line: 0, character: 5 };

  const range = { start, end };

  return {
    range,
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

  const log = (message: string): void => {
    stdout.push(message);
  };

  const error = (message: string): void => {
    stderr.push(message);
  };

  const output = { log, error };

  return {
    stdout,
    stderr,
    output,
  };
}

function dependenciesReturning(results: FileDiagnostics[]): CliDependencies {
  const lintFiles = async (): Promise<FileDiagnostics[]> => results;

  return { lintFiles };
}

function fileDiagnostics(filePath: string, diagnostics: Diagnostic[]): FileDiagnostics {
  return { path: filePath, diagnostics };
}

async function writeFixtureFile(cwd: string, file: string): Promise<void> {
  const filePath = path.join(cwd, file);

  await writeFile(filePath, "fixture");
}

async function createFixture(context: test.TestContext, files: string[]): Promise<string> {
  const temporaryDirectory = tmpdir();

  const fixturePrefix = path.join(temporaryDirectory, "headwind-cli-");

  const cwd = await mkdtemp(fixturePrefix);

  const cleanupOptions = { recursive: true, force: true };

  const cleanup = async (): Promise<void> => {
    await rm(cwd, cleanupOptions);
  };

  context.after(cleanup);

  const writeFixture = (file: string): Promise<void> => {
    const pendingFile = writeFixtureFile(cwd, file);

    return pendingFile;
  };

  const pendingFiles = files.map(writeFixture);

  await Promise.all(pendingFiles);

  return cwd;
}

test("waits for linting to finish and prints one aggregated report", async (context) => {
  const cwd = await createFixture(context, ["b.html", "a.html"]);

  const captured = captureOutput();

  const finish = (_results: FileDiagnostics[]): void => undefined;

  const markStarted = (): void => undefined;

  const controls = {
    finish,
    markStarted,
  };

  const started = new Promise<void>((resolve) => {
    controls.markStarted = resolve;
  });

  const lintFiles = (): Promise<FileDiagnostics[]> => {
    const results = new Promise<FileDiagnostics[]>((resolve) => {
      controls.finish = resolve;
      controls.markStarted();
    });

    return results;
  };

  const dependencies = { lintFiles };

  const execution = executeCli(
    ["--cwd", cwd, "--no-color", "*.html"],
    captured.output,
    dependencies,
  );

  await started;

  assert.deepEqual(captured.stdout, []);

  const warningPath = path.join(cwd, "a.html");

  const warning = diagnostic(2, "cssConflict", "Conflicting classes.");

  const warningResult = fileDiagnostics(warningPath, [warning]);

  const errorPath = path.join(cwd, "b.html");

  const error = diagnostic(1, "invalidApply", "Invalid apply.");

  const errorResult = fileDiagnostics(errorPath, [error]);

  const results = [warningResult, errorResult];

  controls.finish(results);

  assert.equal(await execution, 1);

  assert.equal(captured.stdout.length, 1);

  assert.match(captured.stdout[0] ?? "", /a\.html[\s\S]*b\.html/);

  assert.match(captured.stdout[0] ?? "", /2 problems \(1 error, 1 warning\)/);

  assert.deepEqual(captured.stderr, []);
});

test("applies warning limits and quiet mode", async (context) => {
  const cwd = await createFixture(context, ["index.html"]);

  const filePath = path.join(cwd, "index.html");

  const warning = diagnostic(2, "cssConflict", "Conflicting classes.");

  const result = fileDiagnostics(filePath, [warning]);

  const dependencies = dependenciesReturning([result]);

  const limited = captureOutput();

  const limitedCode = await executeCli(
    ["--cwd", cwd, "--no-color", "--max-warnings", "0", "index.html"],
    limited.output,
    dependencies,
  );

  assert.equal(limitedCode, 1);

  const limitedOutput = limited.stdout.join("\n");

  assert.match(limitedOutput, /exceeds --max-warnings 0/);

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

  const filePath = path.join(cwd, "index.html");

  const error = diagnostic(1, "invalidApply", "Invalid apply.");

  const result = fileDiagnostics(filePath, [error]);

  const dependencies = dependenciesReturning([result]);

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

  const lintFiles = async (): Promise<FileDiagnostics[]> => {
    const error = new Error("Linting should not run.");

    throw error;
  };

  const dependencies = { lintFiles };

  const code = await executeCli(
    ["--cwd", cwd, "--no-color", "*.html"],
    captured.output,
    dependencies,
  );

  assert.equal(code, 2);

  assert.deepEqual(captured.stdout, []);

  assert.match(captured.stderr[0] ?? "", /No files matched/);
});
