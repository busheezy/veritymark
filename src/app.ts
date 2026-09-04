import { access } from "node:fs/promises";

import { glob } from "tinyglobby";

import { help, parseArguments } from "./arguments.js";
import { countDiagnostics, formatJson, formatStylish } from "./formatter.js";
import { lintFiles } from "./language-server.js";
import { version } from "./version.js";

import type { FileDiagnostics, Options } from "./types.js";

const ignoredPatterns = [
  "**/.git/**",
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/.svelte-kit/**",
];

export interface CliOutput {
  log: (message: string) => void;
  error: (message: string) => void;
}

export interface CliDependencies {
  lintFiles: (files: string[], options: Options) => Promise<FileDiagnostics[]>;
}

const defaultLog = console.log;

const defaultError = console.error;

const defaultOutput: CliOutput = { log: defaultLog, error: defaultError };

const defaultDependencies: CliDependencies = { lintFiles };

function isErrorDiagnostic(diagnostic: FileDiagnostics["diagnostics"][number]): boolean {
  return (diagnostic.severity ?? 1) === 1;
}

function filterQuietResult(result: FileDiagnostics): FileDiagnostics {
  const diagnostics = result.diagnostics.filter(isErrorDiagnostic);

  return { ...result, diagnostics };
}

function filterQuietResults(results: FileDiagnostics[], quiet: boolean): FileDiagnostics[] {
  if (!quiet) {
    return results;
  }

  const quietResults = results.map(filterQuietResult);

  return quietResults;
}

function formatResults(results: FileDiagnostics[], options: Options): string {
  if (options.format === "json") {
    const jsonReport = formatJson(results);

    return jsonReport;
  }

  const stylishReport = formatStylish(results, options.cwd, options.color);

  return stylishReport;
}

function resultExitCode(errors: number, tooManyWarnings: boolean): number {
  if (errors > 0 || tooManyWarnings) {
    return 1;
  }

  return 0;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  const message = String(error);

  return message;
}

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
    const error = new Error("Unable to parse command-line options.");

    throw error;
  }

  const cwd = options.cwd;

  const config = options.config;

  const patterns = options.patterns;

  await access(cwd);

  if (config) {
    await access(config);
  }

  const globOptions = {
    cwd,
    absolute: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    ignore: ignoredPatterns,
  };

  const files = await glob(patterns, globOptions);

  files.sort();

  if (files.length === 0) {
    const unmatchedPatterns = patterns.join(", ");

    const message = `No files matched: ${unmatchedPatterns}`;

    const error = new Error(message);

    throw error;
  }

  const lintResults = await dependencies.lintFiles(files, options);

  const results = filterQuietResults(lintResults, options.quiet);

  const report = formatResults(results, options);

  output.log(report);

  const { errors, warnings } = countDiagnostics(lintResults);

  const tooManyWarnings = options.maxWarnings >= 0 && warnings > options.maxWarnings;

  if (tooManyWarnings && options.format === "stylish") {
    const warningMessage = `Warning count ${warnings} exceeds --max-warnings ${options.maxWarnings}.`;

    output.log(warningMessage);
  }

  const exitCode = resultExitCode(errors, tooManyWarnings);

  return exitCode;
}

export async function executeCli(
  argv: string[],
  output: CliOutput = defaultOutput,
  dependencies: CliDependencies = defaultDependencies,
): Promise<number> {
  try {
    const exitCode = await runCli(argv, output, dependencies);

    return exitCode;
  } catch (error) {
    const message = errorMessage(error);

    const formattedError = `headwind: ${message}`;

    output.error(formattedError);

    return 2;
  }
}
