import { parseArgs } from "node:util";
import path from "node:path";

import { z } from "zod";

import type { Options } from "./types.js";

const defaultPattern = "**/*.{html,css,js,jsx,ts,tsx,vue,svelte,astro,php,rb,erb,razor}";

const formatNames = ["stylish", "json"] as const;

const formatSchemaDefinition = z.enum(formatNames);

const numberSchema = z.number();

const integerSchema = numberSchema.int();

const maxWarningsSchemaDefinition = integerSchema.min(-1);

const timeoutSchemaDefinition = integerSchema.min(1);

const strictCompilation = true;

const compilationOptions = { strict: strictCompilation } as const;

const formatSchema = z.compile(formatSchemaDefinition, compilationOptions);

const maxWarningsSchema = z.compile(maxWarningsSchemaDefinition, compilationOptions);

const timeoutSchema = z.compile(timeoutSchemaDefinition, compilationOptions);

const configArgument = { type: "string" } as const;

const cwdArgument = { type: "string" } as const;

const formatArgument = { type: "string", default: "stylish" } as const;

const maxWarningsArgument = { type: "string", default: "-1" } as const;

const quietArgument = { type: "boolean", default: false } as const;

const timeoutArgument = { type: "string", default: "30000" } as const;

const defaultColor = process.stdout.isTTY;

const colorArgument = { type: "boolean", default: defaultColor } as const;

const helpArgument = { type: "boolean", short: "h", default: false } as const;

const versionArgument = { type: "boolean", short: "v", default: false } as const;

const argumentOptions = {
  config: configArgument,
  cwd: cwdArgument,
  format: formatArgument,
  "max-warnings": maxWarningsArgument,
  quiet: quietArgument,
  timeout: timeoutArgument,
  color: colorArgument,
  help: helpArgument,
  version: versionArgument,
} as const;

export const help = `headwind [options] [patterns...]

Lint Tailwind CSS classes with the official Tailwind language server.

Options:
  --config <path>         Tailwind config or CSS entrypoint
  --cwd <path>            Working directory (default: current directory)
  --format <name>         Output format: stylish or json (default: stylish)
  --max-warnings <count>  Exit with an error above this warning count
  --quiet                 Report errors only
  --timeout <ms>          Language server timeout (default: 30000)
  --no-color              Disable colored output
  --help                  Show help
  --version               Show version

Exit codes:
  0  No errors and warning limit not exceeded
  1  Lint errors or too many warnings
  2  Configuration or runtime error`;

export interface ParsedArguments {
  options?: Options;
  help: boolean;
  version: boolean;
}

function parseFormat(value: string): Options["format"] {
  const result = formatSchema.safeParse(value);

  if (!result.success) {
    const error = new Error("--format must be either stylish or json.");

    throw error;
  }

  return result.data;
}

function parseMaxWarnings(value: string): number {
  const numericValue = Number(value);

  const result = maxWarningsSchema.safeParse(numericValue);

  if (!result.success) {
    const error = new Error("--max-warnings must be an integer greater than or equal to -1.");

    throw error;
  }

  return result.data;
}

function parseTimeout(value: string): number {
  const numericValue = Number(value);

  const result = timeoutSchema.safeParse(numericValue);

  if (!result.success) {
    const error = new Error("--timeout must be an integer greater than or equal to 1.");

    throw error;
  }

  return result.data;
}

function resolveConfig(cwd: string, config: string | undefined): string | undefined {
  if (!config) {
    return undefined;
  }

  const resolvedConfig = path.resolve(cwd, config);

  return resolvedConfig;
}

function resolvePatterns(positionals: string[]): string[] {
  if (positionals.length === 0) {
    return [defaultPattern];
  }

  return positionals;
}

function configOption(config: string | undefined): Pick<Options, "config"> {
  if (!config) {
    return {};
  }

  return { config };
}

export function parseArguments(argv: string[]): ParsedArguments {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    allowNegative: true,
    strict: true,
    options: argumentOptions,
  });

  if (parsed.values.help || parsed.values.version) {
    const help = parsed.values.help;

    const version = parsed.values.version;

    return {
      help,
      version,
    };
  }

  const processCwd = process.cwd();

  const requestedCwd = parsed.values.cwd ?? processCwd;

  const cwd = path.resolve(requestedCwd);

  const config = resolveConfig(cwd, parsed.values.config);

  const patterns = resolvePatterns(parsed.positionals);

  const format = parseFormat(parsed.values.format);

  const maxWarnings = parseMaxWarnings(parsed.values["max-warnings"]);

  const timeout = parseTimeout(parsed.values.timeout);

  const configProperties = configOption(config);

  const quiet = parsed.values.quiet;

  const color = parsed.values.color;

  const options: Options = {
    cwd,
    patterns,
    ...configProperties,
    format,
    quiet,
    color,
    maxWarnings,
    timeout,
  };

  return {
    help: false,
    version: false,
    options,
  };
}
