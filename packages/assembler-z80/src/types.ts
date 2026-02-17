export type DiagnosticSeverity = 'error' | 'warning';

export interface AssembleOptions {
  filename?: string;
  includeResolver?: (fromFilename: string, includePath: string) => { filename: string; source: string } | undefined;
}

export interface AssemblerDiagnostic {
  severity: DiagnosticSeverity;
  message: string;
  file: string;
  line: number;
  column: number;
}

export interface SymbolEntry {
  name: string;
  value: number;
  kind: 'label' | 'equ';
}

export interface ListingRecord {
  file: string;
  line: number;
  address: number;
  bytes: number[];
  source: string;
}

export interface AssembleResult {
  ok: boolean;
  origin: number;
  entry: number;
  binary: Uint8Array;
  dump: string;
  lst: string;
  sym: string;
  listing: ListingRecord[];
  symbols: SymbolEntry[];
  diagnostics: AssemblerDiagnostic[];
}
