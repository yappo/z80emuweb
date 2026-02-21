import { describe, expect, it } from 'vitest';

import { Z80Cpu, type CpuState, type Z80Core, type Z80PinsIn, type Z80PinsOut } from '@z80emu/core-z80';
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

  inCount = 0;

  in8(port: number): number {
    this.inCount += 1;
    return this.inValues.get(port & 0xff) ?? 0xff;
  }

  out8(port: number, value: number): void {
    this.outLog.push({ port: port & 0xff, value: value & 0xff });
  }
}

class ReadHoldCpu implements Z80Core {
  private step = 0;

  reset(): void {
    this.step = 0;
  }

  tick(_input: Z80PinsIn): Z80PinsOut {
    this.step += 1;
    if (this.step <= 5) {
      return {
        addr: 0x10,
        dataOut: null,
        m1: false,
        mreq: false,
        iorq: true,
        rd: true,
        wr: false,
        rfsh: false,
        halt: false,
        busak: false
      };
    }
    return {
      addr: 0,
      dataOut: null,
      m1: false,
      mreq: false,
      iorq: false,
      rd: false,
      wr: false,
      rfsh: false,
      halt: false,
      busak: false
    };
  }

  getPinsOut(): Z80PinsOut {
    return {
      addr: 0x10,
      dataOut: null,
      m1: false,
      mreq: false,
      iorq: true,
      rd: true,
      wr: false,
      rfsh: false,
      halt: false,
      busak: false
    };
  }

  getState(): CpuState {
    return {
      registers: {
        a: 0,
        f: 0,
        b: 0,
        c: 0,
        d: 0,
        e: 0,
        h: 0,
        l: 0,
        ix: 0,
        iy: 0,
        sp: 0,
        pc: 0,
        i: 0,
        r: 0
      },
      iff1: false,
      iff2: false,
      im: 1,
      halted: false,
      pendingNmi: false,
      pendingInt: false,
      tstates: 0,
      queueDepth: 0
    };
  }

  loadState(_state: CpuState): void {}
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

  it('keeps data bus read value latched during stretched read phase', () => {
    const memory = new Memory();
    const io = new Io();
    io.inValues.set(0x10, 0x5a);
    const chipset = new BasicChipset({ memory, io });
    chipset.attachCpu(new ReadHoldCpu());

    chipset.tick(8);

    expect(io.inCount).toBe(1);
  });

  it('emits cycle traces with resolved read source', () => {
    const memory = new Memory();
    const io = new Io();
    memory.bytes.set([0x00, 0x76]); // NOP; HALT
    const trace: string[] = [];

    const chipset = new BasicChipset({
      memory,
      io,
      onCycleTrace: (entry) => {
        trace.push(`${entry.step}:${entry.readSource}`);
      }
    });
    chipset.attachCpu(new Z80Cpu({ strictUnsupportedOpcodes: true }));

    chipset.tick(16);

    expect(trace.length).toBeGreaterThan(0);
    expect(trace.some((x) => x.includes(':memory'))).toBe(true);
  });
});
