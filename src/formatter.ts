import path from "node:path";

import type { Diagnostic, FileDiagnostics } from "./types.js";

interface DiagnosticCounts {
  errors: number;
  warnings: number;
}

interface JsonMessage {
  ruleId: string;
  severity: number;
  message: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

interface JsonFileReport {
  filePath: string;
  messages: JsonMessage[];
  errorCount: number;
  warningCount: number;
}

const severityNames = new Map([
  [1, "error"],
  [2, "warning"],
  [3, "info"],
  [4, "hint"],
]);

function plural(count: number, singular: string): string {
  if (count === 1) {
    return `${count} ${singular}`;
  }

  return `${count} ${singular}s`;
}

function colorize(enabled: boolean, code: number, value: string): string {
  if (!enabled) {
    return value;
  }

  return `\u001B[${code}m${value}\u001B[0m`;
}

function severityName(diagnostic: Diagnostic): string {
  const severity = diagnostic.severity ?? 1;

  const configuredName = severityNames.get(severity);

  const name = configuredName ?? "error";

  return name;
}

function diagnosticCode(diagnostic: Diagnostic): string {
  if (diagnostic.code !== undefined) {
    const code = String(diagnostic.code);

    return code;
  }

  return diagnostic.source ?? "tailwindcss";
}

function severityColor(severity: string): number {
  if (severity === "error") {
    return 31;
  }

  if (severity === "warning") {
    return 33;
  }

  return 36;
}

function summaryColor(errors: number): number {
  if (errors > 0) {
    return 31;
  }

  return 33;
}

function formatLocation(diagnostic: Diagnostic): string {
  return `${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1}`;
}

function formatDiagnosticLine(diagnostic: Diagnostic, location: string, color: boolean): string {
  const severity = severityName(diagnostic);

  const singleLineMessage = diagnostic.message.replace(/\s+/g, " ");

  const message = singleLineMessage.trim();

  const code = diagnosticCode(diagnostic);

  const formattedLocation = colorize(color, 2, location);

  const severityCode = severityColor(severity);

  const paddedSeverity = severity.padEnd(7);

  const formattedSeverity = colorize(color, severityCode, paddedSeverity);

  const formattedCode = colorize(color, 2, code);

  return `  ${formattedLocation}  ${formattedSeverity}  ${message}  ${formattedCode}`;
}

function appendFileReport(
  lines: string[],
  result: FileDiagnostics,
  cwd: string,
  color: boolean,
): void {
  const locations = result.diagnostics.map(formatLocation);

  const locationWidths = locations.map((location) => location.length);

  const locationWidth = Math.max(...locationWidths);

  const relativePath = path.relative(cwd, result.path);

  const basename = path.basename(result.path);

  const displayPath = relativePath || basename;

  const formattedPath = colorize(color, 4, displayPath);

  lines.push(formattedPath);

  for (const [index, diagnostic] of result.diagnostics.entries()) {
    const location = locations[index]?.padStart(locationWidth) ?? "";

    const diagnosticLine = formatDiagnosticLine(diagnostic, location, color);

    lines.push(diagnosticLine);
  }

  lines.push("");
}

function appendSummary(
  lines: string[],
  results: FileDiagnostics[],
  errors: number,
  warnings: number,
  color: boolean,
): void {
  const problems = errors + warnings;

  if (problems === 0) {
    const fileCount = plural(results.length, "file");

    const summary = `✓ No Tailwind CSS problems found in ${fileCount}.`;

    const formattedSummary = colorize(color, 32, summary);

    lines.push(formattedSummary);

    return;
  }

  const problemCount = plural(problems, "problem");

  const errorCount = plural(errors, "error");

  const warningCount = plural(warnings, "warning");

  const summary = `✖ ${problemCount} (${errorCount}, ${warningCount})`;

  const colorCode = summaryColor(errors);

  const formattedSummary = colorize(color, colorCode, summary);

  lines.push(formattedSummary);
}

function createDiagnosticCounts(): DiagnosticCounts {
  return { errors: 0, warnings: 0 };
}

function countDiagnostic(counts: DiagnosticCounts, diagnostic: Diagnostic): void {
  const severity = diagnostic.severity ?? 1;

  if (severity === 1) {
    counts.errors++;

    return;
  }

  if (severity === 2) {
    counts.warnings++;
  }
}

export function countDiagnostics(results: FileDiagnostics[]): DiagnosticCounts {
  const counts = createDiagnosticCounts();

  for (const result of results) {
    for (const diagnostic of result.diagnostics) {
      countDiagnostic(counts, diagnostic);
    }
  }

  return counts;
}

export function formatStylish(results: FileDiagnostics[], cwd: string, color: boolean): string {
  const affected = results.filter((result) => result.diagnostics.length > 0);

  const lines: string[] = [];

  for (const result of affected) {
    appendFileReport(lines, result, cwd, color);
  }

  const { errors, warnings } = countDiagnostics(results);

  appendSummary(lines, results, errors, warnings, color);

  const report = lines.join("\n");

  return report;
}

function formatJsonMessage(diagnostic: Diagnostic): JsonMessage {
  const ruleId = diagnosticCode(diagnostic);

  const severity = diagnostic.severity ?? 1;

  const message = diagnostic.message;

  const line = diagnostic.range.start.line + 1;

  const column = diagnostic.range.start.character + 1;

  const endLine = diagnostic.range.end.line + 1;

  const endColumn = diagnostic.range.end.character + 1;

  return {
    ruleId,
    severity,
    message,
    line,
    column,
    endLine,
    endColumn,
  };
}

function formatJsonResult(result: FileDiagnostics): JsonFileReport {
  const filePath = result.path;

  const messages: JsonMessage[] = [];

  const counts = createDiagnosticCounts();

  for (const diagnostic of result.diagnostics) {
    const message = formatJsonMessage(diagnostic);

    messages.push(message);

    countDiagnostic(counts, diagnostic);
  }

  const errorCount = counts.errors;

  const warningCount = counts.warnings;

  return {
    filePath,
    messages,
    errorCount,
    warningCount,
  };
}

export function formatJson(results: FileDiagnostics[]): string {
  const report = results.map(formatJsonResult);

  const json = JSON.stringify(report, null, 2);

  return json;
}
