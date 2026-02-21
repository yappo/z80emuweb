import { describe, expect, it } from 'vitest';

import { FLAG_C } from '../src/flags.ts';
import { hasTimingDefinition, Z80_TIMING_DEFINITION_TABLE, type OpcodeSpace } from '../src/timing-definitions.ts';
import { Z80Cpu } from '../src/z80-cpu.ts';
import { Z80_IDLE_PINS_OUT, type Z80PinsOut } from '../src/types.ts';

class PinHarness {
  readonly memory = new Uint8Array(0x10000);

  readonly outLog: Array<{ port: number; value: number }> = [];

  readonly inValues = new Map<number, number>();

  readonly cpu: Z80Cpu;

  private lastPinsOut: Z80PinsOut = { ...Z80_IDLE_PINS_OUT };

  private prevWriteActive = false;

  private intLine = false;

  private intDataBus = 0xff;

  private nmiLine = false;

  constructor(strictUnsupportedOpcodes = true) {
    this.cpu = new Z80Cpu({ strictUnsupportedOpcodes });
  }

  setInt(active: boolean, dataBus = 0xff): void {
    this.intLine = Boolean(active);
    this.intDataBus = dataBus & 0xff;
  }

  step(tstates: number): void {
    const steps = Math.max(0, Math.floor(tstates));
    for (let i = 0; i < steps; i += 1) {
      this.applyWrite(this.lastPinsOut);
      const data = this.readData(this.lastPinsOut);
      this.lastPinsOut = this.cpu.tick({
        data,
        wait: false,
        int: this.intLine,
        nmi: this.nmiLine,
        busrq: false,
        reset: false
      });
    }
    this.applyWrite(this.lastPinsOut);
  }

  private readData(pins: Z80PinsOut): number {
    if (pins.m1 && pins.iorq && pins.rd) {
      return this.intDataBus;
    }
    if (pins.mreq && pins.rd) {
      return this.memory[pins.addr & 0xffff] ?? 0xff;
    }
    if (pins.iorq && pins.rd) {
      return this.inValues.get(pins.addr & 0xff) ?? 0xff;
    }
    return 0xff;
  }

  private applyWrite(pins: Z80PinsOut): void {
    const writeActive = Boolean(pins.wr && (pins.mreq || pins.iorq) && pins.dataOut !== null);
    if (writeActive && !this.prevWriteActive) {
      const value = pins.dataOut ?? 0;
      if (pins.mreq) {
        this.memory[pins.addr & 0xffff] = value & 0xff;
      } else if (pins.iorq) {
        this.outLog.push({ port: pins.addr & 0xff, value: value & 0xff });
      }
    }
    this.prevWriteActive = writeActive;
  }
}

function run(harness: PinHarness, tstates: number): void {
  harness.step(tstates);
}

function expectNoUnsupportedForProgram(program: number[]): void {
  const harness = new PinHarness();
  harness.memory.set(program.map((x) => x & 0xff));
  expect(() => run(harness, 160)).not.toThrow();
}

