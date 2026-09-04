import path from "node:path";

import type { Diagnostic, FileDiagnostics } from "./types.js";

const severityNames = new Map([
  [1, "error"],
  [2, "warning"],
  [3, "info"],
  [4, "hint"],
]);

function plural(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function colorize(enabled: boolean, code: number, value: string): string {
  return enabled ? `\u001B[${code}m${value}\u001B[0m` : value;
}

function severityName(diagnostic: Diagnostic): string {
  return severityNames.get(diagnostic.severity ?? 1) ?? "error";
}

function diagnosticCode(diagnostic: Diagnostic): string {
  if (diagnostic.code !== undefined) {
    return String(diagnostic.code);
  }

  return diagnostic.source ?? "tailwindcss";
}

export function countDiagnostics(results: FileDiagnostics[]): {
  errors: number;
  warnings: number;
} {
  let errors = 0;
  let warnings = 0;

  for (const result of results) {
    for (const diagnostic of result.diagnostics) {
      if ((diagnostic.severity ?? 1) === 1) {
        errors++;
      } else if (diagnostic.severity === 2) {
        warnings++;
      }
    }
  }

  return { errors, warnings };
}

export function formatStylish(results: FileDiagnostics[], cwd: string, color: boolean): string {
  const affected = results.filter((result) => result.diagnostics.length > 0);
  const lines: string[] = [];

  for (const result of affected) {
    const locations = result.diagnostics.map(
      (diagnostic) => `${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1}`,
    );
    const locationWidth = Math.max(...locations.map((location) => location.length));
    const displayPath = path.relative(cwd, result.path) || path.basename(result.path);
    lines.push(colorize(color, 4, displayPath));

    for (const [index, diagnostic] of result.diagnostics.entries()) {
      const severity = severityName(diagnostic);
      const severityColor = severity === "error" ? 31 : severity === "warning" ? 33 : 36;
      const location = locations[index]?.padStart(locationWidth) ?? "";
      const message = diagnostic.message.replace(/\s+/g, " ").trim();
      lines.push(
        `  ${colorize(color, 2, location)}  ${colorize(color, severityColor, severity.padEnd(7))}  ${message}  ${colorize(color, 2, diagnosticCode(diagnostic))}`,
      );
    }

    lines.push("");
  }

  const { errors, warnings } = countDiagnostics(results);
  const problems = errors + warnings;
  if (problems === 0) {
    lines.push(
      colorize(color, 32, `✓ No Tailwind CSS problems found in ${plural(results.length, "file")}.`),
    );
  } else {
    const summary = `✖ ${plural(problems, "problem")} (${plural(errors, "error")}, ${plural(warnings, "warning")})`;
    lines.push(colorize(color, errors > 0 ? 31 : 33, summary));
  }

  return lines.join("\n");
}

export function formatJson(results: FileDiagnostics[]): string {
  return JSON.stringify(
    results.map((result) => ({
      filePath: result.path,
      messages: result.diagnostics.map((diagnostic) => ({
        ruleId: diagnosticCode(diagnostic),
        severity: diagnostic.severity ?? 1,
        message: diagnostic.message,
        line: diagnostic.range.start.line + 1,
        column: diagnostic.range.start.character + 1,
        endLine: diagnostic.range.end.line + 1,
        endColumn: diagnostic.range.end.character + 1,
      })),
      errorCount: result.diagnostics.filter((diagnostic) => (diagnostic.severity ?? 1) === 1)
        .length,
      warningCount: result.diagnostics.filter((diagnostic) => diagnostic.severity === 2).length,
    })),
    null,
    2,
  );
}
