import { describe, expect, it } from 'vitest';

import { Z80Cpu } from '@z80emu/core-z80';
import type { IoDevice, MemoryDevice } from '../src/types';

import { BasicChipset } from '../src/chipset';

class Memory implements MemoryDevice {
  readonly bytes = new Uint8Array(0x10000);

  read8(addr: number): number {
    return this.bytes[addr & 0xffff] ?? 0xff;
  }

  write8(addr: number, value: number): void {
    this.bytes[addr & 0xffff] = value & 0xff;
  }
}

class Io implements IoDevice {
  readonly outLog: Array<{ port: number; value: number }> = [];

  readonly inValues = new Map<number, number>();

  in8(port: number): number {
    return this.inValues.get(port & 0xff) ?? 0xff;
  }

  out8(port: number, value: number): void {
    this.outLog.push({ port: port & 0xff, value: value & 0xff });
  }
}

describe('BasicChipset', () => {
  it('routes memory read/write cycles via attached CPU pins', () => {
    const memory = new Memory();
    const io = new Io();
    memory.bytes.set([
      0x3e,
      0x42, // LD A,42h
      0x32,
      0x00,
      0x20, // LD (2000h),A
      0x76 // HALT
    ]);
    const cpu = new Z80Cpu({ strictUnsupportedOpcodes: true });
    const chipset = new BasicChipset({ memory, io });
    chipset.attachCpu(cpu);

    chipset.tick(256);

    expect(memory.read8(0x2000)).toBe(0x42);
    expect(chipset.getCpuState().halted).toBe(true);
  });

  it('routes io in/out cycles via attached CPU pins', () => {
    const memory = new Memory();
    const io = new Io();
    io.inValues.set(0x10, 0x5a);
    memory.bytes.set([
      0xdb,
      0x10, // IN A,(10h)
      0xd3,
      0x20, // OUT (20h),A
      0x76 // HALT
    ]);

    const cpu = new Z80Cpu({ strictUnsupportedOpcodes: true });
    const chipset = new BasicChipset({ memory, io });
    chipset.attachCpu(cpu);
    chipset.tick(256);

    expect(io.outLog).toContainEqual({ port: 0x20, value: 0x5a });
    expect(chipset.getCpuState().halted).toBe(true);
  });

  it('keeps no-op 11pin device side-effect free', () => {
    const memory = new Memory();
    const io = new Io();
    const chipset = new BasicChipset({ memory, io });
    const pin11 = chipset.getPin11Device();

    pin11.write(0x1f, 0xaa);
    expect(pin11.read(0x1f)).toBe(0);
    expect(io.outLog).toHaveLength(0);
  });
});
