import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { assemble } from '@z80emu/assembler-z80';
import { PCG815Machine, decodeMachineText } from '@z80emu/machine-pcg815';

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

function runUntilProgramReturns(machine: PCG815Machine, returnAddress: number, maxSteps = 60_000): void {
  for (let i = 0; i < maxSteps; i += 1) {
    machine.tick(64);
    const cpu = machine.getCpuState();
    if (cpu.halted && machine.getExecutionDomain() === 'user-program') {
      machine.setProgramCounter(returnAddress & 0xffff);
      machine.setExecutionDomain('firmware');
    }
    if (machine.getExecutionDomain() === 'firmware') {
      return;
    }
  }
  throw new Error('ASM sample did not return to firmware address');
}

describe('asm sample input flow', () => {
  it('renders raw LCD text sample without text-port compatibility', { timeout: 20_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs);
    const assembled = assemble(asm, { filename: 'asm-sample.asm' });
    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;

    const machine = new PCG815Machine({ strictCpuOpcodes: true });
    machine.reset(true);
    machine.loadProgram(assembled.binary, assembled.origin);
    const firmwareReturnAddress = machine.getFirmwareReturnAddress() & 0xffff;
    const returnSp = 0x7ffc;
    machine.write8(returnSp, firmwareReturnAddress & 0xff);
    machine.write8((returnSp + 1) & 0xffff, (firmwareReturnAddress >> 8) & 0xff);
    machine.setStackPointer(returnSp);
    machine.setProgramCounter(assembled.entry);
    machine.setExecutionDomain('user-program');

    runFor(machine, 50_000);

    const before = decodeMachineText(machine).join('\n');
    expect(before).toContain('INPUT WORD');
    runUntilProgramReturns(machine, firmwareReturnAddress);

    const after = decodeMachineText(machine).join('\n');
    expect(after).toContain('HELLO');
    expect(after).toContain('REVERSED');
    expect(after).toContain('OLLEH');
  });
});
