// BASICランタイムで使う内部エラーコード定義。
export type RuntimeErrorCode =
  | 'SYNTAX'
  | 'BAD_LINE'
  | 'BAD_VAR'
  | 'BAD_LET'
  | 'BAD_IF'
  | 'NO_LINE'
  | 'RUNAWAY'
  | 'INPUT_IN_RUN'
  | 'RETURN_WO_GOSUB'
  | 'BAD_STMT';

export type NumericErrorCode = `E${string}`;

export interface ErrorCatalogEntry {
  runtimeCode?: RuntimeErrorCode;
  numericCode: NumericErrorCode;
  message: string;
  status: 'ACTIVE' | 'RESERVED';
  commandRef?: string;
}

export const ERROR_CATALOG: readonly ErrorCatalogEntry[] = [
  { runtimeCode: 'SYNTAX', numericCode: 'E01', message: 'SYNTAX', status: 'ACTIVE' },
  { runtimeCode: 'BAD_LINE', numericCode: 'E02', message: 'BAD LINE', status: 'ACTIVE' },
  { runtimeCode: 'BAD_VAR', numericCode: 'E03', message: 'BAD VAR', status: 'ACTIVE' },
  { runtimeCode: 'BAD_LET', numericCode: 'E04', message: 'BAD LET', status: 'ACTIVE' },
  { runtimeCode: 'BAD_IF', numericCode: 'E05', message: 'BAD IF', status: 'ACTIVE' },
  { runtimeCode: 'NO_LINE', numericCode: 'E06', message: 'NO LINE', status: 'ACTIVE' },
  { runtimeCode: 'RUNAWAY', numericCode: 'E07', message: 'RUNAWAY', status: 'ACTIVE' },
  { runtimeCode: 'INPUT_IN_RUN', numericCode: 'E08', message: 'INPUT IN RUN', status: 'ACTIVE' },
  {
    runtimeCode: 'RETURN_WO_GOSUB',
    numericCode: 'E09',
    message: 'RETURN W/O GOSUB',
    status: 'ACTIVE'
  },
  { runtimeCode: 'BAD_STMT', numericCode: 'E10', message: 'BAD STMT', status: 'ACTIVE' },

  { numericCode: 'E41', message: 'FOR', status: 'RESERVED', commandRef: 'FOR' },
  { numericCode: 'E42', message: 'NEXT', status: 'RESERVED', commandRef: 'NEXT' },
  { numericCode: 'E43', message: 'DIM', status: 'RESERVED', commandRef: 'DIM' },
  { numericCode: 'E44', message: 'DATA', status: 'RESERVED', commandRef: 'DATA' },
  { numericCode: 'E45', message: 'READ', status: 'RESERVED', commandRef: 'READ' },
  { numericCode: 'E46', message: 'RESTORE', status: 'RESERVED', commandRef: 'RESTORE' },
  { numericCode: 'E47', message: 'PEEK', status: 'RESERVED', commandRef: 'PEEK' },
  { numericCode: 'E48', message: 'POKE', status: 'RESERVED', commandRef: 'POKE' },
  { numericCode: 'E49', message: 'INP', status: 'RESERVED', commandRef: 'INP' },
  { numericCode: 'E50', message: 'OUT', status: 'RESERVED', commandRef: 'OUT' },
  { numericCode: 'E51', message: 'BEEP', status: 'RESERVED', commandRef: 'BEEP' },
  { numericCode: 'E52', message: 'WAIT', status: 'RESERVED', commandRef: 'WAIT' },
  { numericCode: 'E53', message: 'LOCATE', status: 'RESERVED', commandRef: 'LOCATE' },

  { numericCode: 'E99', message: 'UNKNOWN', status: 'ACTIVE' }
];

const UNKNOWN_ENTRY = ERROR_CATALOG.find((entry) => entry.numericCode === 'E99');

const ACTIVE_BY_RUNTIME = new Map<RuntimeErrorCode, ErrorCatalogEntry>(
  ERROR_CATALOG.filter((entry) => entry.status === 'ACTIVE' && entry.runtimeCode !== undefined).map((entry) => [
    entry.runtimeCode as RuntimeErrorCode,
    entry
  ])
);

export function getErrorCatalogEntryForRuntimeCode(code: RuntimeErrorCode): ErrorCatalogEntry {
  return ACTIVE_BY_RUNTIME.get(code) ?? getUnknownErrorCatalogEntry();
}

export function getUnknownErrorCatalogEntry(): ErrorCatalogEntry {
  if (UNKNOWN_ENTRY) {
    return UNKNOWN_ENTRY;
  }
  return {
    numericCode: 'E99',
    message: 'UNKNOWN',
    status: 'ACTIVE'
  };
}
