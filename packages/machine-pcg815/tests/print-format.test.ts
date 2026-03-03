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

function run(lines: readonly string[]): string[] {
  const machine = new PCG815Machine({ executionBackend: 'z80-firmware' });
  machine.runBasicInterpreter(encode(lines), { appendEot: true, maxTStates: 2_000_000 });
  return machine.getTextLines();
}

describe('z80 basic PRINT formatting', () => {
  it('right-aligns a single numeric item to LCD 24-column right edge', () => {
    const lines = run(['10 PRINT 1', 'RUN']);
    expect(lines[0]?.startsWith('                       1')).toBe(true);
  });

  it('places multi-digit numeric items at expected start columns', () => {
    const lines10 = run(['10 PRINT 10', 'RUN']);
    const lines5 = run(['10 PRINT 12345', 'RUN']);
    expect(lines10[0]?.startsWith('                      10')).toBe(true);
    expect(lines5[0]?.startsWith('                   12345')).toBe(true);
  });

  it('left-aligns a single string item', () => {
    const lines = run(['10 PRINT "A"', 'RUN']);
    expect(lines[0]?.startsWith('A')).toBe(true);
  });

  it('uses 12-column tabs for comma-separated items', () => {
    const lines = run(['10 PRINT 1,2', 'RUN']);
    expect(lines[0]?.startsWith('1           2')).toBe(true);
  });

  it('keeps successive numeric PRINT lines instead of collapsing to last line only', () => {
    const lines = run(['10 PRINT 1', '20 PRINT 21', '30 PRINT 321', '40 PRINT 4321', 'RUN']);
    expect(lines[0]?.startsWith('                       1')).toBe(true);
    expect(lines[1]?.startsWith('                      21')).toBe(true);
    expect(lines[2]?.startsWith('                     321')).toBe(true);
    expect(lines[3]?.startsWith('                    4321')).toBe(true);
  });
});