describe('Z80Cpu', () => {
  it('executes OUT and HALT sequence', () => {
    const harness = new PinHarness();
    harness.memory.set([
      0x3e, 0x12, // LD A,12h
      0xd3, 0x40, // OUT (40h),A
      0x76 // HALT
    ]);

    run(harness, 200);

    expect(harness.outLog).toContainEqual({ port: 0x40, value: 0x12 });
    expect(harness.cpu.getState().halted).toBe(true);
  });

  it('supports DD indexed load/store', () => {
    const harness = new PinHarness();
    harness.memory.set([
      0xdd, 0x21, 0x00, 0x40, // LD IX,4000h
      0xdd, 0x36, 0x01, 0x7f, // LD (IX+1),7Fh
      0xdd, 0x7e, 0x01, // LD A,(IX+1)
      0x76 // HALT
    ]);

    run(harness, 400);

    expect(harness.memory[0x4001]).toBe(0x7f);
    expect(harness.cpu.getState().registers.a).toBe(0x7f);
  });

  it('supports LD r,r and pointer variants', () => {
    const harness = new PinHarness();
    harness.memory.set([
      0x06, 0x12, // LD B,12h
      0x48, // LD C,B
      0x21, 0x00, 0x20, // LD HL,2000h
      0x70, // LD (HL),B
      0x5e, // LD E,(HL)
      0x76 // HALT
    ]);

    run(harness, 300);

    const state = harness.cpu.getState();
    expect(state.registers.c).toBe(0x12);
    expect(harness.memory[0x2000]).toBe(0x12);
    expect(state.registers.e).toBe(0x12);
  });

  it('supports DD/FD LD r,r variants including IXH/IXL and (IX+d)/(IY+d)', () => {
    const harness = new PinHarness();
    harness.memory.set([
      0xdd, 0x21, 0x00, 0x40, // LD IX,4000h
      0xdd, 0x66, 0x01, // LD H,(IX+1) -> IXH
      0xdd, 0x68, // LD L,B -> IXL <- B
      0xfd, 0x21, 0x00, 0x50, // LD IY,5000h
      0xfd, 0x70, 0xfe, // LD (IY-2),B
      0xfd, 0x4e, 0xfe, // LD C,(IY-2)
      0x76 // HALT
    ]);
    harness.memory[0x4001] = 0xab;

    const cpu = harness.cpu;
    cpu.loadState({
      ...cpu.getState(),
      registers: {
        ...cpu.getState().registers,
        b: 0x34
      }
    });
    run(harness, 800);

    const state = cpu.getState();
    expect((state.registers.ix >>> 8) & 0xff).toBe(0xab);
    expect(state.registers.ix & 0xff).toBe(0x34);
    expect(harness.memory[0x4ffe]).toBe(0x34);
    expect(state.registers.c).toBe(0x34);
  });

  it('supports CB rotate operations', () => {
    const harness = new PinHarness();
    harness.memory.set([
      0x06, 0x81, // LD B,81h
      0xcb, 0x00, // RLC B
      0x76
    ]);

    run(harness, 240);

    expect(harness.cpu.getState().registers.b).toBe(0x03);
    expect((harness.cpu.getState().registers.f & FLAG_C) !== 0).toBe(true);
  });

  it('supports base ALU register and (HL) variants', () => {
    const harness = new PinHarness();
    harness.memory.set([
      0x3e, 0x10, // LD A,10h
      0x06, 0x22, // LD B,22h
      0x80, // ADD A,B => 32h
      0x21, 0x00, 0x20, // LD HL,2000h
      0x86, // ADD A,(HL) => 37h
      0xe6, 0x0f, // AND 0Fh => 07h
      0xee, 0x07, // XOR 07h => 00h
      0xf6, 0x80, // OR 80h => 80h
      0xfe, 0x80, // CP 80h
      0x76
    ]);
    harness.memory[0x2000] = 0x05;

    run(harness, 900);
    const state = harness.cpu.getState();

    expect(state.registers.a).toBe(0x80);
    expect((state.registers.f & FLAG_C) === 0).toBe(true);
  });

  it('supports base exchange, pair arithmetic, rotate/flag opcodes', () => {
    const harness = new PinHarness();
    harness.memory.set([
      0x06, 0x02, // LD B,02h
      0x10, 0x02, // DJNZ +2 (taken)
      0x00, // NOP (skipped)
      0x00, // NOP (target)
      0x21, 0x34, 0x12, // LD HL,1234h
      0x11, 0x78, 0x56, // LD DE,5678h
      0xeb, // EX DE,HL
      0x31, 0x00, 0x40, // LD SP,4000h
      0xe3, // EX (SP),HL
      0x3e, 0x99, // LD A,99h
      0x07, // RLCA
      0x27, // DAA
      0x2f, // CPL
      0x37, // SCF
      0x3f, // CCF
      0x76
    ]);
    harness.memory[0x4000] = 0xaa;
    harness.memory[0x4001] = 0xbb;

    run(harness, 1500);
    const state = harness.cpu.getState();

    expect(state.registers.h).toBe(0xbb);
    expect(state.registers.l).toBe(0xaa);
    expect(harness.memory[0x4000]).toBe(0x78);
    expect(harness.memory[0x4001]).toBe(0x56);
  });

  it('supports EXX and EX AF,AF shadow register exchange', () => {
    const harness = new PinHarness();
    harness.memory.set([
      0x06, 0x11, // LD B,11h
      0x16, 0x22, // LD D,22h
      0x26, 0x33, // LD H,33h
      0x3e, 0x44, // LD A,44h
      0x08, // EX AF,AF'
      0xd9, // EXX
      0x06, 0xaa, // LD B,AAh
      0x16, 0xbb, // LD D,BBh
      0x26, 0xcc, // LD H,CCh
      0x3e, 0xdd, // LD A,DDh
      0xd9, // EXX
      0x08, // EX AF,AF'
      0x76
    ]);

    run(harness, 1200);
    const state = harness.cpu.getState();

    expect(state.registers.b).toBe(0x11);
    expect(state.registers.d).toBe(0x22);
    expect(state.registers.h).toBe(0x33);
    expect(state.registers.a).toBe(0x44);
  });

  it('supports CB remaining rotate/shift group', () => {
    const harness = new PinHarness();
    harness.memory.set([
      0x06, 0x81, // LD B,81h
      0x0e, 0x03, // LD C,03h
      0xcb, 0x08, // RRC B => C0h
      0xcb, 0x19, // RR C
      0xcb, 0x20, // SLA B
      0xcb, 0x29, // SRA C
      0xcb, 0x30, // SLL B
      0xcb, 0x39, // SRL C
      0x76
    ]);

    run(harness, 1000);
    const state = harness.cpu.getState();
    expect(state.registers.b).toBe(0x01);
    expect(state.registers.c).toBe(0x60);
  });

  it('supports ED pair arithmetic/load and IM selection', () => {
    const harness = new PinHarness();
    harness.memory.set([
      0x21, 0x34, 0x12, // LD HL,1234h
      0x01, 0x02, 0x00, // LD BC,0002h
      0xed, 0x4a, // ADC HL,BC => 1236h
      0xed, 0x42, // SBC HL,BC => 1234h
      0xed, 0x43, 0x00, 0x30, // LD (3000h),BC
      0x11, 0x00, 0x00, // LD DE,0000h
      0xed, 0x5b, 0x00, 0x30, // LD DE,(3000h)
      0xed, 0x5e, // IM 2
      0x76
    ]);

    run(harness, 1400);
    const state = harness.cpu.getState();

    expect(state.registers.h).toBe(0x12);
    expect(state.registers.l).toBe(0x34);
    expect(state.registers.d).toBe(0x00);
    expect(state.registers.e).toBe(0x02);
    expect(state.im).toBe(2);
  });

  it('supports ED IN/OUT with (C) and block IN/OUT/CP operations', () => {
    const harness = new PinHarness();
    harness.inValues.set(0x10, 0x5a);
    harness.memory.set([
      0x0e, 0x10, // LD C,10h
      0xed, 0x78, // IN A,(C)
      0xed, 0x79, // OUT (C),A
      0x21, 0x00, 0x20, // LD HL,2000h
      0x06, 0x01, // LD B,01h
      0xed, 0xa2, // INI
      0x21, 0x00, 0x20, // LD HL,2000h
      0x06, 0x01, // LD B,01h
      0xed, 0xa3, // OUTI
      0x3e, 0x5a, // LD A,5Ah
      0x21, 0x00, 0x20, // LD HL,2000h
      0x01, 0x01, 0x00, // LD BC,0001h
      0xed, 0xa1, // CPI
      0x76
    ]);

    run(harness, 2200);
    const state = harness.cpu.getState();

    expect(state.registers.a).toBe(0x5a);
    expect(harness.outLog.some((x) => x.port === 0x10 && x.value === 0x5a)).toBe(true);
    expect(harness.memory[0x2000]).toBe(0x5a);
  });

  it('supports ED RRD/RLD', () => {
    const harness = new PinHarness();
    harness.memory.set([
      0x21, 0x00, 0x20, // LD HL,2000h
      0x3e, 0x12, // LD A,12h
      0xed, 0x67, // RRD
      0xed, 0x6f, // RLD
      0x76
    ]);
    harness.memory[0x2000] = 0x34;

    run(harness, 1000);
    const state = harness.cpu.getState();
    expect(state.registers.a).toBe(0x12);
    expect(harness.memory[0x2000]).toBe(0x34);
  });

  it('supports ED LDIR block copy', () => {
    const harness = new PinHarness();
    harness.memory.set([
      0x21, 0x00, 0x20, // LD HL,2000h
      0x11, 0x00, 0x30, // LD DE,3000h
      0x01, 0x03, 0x00, // LD BC,0003h
      0xed, 0xb0, // LDIR
      0x76 // HALT
    ]);
    harness.memory.set([0xaa, 0xbb, 0xcc], 0x2000);

    run(harness, 800);

    expect(harness.memory.slice(0x3000, 0x3003)).toEqual(Uint8Array.from([0xaa, 0xbb, 0xcc]));
    expect(harness.cpu.getState().registers.b).toBe(0x00);
    expect(harness.cpu.getState().registers.c).toBe(0x00);
  });

  it('defers interrupt acceptance for one instruction after EI', () => {
    const harness = new PinHarness();
    harness.memory.set([
      0xfb, // EI
      0x00, // NOP (must execute before IRQ is accepted)
      0x00, // NOP
      0x76 // HALT
    ]);
    harness.memory[0x0038] = 0x76; // HALT at IM1 vector
    harness.setInt(true, 0xff);

    run(harness, 1000);

    expect(harness.cpu.getState().registers.pc).toBeGreaterThanOrEqual(0x0038);
    expect(harness.cpu.getState().halted).toBe(true);
  });

  it('has no unsupported opcode in base space', () => {
    for (let opcode = 0; opcode <= 0xff; opcode += 1) {
      expectNoUnsupportedForProgram([opcode, 0x00, 0x00, 0x00, 0x00]);
    }
  });

  it('has no unsupported opcode in CB space', () => {
    for (let opcode = 0; opcode <= 0xff; opcode += 1) {
      expectNoUnsupportedForProgram([0xcb, opcode, 0x00, 0x00, 0x00]);
    }
  });

  it('has no unsupported opcode in ED space', () => {
    for (let opcode = 0; opcode <= 0xff; opcode += 1) {
      expectNoUnsupportedForProgram([0xed, opcode, 0x00, 0x00, 0x00, 0x00]);
    }
  });

  it('has no unsupported opcode in DD/FD prefixed spaces', () => {
    for (let opcode = 0; opcode <= 0xff; opcode += 1) {
      expectNoUnsupportedForProgram([0xdd, opcode, 0x01, 0x00, 0x00, 0x00]);
      expectNoUnsupportedForProgram([0xfd, opcode, 0x01, 0x00, 0x00, 0x00]);
    }
  });

  it('has no unsupported opcode in DDCB/FDCB spaces', () => {
    for (let opcode = 0; opcode <= 0xff; opcode += 1) {
      expectNoUnsupportedForProgram([0xdd, 0xcb, 0x01, opcode, 0x00, 0x00]);
      expectNoUnsupportedForProgram([0xfd, 0xcb, 0x01, opcode, 0x00, 0x00]);
    }
  });

  it('has timing definitions for all opcodes in all opcode spaces', () => {
    const spaces: OpcodeSpace[] = ['base', 'cb', 'ed', 'dd', 'fd', 'ddcb', 'fdcb'];
    for (const space of spaces) {
      expect(Z80_TIMING_DEFINITION_TABLE[space]).toHaveLength(0x100);
      for (let opcode = 0; opcode <= 0xff; opcode += 1) {
        expect(hasTimingDefinition(space, opcode)).toBe(true);
      }
    }
  });
});
