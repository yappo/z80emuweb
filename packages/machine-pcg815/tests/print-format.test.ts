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
  it('right-aligns a single numeric item within 12 columns', () => {
    const lines = run(['10 PRINT 1', 'RUN']);
    expect(lines[0]?.startsWith('           1')).toBe(true);
  });

  it('left-aligns a single string item', () => {
    const lines = run(['10 PRINT "A"', 'RUN']);
    expect(lines[0]?.startsWith('A')).toBe(true);
  });

  it('uses 12-column tabs for comma-separated items', () => {
    const lines = run(['10 PRINT 1,2', 'RUN']);
    expect(lines[0]?.startsWith('1           2')).toBe(true);
  });
});
