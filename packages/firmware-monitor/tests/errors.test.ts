import { describe, expect, it } from 'vitest';

import {
  asDisplayError,
  BasicRuntimeError,
  ERROR_CATALOG,
  getErrorCatalogEntryForRuntimeCode,
  type RuntimeErrorCode
} from '../src';

describe('error catalog', () => {
  it('maps every active runtime error code to fixed numeric code', () => {
    const expected = new Map([
      ['SYNTAX', 'E01'],
      ['BAD_LINE', 'E02'],
      ['BAD_VAR', 'E03'],
      ['BAD_LET', 'E04'],
      ['BAD_IF', 'E05'],
      ['NO_LINE', 'E06'],
      ['RUNAWAY', 'E07'],
      ['INPUT_IN_RUN', 'E08'],
      ['RETURN_WO_GOSUB', 'E09'],
      ['BAD_STMT', 'E10']
    ]);

    for (const [runtimeCode, numericCode] of expected.entries()) {
      expect(getErrorCatalogEntryForRuntimeCode(runtimeCode as RuntimeErrorCode).numericCode).toBe(numericCode);
    }
  });

  it('keeps reserved codes for unimplemented commands', () => {
    const reserved = ERROR_CATALOG.filter((entry) => entry.status === 'RESERVED');
    expect(reserved).toHaveLength(13);

    const requiredCommands = ['FOR', 'NEXT', 'DIM', 'DATA', 'READ', 'RESTORE', 'PEEK', 'POKE', 'INP', 'OUT', 'BEEP', 'WAIT', 'LOCATE'];
    for (const command of requiredCommands) {
      expect(reserved.some((entry) => entry.commandRef === command)).toBe(true);
    }
  });
});

describe('display formatting', () => {
  it('formats runtime errors with numeric code suffix', () => {
    const error = new BasicRuntimeError('NO_LINE', 'NO LINE 999');
    expect(asDisplayError(error)).toBe('NO LINE 999 (E06)');
  });

  it('formats unknown errors with E99 fallback', () => {
    expect(asDisplayError(new Error('BOOM'))).toBe('BOOM (E99)');
    expect(asDisplayError('not-an-error')).toBe('UNKNOWN (E99)');
  });
});
