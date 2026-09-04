import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { lintFiles } from "../src/language-server.js";

import type { Options } from "../src/types.js";

test("waits for every language-server document without using Tailwind", async (context) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "headwind-language-server-"));
  context.after(() => rm(cwd, { recursive: true, force: true }));

  const fastPath = path.join(cwd, "fast.html");
  const slowPath = path.join(cwd, "slow.html");
  const noProjectPath = path.join(cwd, "no-project.html");
  await Promise.all([
    writeFile(fastPath, "WARNING"),
    writeFile(slowPath, "SLOW ERROR"),
    writeFile(noProjectPath, "ERROR"),
  ]);

  const fakeServer = fileURLToPath(new URL("./fixtures/fake-language-server.js", import.meta.url));
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

  assert.deepEqual(
    results.map((result) => [path.basename(result.path), result.diagnostics[0]?.code]),
    [
      ["fast.html", "cssConflict"],
      ["slow.html", "invalidTailwindDirective"],
      ["no-project.html", undefined],
    ],
  );
});
