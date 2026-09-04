import { access } from "node:fs/promises";

import { glob } from "tinyglobby";

import { help, parseArguments } from "./arguments.js";
import { countDiagnostics, formatJson, formatStylish } from "./formatter.js";
import { lintFiles } from "./language-server.js";

import type { FileDiagnostics, Options } from "./types.js";

const version = "0.1.0";

export interface CliOutput {
  log: (message: string) => void;
  error: (message: string) => void;
}

export interface CliDependencies {
  lintFiles: (files: string[], options: Options) => Promise<FileDiagnostics[]>;
}

const defaultOutput: CliOutput = {
  log: console.log,
  error: console.error,
};

const defaultDependencies: CliDependencies = { lintFiles };

async function runCli(
  argv: string[],
  output: CliOutput,
  dependencies: CliDependencies,
): Promise<number> {
  const parsed = parseArguments(argv);
  if (parsed.help) {
    output.log(help);
    return 0;
  }

  if (parsed.version) {
    output.log(version);
    return 0;
  }

  const options = parsed.options;
  if (!options) {
    throw new Error("Unable to parse command-line options.");
  }

  await access(options.cwd);
  if (options.config) {
    await access(options.config);
  }

  const files = await glob(options.patterns, {
    cwd: options.cwd,
    absolute: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: [
      "**/.git/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/.svelte-kit/**",
    ],
  });
  files.sort();

  if (files.length === 0) {
    throw new Error(`No files matched: ${options.patterns.join(", ")}`);
  }

  let results = await dependencies.lintFiles(files, options);
  if (options.quiet) {
    results = results.map((result) => ({
      ...result,
      diagnostics: result.diagnostics.filter((diagnostic) => (diagnostic.severity ?? 1) === 1),
    }));
  }

  output.log(
    options.format === "json"
      ? formatJson(results)
      : formatStylish(results, options.cwd, options.color),
  );

  const { errors, warnings } = countDiagnostics(results);
  const tooManyWarnings = options.maxWarnings >= 0 && warnings > options.maxWarnings;
  if (tooManyWarnings && options.format === "stylish") {
    output.log(`Warning count ${warnings} exceeds --max-warnings ${options.maxWarnings}.`);
  }

  return errors > 0 || tooManyWarnings ? 1 : 0;
}

export async function executeCli(
  argv: string[],
  output: CliOutput = defaultOutput,
  dependencies: CliDependencies = defaultDependencies,
): Promise<number> {
  try {
    return await runCli(argv, output, dependencies);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    output.error(`headwind: ${message}`);
    return 2;
  }
}
