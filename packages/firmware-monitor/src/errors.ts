import {
  getErrorCatalogEntryForRuntimeCode,
  getUnknownErrorCatalogEntry,
  type ErrorCatalogEntry,
  type NumericErrorCode,
  type RuntimeErrorCode
} from './error-catalog';

export type { ErrorCatalogEntry, NumericErrorCode, RuntimeErrorCode } from './error-catalog';

export class BasicRuntimeError extends Error {
  readonly code: RuntimeErrorCode;

  constructor(code: RuntimeErrorCode, detail?: string) {
    super(detail ?? code);
    this.name = 'BasicRuntimeError';
    this.code = code;
  }

  // 実機寄りの短い表示文言へ変換する。
  toDisplayMessage(): string {
    switch (this.code) {
      case 'BAD_LINE':
        return 'BAD LINE';
      case 'BAD_VAR':
        return 'BAD VAR';
      case 'BAD_LET':
        return 'BAD LET';
      case 'BAD_IF':
        return 'BAD IF';
      case 'NO_LINE':
      case 'RUNAWAY':
      case 'INPUT_IN_RUN':
      case 'RETURN_WO_GOSUB':
      case 'BAD_STMT':
      case 'SYNTAX':
      default:
        return this.message;
    }
  }

  getCatalogEntry(): ErrorCatalogEntry {
    return getErrorCatalogEntryForRuntimeCode(this.code);
  }

  getNumericCode(): NumericErrorCode {
    return this.getCatalogEntry().numericCode;
  }

  toDisplayString(): string {
    return `${this.toDisplayMessage()} (${this.getNumericCode()})`;
  }
}

// UI 表示向けに unknown を文字列化する共通入口。
export function asDisplayError(error: unknown): string {
  if (error instanceof BasicRuntimeError) {
    return error.toDisplayString();
  }
  const unknownEntry = getUnknownErrorCatalogEntry();
  if (error instanceof Error) {
    const message = error.message.length > 0 ? error.message : unknownEntry.message;
    return `${message} (${unknownEntry.numericCode})`;
  }
  return `${unknownEntry.message} (${unknownEntry.numericCode})`;
}
