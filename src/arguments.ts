import path from "node:path";

import { Command } from "commander";
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

const exitCodeHelp = `Exit codes:
  0  No errors and warning limit not exceeded
  1  Lint errors or too many warnings
  2  Configuration or runtime error`;

interface CliFlags {
  config?: string;
  cwd?: string;
  format: Options["format"];
  maxWarnings: number;
  quiet?: boolean;
  timeout: number;
  color: boolean;
  help?: boolean;
  version?: boolean;
}

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

function ignoreParserOutput(): void {}

function createCommand(): Command {
  const command = new Command();

  command.name("veritymark");
  command.description("Lint Tailwind CSS classes with the official Tailwind language server.");
  command.usage("[options] [patterns...]");
  command.argument("[patterns...]");
  command.helpOption(false);
  command.exitOverride();

  command.option("--config <path>", "Tailwind config or CSS entrypoint");
  command.option("--cwd <path>", "Working directory");
  command.option("--format <name>", "Output format: stylish or json", parseFormat, "stylish");
  command.option(
    "--max-warnings <count>",
    "Exit with an error above this warning count",
    parseMaxWarnings,
    -1,
  );
  command.option("--quiet", "Report errors only");
  command.option("--timeout <ms>", "Language server timeout", parseTimeout, 30_000);

  const defaultColor = process.stdout.isTTY;

  command.option("--no-color", "Disable colored output", defaultColor);
  command.option("-h, --help", "Show help");
  command.option("-v, --version", "Show version");

  const outputConfiguration = { writeErr: ignoreParserOutput };

  command.configureOutput(outputConfiguration);

  return command;
}

function createHelp(): string {
  const command = createCommand();

  const commandHelp = command.helpInformation();

  const completeHelp = `${commandHelp}\n${exitCodeHelp}`;

  return completeHelp;
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

export const help = createHelp();

export function parseArguments(argv: string[]): ParsedArguments {
  const command = createCommand();

  command.parse(argv, { from: "user" });

  const flags = command.opts<CliFlags>();

  if (flags.help || flags.version) {
    const help = flags.help === true;

    const version = flags.version === true;

    return {
      help,
      version,
    };
  }

  const processCwd = process.cwd();

  const requestedCwd = flags.cwd ?? processCwd;

  const cwd = path.resolve(requestedCwd);

  const config = resolveConfig(cwd, flags.config);

  const patterns = resolvePatterns(command.args);

  const configProperties = configOption(config);

  const quiet = flags.quiet ?? false;

  const options: Options = {
    cwd,
    patterns,
    ...configProperties,
    format: flags.format,
    quiet,
    color: flags.color,
    maxWarnings: flags.maxWarnings,
    timeout: flags.timeout,
  };

  return {
    help: false,
    version: false,
    options,
  };
}
