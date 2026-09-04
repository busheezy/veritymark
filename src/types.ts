export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Diagnostic {
  range: Range;
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
}

export interface FileDiagnostics {
  path: string;
  diagnostics: Diagnostic[];
}

export interface Options {
  cwd: string;
  patterns: string[];
  config?: string;
  format: "stylish" | "json";
  quiet: boolean;
  color: boolean;
  maxWarnings: number;
  timeout: number;
}
