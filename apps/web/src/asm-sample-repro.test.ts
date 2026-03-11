import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { assemble } from '@z80emu/assembler-z80';
import { decodeMachineText } from '@z80emu/lcd-144x32';
import { MONITOR_PROMPT_RESUME_ADDR, PCG815Machine } from '@z80emu/machine-pcg815';

function extractAsmSample(source: string, name: 'ASM_SAMPLE' | 'ASM_SAMPLE_3D'): string {
  const marker = `const ${name} = \``;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`${name} not found`);
  const from = start + marker.length;
  const end = source.indexOf('`;', from);
  if (end < 0) throw new Error(`${name} end not found`);
  return source.slice(from, end);
}

function runFor(machine: PCG815Machine, steps: number, quantum = 64): void {
  for (let i = 0; i < steps; i += 1) {
    machine.tick(quantum);
  }
}

function runUntilProgramReturns(
  machine: PCG815Machine,
  returnAddress: number,
  options?: { maxSteps?: number; quantum?: number }
): void {
  const maxSteps = options?.maxSteps ?? 60_000;
  const quantum = options?.quantum ?? 64;
  for (let i = 0; i < maxSteps; i += 1) {
    machine.tick(quantum);
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

function bootAsmSample(asm: string): { machine: PCG815Machine; returnAddress: number } {
  const assembled = assemble(asm, { filename: 'asm-sample.asm' });
  expect(assembled.ok).toBe(true);
  if (!assembled.ok) {
    throw new Error('assemble failed');
  }

  const machine = new PCG815Machine({
    strictCpuOpcodes: true,
    firmwareReturnAddress: MONITOR_PROMPT_RESUME_ADDR
  });
  machine.reset(true);
  machine.loadProgram(assembled.binary, assembled.origin);
  const firmwareReturnAddress = machine.getFirmwareReturnAddress() & 0xffff;
  const returnSp = 0x7ffc;
  machine.write8(returnSp, firmwareReturnAddress & 0xff);
  machine.write8((returnSp + 1) & 0xffff, (firmwareReturnAddress >> 8) & 0xff);
  machine.setStackPointer(returnSp);
  machine.setProgramCounter(assembled.entry);
  machine.setExecutionDomain('user-program');
  return { machine, returnAddress: firmwareReturnAddress };
}

function tapKey(machine: PCG815Machine, code: string): void {
  machine.setKeyState(code, true);
  runFor(machine, 4_000);
  machine.setKeyState(code, false);
  runFor(machine, 4_000);
}

function tapShiftedKey(machine: PCG815Machine, code: string): void {
  machine.setKeyState('ShiftLeft', true);
  runFor(machine, 2_000);
  machine.setKeyState(code, true);
  runFor(machine, 4_000);
  machine.setKeyState(code, false);
  runFor(machine, 2_000);
  machine.setKeyState('ShiftLeft', false);
  runFor(machine, 4_000);
}

describe('asm samples', () => {
  it('assembles both samples at origin 0x0100', () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    for (const name of ['ASM_SAMPLE', 'ASM_SAMPLE_3D'] as const) {
      const asm = extractAsmSample(mainTs, name);
      const assembled = assemble(asm, { filename: `${name}.asm` });
      expect(assembled.ok).toBe(true);
      if (!assembled.ok) {
        continue;
      }
      const origin = assembled.origin & 0xffff;
      const end = (origin + assembled.binary.length - 1) & 0xffff;
      expect(origin).toBe(0x0100);
      expect(end).toBeLessThan(0x7ffc);
    }
  });

  it('reverses typed input on the raw LCD sample', { timeout: 20_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE');
    const { machine, returnAddress } = bootAsmSample(asm);

    runFor(machine, 20_000);
    expect(decodeMachineText(machine).join('\n')).toContain('Input Word:');
    expect(decodeMachineText(machine).join('\n')).toContain('Reversed:');

    tapKey(machine, 'KeyH');
    tapKey(machine, 'KeyE');
    tapKey(machine, 'KeyL');
    tapKey(machine, 'KeyL');
    tapKey(machine, 'KeyO');
    expect(decodeMachineText(machine).join('\n')).toContain('HELLO');
    tapKey(machine, 'Enter');
    runUntilProgramReturns(machine, returnAddress, { maxSteps: 80_000 });
    expect(machine.getExecutionDomain()).toBe('firmware');
  });

  it('keeps stack pointer stable after asm sample returns to firmware loop', { timeout: 20_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE');
    const { machine, returnAddress } = bootAsmSample(asm);

    runFor(machine, 20_000);
    tapKey(machine, 'KeyO');
    tapKey(machine, 'KeyK');
    tapKey(machine, 'Enter');
    runUntilProgramReturns(machine, returnAddress, { maxSteps: 80_000 });

    const spBefore = machine.getCpuState().registers.sp & 0xffff;
    tapKey(machine, 'KeyA');
    tapKey(machine, 'KeyB');
    tapKey(machine, 'KeyC');
    runFor(machine, 2_000);
    const stateAfter = machine.getCpuState();

    expect(spBefore).toBeGreaterThanOrEqual(0x7ffe);
    expect(stateAfter.registers.sp & 0xffff).toBe(spBefore);
    expect(machine.getExecutionDomain()).toBe('firmware');
  });

  it('accepts shifted lowercase and symbols on the raw LCD sample', { timeout: 20_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE');
    const { machine } = bootAsmSample(asm);

    runFor(machine, 20_000);
    tapShiftedKey(machine, 'KeyK');
    tapShiftedKey(machine, 'Semicolon');

    const lines = decodeMachineText(machine).join('\n');
    expect(lines).toContain('k:');
  });

  it('renders multiple frames and keeps running for the 3D sample', { timeout: 20_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const { machine, returnAddress } = bootAsmSample(asm);

    const firstFrame = Uint8Array.from(machine.getFrameBuffer());
    runFor(machine, 3_000, 256);
    const midFrame = Uint8Array.from(machine.getFrameBuffer());

    expect(midFrame).not.toEqual(firstFrame);

    runFor(machine, 40_000, 256);

    const litPixels = machine.getFrameBuffer().reduce((sum, pixel) => sum + (pixel ? 1 : 0), 0);
    expect(litPixels).toBeGreaterThan(40);
    expect(machine.getExecutionDomain()).toBe('user-program');
    expect(machine.getCpuState().registers.pc & 0xffff).not.toBe(returnAddress & 0xffff);
  });
});
