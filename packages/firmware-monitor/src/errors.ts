// BASIC ランタイムで表示互換を保つためのエラーコード。
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

export class BasicRuntimeError extends Error {
  readonly code: RuntimeErrorCode;

  constructor(code: RuntimeErrorCode, detail?: string) {
    super(detail ?? code);
    this.name = 'BasicRuntimeError';
    this.code = code;
  }

  // 実機寄りの短い表示文言へ変換する。
  toDisplayString(): string {
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
}

// UI 表示向けに unknown を文字列化する共通入口。
export function asDisplayError(error: unknown): string {
  if (error instanceof BasicRuntimeError) {
    return error.toDisplayString();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'UNKNOWN';
}
