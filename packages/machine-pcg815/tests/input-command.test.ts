import { describe, expect, it } from 'vitest';
import { decodeMachineText } from '@z80emu/lcd-144x32';
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
  machine.runBasicInterpreter(encode(lines), { appendEot: true, maxTStates: 6_000_000 });
  return decodeMachineText(machine);
}

describe('z80 basic INPUT prompt and echo behavior', () => {
  it('shows ? for INPUT X and does not echo typed input', () => {
    const lines = run(['10 INPUT X', '20 PRINT "X=";X', 'RUN', '42']);
    expect(lines[0]?.startsWith('?')).toBe(true);
    expect(lines[1]?.includes('X=42')).toBe(true);
    expect(lines.join('\n')).not.toContain('?42');
  });

  it('INPUT "Input?> ",Y keeps no prompt text after enter and does not echo', () => {
    const lines = run(['10 INPUT "Input?> ",Y', '20 PRINT "Y=";Y', 'RUN', '15']);
    const screen = lines.join('\n');
    expect(screen).toContain('Y=15');
    expect(screen).not.toContain('Input?> 15');
  });

  it('INPUT "Input?> ";Z keeps prompt text and echoes typed input', () => {
    const lines = run(['10 INPUT "Input?> ";Z', '20 PRINT "Z=";Z', 'RUN', '77']);
    const screen = lines.join('\n');
    expect(screen).toContain('Input?> 77');
    expect(screen).toContain('Z=77');
  });

  it('supports mixed multi-input list in one statement', () => {
    const lines = run([
      '10 INPUT X, "Input?> ", Y, "Input?> "; Z',
      '20 PRINT "X=";X',
      '30 PRINT "Y=";Y',
      '40 PRINT "Z=";Z',
      'RUN',
      '1',
      '2',
      '3'
    ]);
    const screen = lines.join('\n');
    expect(screen).toContain('X=1');
    expect(screen).toContain('Y=2');
    expect(screen).toContain('Z=3');
  });

  it('does not continue to PRINT when INPUT value is not yet supplied', () => {
    const machine = new PCG815Machine({ executionBackend: 'z80-firmware' });
    machine.runBasicInterpreter(encode(['10 INPUT "[0-99]> ";X', '20 PRINT "Your Input:";X', 'RUN']), {
      appendEot: true,
      maxTStates: 200_000
    });
    const screen = decodeMachineText(machine).join('\n');
    expect(screen).not.toContain('Your Input:');
  });

  it('accepts keyboard input while user-program INPUT is waiting', () => {
    const machine = new PCG815Machine({ executionBackend: 'z80-firmware' });
    try {
      machine.runBasicInterpreter(encode(['1 CLS', '10 INPUT "[0-99]> ";X', '20 PRINT "Your Input:";X', 'RUN']), {
        appendEot: true,
        maxTStates: 200_000
      });
    } catch {
      // INPUT待機中はタイムスライス上限で抜ける想定
    }

    machine.setKeyState('Digit4', true);
    machine.setKeyState('Digit4', false);
    machine.setKeyState('Digit2', true);
    machine.setKeyState('Digit2', false);
    machine.setKeyState('Enter', true);
    machine.setKeyState('Enter', false);

    machine.tick(500_000);
    const screen = decodeMachineText(machine).join('\n');
    expect(screen).toContain('Your Input:42');
  });

  it('moves to next LCD line after INPUT is completed', () => {
    const lines = run(['1 CLS', '10 INPUT "[0-99]> ";X', '20 PRINT "Your Input:";X', 'RUN', '42']);
    expect(lines[0]?.includes('[0-99]> 42')).toBe(true);
    expect(lines[1]?.includes('Your Input:42')).toBe(true);
  });

  it('echoes the first semicolon INPUT character in real time before Enter', () => {
    const machine = new PCG815Machine({ executionBackend: 'z80-firmware' });
    try {
      machine.runBasicInterpreter(encode(['1 CLS', '10 INPUT "[0-99]> ";X', '20 PRINT "Your Input:";X', 'RUN']), {
        appendEot: true,
        maxTStates: 200_000
      });
    } catch {
      // INPUT待機中はタイムスライス上限で抜ける想定
    }

    machine.setKeyState('Digit4', true);
    machine.tick(40_000);
    machine.setKeyState('Digit4', false);
    machine.tick(120_000);
    expect(decodeMachineText(machine).join('\n')).toContain('[0-99]> 4');

  });

  it('keeps previous variable value when Enter is pressed with empty input', () => {
    const lines = run(['1 CLS', '10 X=55', '20 INPUT "[0-99]> ";X', '30 PRINT "X=";X', 'RUN', '']);
    const screen = lines.join('\n');
    expect(screen).toContain('X=55');
  });
});
