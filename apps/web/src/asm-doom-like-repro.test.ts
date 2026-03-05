import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { assemble } from '@z80emu/assembler-z80';
import { PCG815Machine } from '@z80emu/machine-pcg815';

function runFor(machine: PCG815Machine, iterations: number): void {
  for (let i = 0; i < iterations; i += 1) {
    machine.tick(64);
  }
}

function litPixelCount(machine: PCG815Machine): number {
  const frame = machine.getFrameBuffer();
  let lit = 0;
  for (let i = 0; i < frame.length; i += 1) {
    lit += frame[i] ? 1 : 0;
  }
  return lit;
}

function extractAsmSample(source: string, name: string): string {
  const marker = `const ${name} = \``;
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`${name} not found`);
  }
  const from = start + marker.length;
  const end = source.indexOf('`;', from);
  if (end < 0) {
    throw new Error(`${name} end not found`);
  }
  return source.slice(from, end);
}

describe('doom-like asm sample', () => {
  it('assembles and animates the LCD frame buffer', { timeout: 40_000 }, () => {
    const mainTs = readFileSync(path.resolve(process.cwd(), 'src/main.ts'), 'utf8');
    const asm = extractAsmSample(mainTs, 'ASM_SAMPLE_3D');
    const assembled = assemble(asm, { filename: 'doom-like-demo.asm' });

    expect(assembled.ok).toBe(true);
    if (!assembled.ok) return;

    const machine = new PCG815Machine({ strictCpuOpcodes: true });
    machine.reset(true);
    machine.loadProgram(assembled.binary, assembled.origin);
    machine.setStackPointer(0x7ffc);
    machine.setProgramCounter(assembled.entry);
    machine.setExecutionDomain('user-program');

    runFor(machine, 24_000);
    const firstLit = litPixelCount(machine);

    const hashes = new Set<string>();
    for (let i = 0; i < 4; i += 1) {
      runFor(machine, 110_000);
      const frame = Uint8Array.from(machine.getFrameBuffer());
      hashes.add(Buffer.from(frame).toString('hex'));
    }
    const secondLit = litPixelCount(machine);

    expect(firstLit).toBeGreaterThan(0);
    expect(secondLit).toBeGreaterThan(0);
    expect(hashes.size).toBeGreaterThan(1);
  });
});
