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

describe('z80 basic CHAR$/CHR$ print', () => {
  it('prints characters from CHAR$ codes', () => {
    const machine = new PCG815Machine({ executionBackend: 'z80-firmware' });
    machine.runBasicInterpreter(
      encode(['10 PRINT CHAR$(38)', '20 PRINT CHAR$(33)', '30 PRINT CHAR$(37)', 'RUN']),
      { appendEot: true, maxTStates: 2_000_000 }
    );
    const screen = machine.getTextLines().join('\n');
    expect(screen).toContain('&');
    expect(screen).toContain('!');
    expect(screen).toContain('%');
    expect(screen).not.toContain('0\n');
  });

  it('prints characters from CHR$ with optional space before parenthesis', () => {
    const machine = new PCG815Machine({ executionBackend: 'z80-firmware' });
    machine.runBasicInterpreter(encode(['10 PRINT CHR$ (65);CHR$(66)', 'RUN']), {
      appendEot: true,
      maxTStates: 2_000_000
    });
    const screen = machine.getTextLines().join('\n');
    expect(screen).toContain('AB');
  });
});

