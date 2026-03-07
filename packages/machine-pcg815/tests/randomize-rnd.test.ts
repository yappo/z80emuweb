import { describe, expect, it } from 'vitest';
import { PCG815Machine, decodeMachineText } from '../src';

function encode(lines: string[]): number[] {
  const out: number[] = [];
  for (const line of lines) {
    for (const ch of line) out.push(ch.charCodeAt(0) & 0xff);
    out.push(0x0d);
  }
  return out;
}

function run(lines: string[]): string[] {
  const m = new PCG815Machine({ executionBackend: 'z80-firmware' });
  m.runBasicInterpreter(encode(lines), { appendEot: true, maxTStates: 4_000_000 });
  return decodeMachineText(m).map((line) => line.trim()).filter((line) => line.length > 0);
}

function runWithError(lines: string[]): { screen: string[]; error: Error | null } {
  const m = new PCG815Machine({ executionBackend: 'z80-firmware' });
  let error: Error | null = null;
  try {
    m.runBasicInterpreter(encode(lines), { appendEot: true, maxTStates: 4_000_000 });
  } catch (e) {
    error = e instanceof Error ? e : new Error(String(e));
  }
  return { screen: decodeMachineText(m).map((line) => line.trim()).filter((line) => line.length > 0), error };
}

describe('z80 basic RANDOMIZE/RND', () => {
  it('RND(10) returns values in 1..10 and changes over calls', () => {
    const lines = run([
      'NEW',
      '10 FOR I=1 TO 3',
      '20 PRINT RND(10)',
      '30 NEXT I',
      'RUN'
    ]);
    const values = lines.map((line) => Number.parseInt(line, 10));
    expect(values).toHaveLength(3);
    for (const value of values) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(10);
    }
    expect(new Set(values).size).toBeGreaterThan(1);
  });

  it('RANDOMIZE changes subsequent RND sequence start', () => {
    const withoutRandomize = run(['NEW', '10 PRINT RND(1000)', 'RUN']);
    const withRandomize = run(['NEW', '10 RANDOMIZE', '20 PRINT RND(1000)', 'RUN']);
    const a = Number.parseInt(withoutRandomize[0] ?? '0', 10);
    const b = Number.parseInt(withRandomize[0] ?? '0', 10);
    expect(a).toBeGreaterThanOrEqual(1);
    expect(a).toBeLessThanOrEqual(1000);
    expect(b).toBeGreaterThanOrEqual(1);
    expect(b).toBeLessThanOrEqual(1000);
    expect(a).not.toBe(b);
  });

  it('RND requires an argument expression', () => {
    const { error } = runWithError(['NEW', '10 PRINT RND', 'RUN']);
    expect(error).not.toBeNull();
  });

  it('RND with negative value reseeds to reproducible sequence', () => {
    const lines = run([
      'NEW',
      '10 A=RND(-5)',
      '20 PRINT RND(100)',
      '30 A=RND(-5)',
      '40 PRINT RND(100)',
      'RUN'
    ]);
    const first = Number.parseInt(lines[0] ?? '0', 10);
    const second = Number.parseInt(lines[1] ?? '0', 10);
    expect(first).toBeGreaterThanOrEqual(1);
    expect(first).toBeLessThanOrEqual(100);
    expect(second).toBe(first);
  });
});
