import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { assemble } from '@z80emu/assembler-z80';
import { PCG815Machine } from '@z80emu/machine-pcg815';

function extractAsmSample(source: string): string {
  const marker = 'const ASM_SAMPLE = `';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('ASM_SAMPLE not found');
  const from = start + marker.length;
  const end = source.indexOf('`;', from);
  if (end < 0) throw new Error('ASM_SAMPLE end not found');
  return source.slice(from, end);
}

function runFor(machine: PCG815Machine, iterations: number): void {
  for (let i = 0; i < iterations; i += 1) {
    machine.tick(64);
  }
}

function tapKey(machine: PCG815Machine, code: string): void {
  machine.setKeyState(code, true);
  runFor(machine, 128);
  machine.setKeyState(code, false);
  runFor(machine, 1024);
}

describe('asm sample input flow', () => {
  it('reads input and prints reversed text', { timeout: 20_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs);
    const assembled = assemble(asm, { filename: 'asm-sample.asm' });
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;

    const machine = new PCG815Machine({ strictCpuOpcodes: true });
    machine.reset(true);
    machine.loadProgram(assembled.binary, assembled.origin);
    machine.setStackPointer(0x7ffe);
    machine.setProgramCounter(assembled.entry);

    runFor(machine, 50_000);

    const before = machine.getTextLines().join('\n');
    expect(before).toContain('Input Word:');
    expect(machine.getCpuState().halted).toBe(false);

    tapKey(machine, 'KeyH');
    tapKey(machine, 'KeyE');
    tapKey(machine, 'KeyL');
    tapKey(machine, 'KeyL');
    tapKey(machine, 'KeyO');
    tapKey(machine, 'Enter');
    runFor(machine, 10_000);

    const after = machine.getTextLines().join('\n');
    expect(after).toContain('Reversed:');
    expect(after).toContain('OLLEH');
  });
});
