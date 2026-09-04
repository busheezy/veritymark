import { parseArgs } from "node:util";
import path from "node:path";

import type { Options } from "./types.js";

const defaultPattern = "**/*.{html,css,js,jsx,ts,tsx,vue,svelte,astro,php,rb,erb,razor}";

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

function parseInteger(value: string, name: string, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`);
  }

  return parsed;
}

export function parseArguments(argv: string[]): ParsedArguments {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    allowNegative: true,
    strict: true,
    options: {
      config: { type: "string" },
      cwd: { type: "string" },
      format: { type: "string", default: "stylish" },
      "max-warnings": { type: "string", default: "-1" },
      quiet: { type: "boolean", default: false },
      timeout: { type: "string", default: "30000" },
      color: { type: "boolean", default: process.stdout.isTTY },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });

  if (parsed.values.help || parsed.values.version) {
    return {
      help: parsed.values.help,
      version: parsed.values.version,
    };
  }

  if (parsed.values.format !== "stylish" && parsed.values.format !== "json") {
    throw new Error("--format must be either stylish or json.");
  }

  const cwd = path.resolve(parsed.values.cwd ?? process.cwd());
  const config = parsed.values.config ? path.resolve(cwd, parsed.values.config) : undefined;

  return {
    help: false,
    version: false,
    options: {
      cwd,
      patterns: parsed.positionals.length > 0 ? parsed.positionals : [defaultPattern],
      ...(config ? { config } : {}),
      format: parsed.values.format,
      quiet: parsed.values.quiet,
      color: parsed.values.color,
      maxWarnings: parseInteger(parsed.values["max-warnings"], "--max-warnings", -1),
      timeout: parseInteger(parsed.values.timeout, "--timeout", 1),
    },
  };
}
