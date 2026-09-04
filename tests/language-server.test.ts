import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { lintFiles } from "../src/language-server.js";

import type { Options } from "../src/types.js";

test("waits for every language-server document without using Tailwind", async (context) => {
  const temporaryDirectory = tmpdir();

  const fixturePrefix = path.join(temporaryDirectory, "veritymark-language-server-");

  const cwd = await mkdtemp(fixturePrefix);

  const cleanupOptions = { recursive: true, force: true };

  const cleanup = async (): Promise<void> => {
    await rm(cwd, cleanupOptions);
  };

  context.after(cleanup);

  const fastPath = path.join(cwd, "fast.html");

  const slowPath = path.join(cwd, "slow.html");

  const noProjectPath = path.join(cwd, "no-project.html");

  const fastFile = writeFile(fastPath, "WARNING");

  const slowFile = writeFile(slowPath, "SLOW ERROR");

  const noProjectFile = writeFile(noProjectPath, "ERROR");

  const fixtureFiles = [fastFile, slowFile, noProjectFile];

  await Promise.all(fixtureFiles);

  const fakeServerUrl = new URL("./fixtures/fake-language-server.js", import.meta.url);

  const fakeServer = fileURLToPath(fakeServerUrl);

  const options: Options = {
    cwd,
    patterns: ["*.html"],
    format: "stylish",
    quiet: false,
    color: false,
    maxWarnings: -1,
    timeout: 2000,
  };

  const results = await lintFiles([fastPath, slowPath, noProjectPath], options, fakeServer);

  const summarizedResults = results.map((result) => {
    const fileName = path.basename(result.path);

    const diagnosticCode = result.diagnostics[0]?.code;

    return [fileName, diagnosticCode];
  });

  assert.deepEqual(summarizedResults, [
    ["fast.html", "cssConflict"],
    ["slow.html", "invalidTailwindDirective"],
    ["no-project.html", undefined],
  ]);
});
