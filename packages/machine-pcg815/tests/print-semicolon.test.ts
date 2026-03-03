import { describe, expect, it } from 'vitest';
import { PCG815Machine } from '../src';

function encode(lines: readonly string[]): number[] {
  const out: number[] = [];
  for (const line of lines) {
    for (const ch of line) out.push(ch.charCodeAt(0) & 0xff);
    out.push(0x0d);
  }
  return out;
}

describe('z80 basic PRINT semicolon behavior', () => {
  it.each(['z80-firmware', 'ts-compat'] as const)(
    'does not print implicit 0 on trailing semicolon (%s)',
    (executionBackend) => {
      const machine = new PCG815Machine({ executionBackend });
      machine.runBasicInterpreter(encode(['10 PRINT "X";', 'RUN']), { appendEot: true, maxTStates: 2_000_000 });
      const line0 = machine.getTextLines()[0] ?? '';
      expect(line0.startsWith('X')).toBe(true);
      expect(line0.includes('X0')).toBe(false);
    }
  );

  it.each(['z80-firmware', 'ts-compat'] as const)(
    'continues next PRINT on same line when previous ends with semicolon (%s)',
    (executionBackend) => {
      const machine = new PCG815Machine({ executionBackend });
      machine.runBasicInterpreter(encode(['10 PRINT "X";', '20 PRINT "Y"', 'RUN']), {
        appendEot: true,
        maxTStates: 2_000_000
      });
      const line0 = machine.getTextLines()[0] ?? '';
      expect(line0.includes('XY')).toBe(true);
    }
  );
});
