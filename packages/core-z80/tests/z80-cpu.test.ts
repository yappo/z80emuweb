import { describe, expect, it } from 'vitest';

import { FLAG_C } from '../src/flags';
import type { Bus } from '../src/types';
import { Z80Cpu } from '../src/z80-cpu';

class MemoryBus implements Bus {
  readonly memory = new Uint8Array(0x10000);

  readonly outLog: Array<{ port: number; value: number }> = [];

  read8(addr: number): number {
    return this.memory[addr & 0xffff] ?? 0;
  }

  write8(addr: number, value: number): void {
    this.memory[addr & 0xffff] = value & 0xff;
  }

  in8(_port: number): number {
    return 0;
  }

  out8(port: number, value: number): void {
    this.outLog.push({ port: port & 0xff, value: value & 0xff });
  }
}

function run(cpu: Z80Cpu, tstates: number): void {
  cpu.stepTState(tstates);
}

describe('Z80Cpu', () => {
  it('executes OUT and HALT sequence', () => {
    const bus = new MemoryBus();
    bus.memory.set([
      0x3e, 0x12, // LD A,12h
      0xd3, 0x40, // OUT (40h),A
      0x76 // HALT
    ]);

    const cpu = new Z80Cpu(bus, { strictUnsupportedOpcodes: true });
    run(cpu, 200);

    expect(bus.outLog).toContainEqual({ port: 0x40, value: 0x12 });
    expect(cpu.getState().halted).toBe(true);
  });

  it('supports DD indexed load/store', () => {
    const bus = new MemoryBus();
    bus.memory.set([
      0xdd, 0x21, 0x00, 0x40, // LD IX,4000h
      0xdd, 0x36, 0x01, 0x7f, // LD (IX+1),7Fh
      0xdd, 0x7e, 0x01, // LD A,(IX+1)
      0x76 // HALT
    ]);

    const cpu = new Z80Cpu(bus, { strictUnsupportedOpcodes: true });
    run(cpu, 400);

    expect(bus.memory[0x4001]).toBe(0x7f);
    expect(cpu.getState().registers.a).toBe(0x7f);
  });

  it('supports CB rotate operations', () => {
    const bus = new MemoryBus();
    bus.memory.set([
      0x06, 0x81, // LD B,81h
      0xcb, 0x00, // RLC B
      0x76
    ]);

    const cpu = new Z80Cpu(bus, { strictUnsupportedOpcodes: true });
    run(cpu, 240);

    expect(cpu.getState().registers.b).toBe(0x03);
    expect((cpu.getState().registers.f & FLAG_C) !== 0).toBe(true);
  });

  it('supports ED LDIR block copy', () => {
    const bus = new MemoryBus();
    bus.memory.set([
      0x21, 0x00, 0x20, // LD HL,2000h
      0x11, 0x00, 0x30, // LD DE,3000h
      0x01, 0x03, 0x00, // LD BC,0003h
      0xed, 0xb0, // LDIR
      0x76 // HALT
    ]);
    bus.memory.set([0xaa, 0xbb, 0xcc], 0x2000);

    const cpu = new Z80Cpu(bus, { strictUnsupportedOpcodes: true });
    run(cpu, 800);

    expect(bus.memory.slice(0x3000, 0x3003)).toEqual(Uint8Array.from([0xaa, 0xbb, 0xcc]));
    expect(cpu.getState().registers.b).toBe(0x00);
    expect(cpu.getState().registers.c).toBe(0x00);
  });

  it('defers interrupt acceptance for one instruction after EI', () => {
    const bus = new MemoryBus();
    bus.memory.set([
      0xfb, // EI
      0x00, // NOP (must execute before IRQ is accepted)
      0x00, // NOP
      0x76 // HALT
    ]);
    bus.memory[0x0038] = 0x76; // HALT at IM1 vector

    const cpu = new Z80Cpu(bus, { strictUnsupportedOpcodes: true });
    cpu.raiseInt(0xff);

    run(cpu, 1000);

    expect(cpu.getState().registers.pc).toBeGreaterThanOrEqual(0x0038);
    expect(cpu.getState().halted).toBe(true);
  });
});
