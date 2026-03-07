import { describe, expect, it } from 'vitest';
import { decodeMachineText } from '@z80emu/lcd-144x32';
import { PCG815Machine } from '../src';

function encode(lines: readonly string[]): number[] {
  const bytes: number[] = [];
  for (const line of lines) {
    for (const ch of line) bytes.push(ch.charCodeAt(0) & 0xff);
    bytes.push(0x0d);
  }
  return bytes;
}

function run(lines: readonly string[], maxTStates = 2_000_000): PCG815Machine {
  const machine = new PCG815Machine({ executionBackend: 'z80-firmware' });
  machine.runBasicInterpreter(encode(lines), { appendEot: true, maxTStates });
  return machine;
}

describe('z80 basic label support', () => {
  it('supports IF ... *LABEL and GOTO *LABEL with label declaration lines', () => {
    const machine = run([
      '100 CLS',
      '*LOOP:',
      '110 LET C=3',
      '120 IF C=3 *FINISH',
      '130 PRINT "NG"',
      '140 GOTO *LOOP',
      '*FINISH:',
      '150 PRINT "OK"',
      '160 END',
      'RUN'
    ]);
    const screen = decodeMachineText(machine).join('\n');
    expect(screen).toContain('OK');
    expect(screen).not.toContain('NG');
  });

  it('supports GOSUB *LABEL and RETURN', () => {
    const machine = run([
      '100 LET A=0',
      '110 GOSUB *SETUP',
      '120 PRINT A',
      '130 END',
      '*SETUP:',
      '140 LET A=7',
      '150 RETURN',
      'RUN'
    ]);
    const screen = decodeMachineText(machine).join('\n');
    expect(screen).toContain('7');
  });

  it('updates label cache after label jump', () => {
    const machine = run([
      '100 GOTO *TARGET',
      '110 PRINT 0',
      '*TARGET:',
      '120 PRINT 1',
      '130 END',
      'RUN'
    ]);
    expect(machine.read8(0x6fa2)).toBe(1);
  });
});
