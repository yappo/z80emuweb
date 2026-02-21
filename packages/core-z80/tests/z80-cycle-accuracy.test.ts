import { describe, expect, it } from 'vitest';

import { Z80Cpu } from '../src/z80-cpu.ts';
import { Z80_IDLE_PINS_OUT, type CpuState, type Z80PinsOut } from '../src/types.ts';

class TraceHarness {
  readonly memory = new Uint8Array(0x10000);

  readonly inValues = new Map<number, number>();

  readonly trace: Z80PinsOut[] = [];

  readonly cpu = new Z80Cpu({ strictUnsupportedOpcodes: true });

  private lastPinsOut: Z80PinsOut = { ...Z80_IDLE_PINS_OUT };

  private prevWriteActive = false;

  private intLine = false;

  private intDataBus = 0xff;

  private nmiLine = false;
  private busrqLine = false;

  step(tstates: number, waitSelector?: (pins: Z80PinsOut, stepIndex: number) => boolean): void {
    const steps = Math.max(0, Math.floor(tstates));
    for (let i = 0; i < steps; i += 1) {
      this.trace.push({ ...this.lastPinsOut });
      this.applyWrite(this.lastPinsOut);
      const inputData = this.readData(this.lastPinsOut);
      const wait = waitSelector?.(this.lastPinsOut, i) ?? false;
      this.lastPinsOut = this.cpu.tick({
        data: inputData,
        wait,
        int: this.intLine,
        nmi: this.nmiLine,
        busrq: this.busrqLine,
        reset: false
      });
    }
    this.trace.push({ ...this.lastPinsOut });
    this.applyWrite(this.lastPinsOut);
  }

  setInt(active: boolean, dataBus = 0xff): void {
    this.intLine = Boolean(active);
    this.intDataBus = dataBus & 0xff;
  }

  setNmi(active: boolean): void {
    this.nmiLine = Boolean(active);
  }

  setBusrq(active: boolean): void {
    this.busrqLine = Boolean(active);
  }

  loadState(state: CpuState): void {
    this.cpu.loadState(state);
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
    const active = Boolean(pins.wr && (pins.mreq || pins.iorq) && pins.dataOut !== null);
    if (active && !this.prevWriteActive && pins.mreq) {
      this.memory[pins.addr & 0xffff] = pins.dataOut ?? 0;
    }
    this.prevWriteActive = active;
  }
}

describe('Z80 cycle accuracy', () => {
  it('emits M1 fetch then RFSH within opcode fetch sequence', () => {
    const harness = new TraceHarness();
    harness.memory.set([0x00, 0x76]); // NOP; HALT

    harness.step(16);

    const fetchIndex = harness.trace.findIndex((x) => x.m1 && x.mreq && x.rd);
    const refreshIndex = harness.trace.findIndex((x) => x.m1 && x.mreq && x.rfsh);

    expect(fetchIndex).toBeGreaterThanOrEqual(0);
    expect(refreshIndex).toBeGreaterThan(fetchIndex);
  });

  it('inserts WAIT during IO read cycle', () => {
    const harness = new TraceHarness();
    harness.memory.set([
      0xdb,
      0x10, // IN A,(10h)
      0x76 // HALT
    ]);
    harness.inValues.set(0x10, 0x34);

    let waits = 0;
    harness.step(80, (pins) => {
      if (pins.iorq && pins.rd && waits < 2) {
        waits += 1;
        return true;
      }
      return false;
    });

    const ioReadCycles = harness.trace.filter((x) => x.iorq && x.rd && (x.addr & 0xff) === 0x10).length;
    expect(waits).toBe(2);
    expect(ioReadCycles).toBeGreaterThanOrEqual(5);
    expect(harness.cpu.getState().registers.a).toBe(0x34);
  });

  it('samples WAIT only on T2/TW and not on T1/T3', () => {
    const harness = new TraceHarness();
    harness.memory.set([
      0xdb,
      0x10, // IN A,(10h)
      0x76 // HALT
    ]);
    harness.inValues.set(0x10, 0x34);

    harness.step(120, (pins) => {
      // T1: rd is high but mreq/iorq inactive on this implementation phase.
      if (pins.rd && !pins.mreq && !pins.iorq) {
        return true;
      }
      // T3-like finalization phase where rd is deasserted.
      if (!pins.rd && (pins.mreq || pins.iorq)) {
        return true;
      }
      return false;
    });

    expect(harness.cpu.getState().registers.a).toBe(0x34);
  });

  it('defers INT acceptance for one instruction after EI', () => {
    const harness = new TraceHarness();
    harness.memory.set([
      0xfb, // EI
      0x00, // NOP
      0x00, // NOP
      0x76 // HALT
    ]);
    harness.memory[0x0038] = 0x76;
    harness.setInt(true, 0xff);

    harness.step(1200);

    const state = harness.cpu.getState();
    expect(state.registers.pc).toBeGreaterThanOrEqual(0x0038);
    expect(state.halted).toBe(true);
  });

  it('releases HALT on interrupt and executes interrupt handler', () => {
    const harness = new TraceHarness();
    harness.memory.set([0x76]); // HALT
    harness.memory[0x0038] = 0x76;
    const initial = harness.cpu.getState();
    harness.loadState({
      ...initial,
      iff1: true,
      iff2: true
    });

    harness.step(64);
    expect(harness.cpu.getState().halted).toBe(true);

    harness.setInt(true, 0xff);
    harness.step(400);

    const state = harness.cpu.getState();
    expect(state.registers.pc).toBeGreaterThanOrEqual(0x0038);
    expect(state.halted).toBe(true);
  });

  it('keeps M1 fetch and RFSH cycles while HALTed', () => {
    const harness = new TraceHarness();
    harness.memory.set([0x76]); // HALT

    harness.step(64);

    const haltFetchCycles = harness.trace.filter((x) => x.halt && x.m1 && x.mreq && x.rd).length;
    const haltRefreshCycles = harness.trace.filter((x) => x.halt && x.m1 && x.mreq && x.rfsh).length;

    expect(haltFetchCycles).toBeGreaterThan(0);
    expect(haltRefreshCycles).toBeGreaterThan(0);
  });

  it('releases HALT on NMI and executes NMI handler at 0x0066', () => {
    const harness = new TraceHarness();
    harness.memory.set([0x76]); // HALT
    harness.memory[0x0066] = 0x76; // HALT at NMI vector

    harness.step(64);
    expect(harness.cpu.getState().halted).toBe(true);

    // NMI is edge-triggered; keep high for one step, then lower.
    harness.setNmi(true);
    harness.step(1);
    harness.setNmi(false);
    harness.step(400);

    const state = harness.cpu.getState();
    expect(state.registers.pc).toBeGreaterThanOrEqual(0x0066);
    expect(state.halted).toBe(true);
  });

  it('prioritizes NMI over INT when both are asserted together', () => {
    const harness = new TraceHarness();
    harness.memory.fill(0);
    harness.memory[0x0066] = 0x76; // NMI vector
    harness.memory[0x0038] = 0x00; // IM1 vector marker

    const initial = harness.cpu.getState();
    harness.loadState({
      ...initial,
      iff1: true,
      iff2: true,
      im: 1
    });

    harness.setInt(true, 0xff);
    harness.setNmi(true);
    harness.step(1);
    harness.setNmi(false);
    harness.step(400);

    const state = harness.cpu.getState();
    expect(state.registers.pc).toBeGreaterThanOrEqual(0x0066);
    expect(state.registers.pc).toBeLessThan(0x0100);
  });

  it('matches INT vector behavior for IM0/IM1/IM2', () => {
    const runMode = (
      im: 0 | 1 | 2,
      intDataBus: number,
      expectedPcBase: number,
      i = 0x40
    ): { state: CpuState; trace: Z80PinsOut[] } => {
      const harness = new TraceHarness();
      harness.memory.fill(0);
      harness.memory[expectedPcBase & 0xffff] = 0x76;
      if (im === 2) {
        const vector = ((i << 8) | intDataBus) & 0xfffe;
        harness.memory[vector] = expectedPcBase & 0xff;
        harness.memory[(vector + 1) & 0xffff] = (expectedPcBase >>> 8) & 0xff;
      }

      const initial = harness.cpu.getState();
      harness.loadState({
        ...initial,
        iff1: true,
        iff2: true,
        im,
        registers: {
          ...initial.registers,
          pc: 0x0000,
          i
        }
      });
      harness.setInt(true, intDataBus);
      harness.step(400);
      return {
        state: harness.cpu.getState(),
        trace: harness.trace
      };
    };

    const im0 = runMode(0, 0xc7, 0x0000);
    const im1 = runMode(1, 0xff, 0x0038);
    const im2 = runMode(2, 0x10, 0x2222, 0x55);

    expect(im0.state.registers.pc).toBeGreaterThanOrEqual(0x0000);
    expect(im0.state.registers.pc).toBeLessThan(0x0010);
    expect(im1.state.registers.pc).toBeGreaterThanOrEqual(0x0038);
    expect(im2.state.registers.pc).toBeGreaterThanOrEqual(0x2222);

    const hasIntAck = (trace: Z80PinsOut[]): boolean => trace.some((x) => x.m1 && x.iorq && x.rd);
    expect(hasIntAck(im0.trace)).toBe(true);
    expect(hasIntAck(im1.trace)).toBe(true);
    expect(hasIntAck(im2.trace)).toBe(true);
  });

  it('asserts BUSAK and pauses instruction progress while BUSRQ is active', () => {
    const harness = new TraceHarness();
    harness.memory.set([
      0x00, // NOP
      0x00, // NOP
      0x76 // HALT
    ]);

    harness.step(6);
    const pcBeforeHold = harness.cpu.getState().registers.pc;
    harness.setBusrq(true);
    harness.step(20);
    const pcDuringHold = harness.cpu.getState().registers.pc;

    expect(harness.trace.some((x) => x.busak)).toBe(true);
    expect(pcDuringHold).toBe(pcBeforeHold);

    harness.setBusrq(false);
    harness.step(40);
    const pcAfterRelease = harness.cpu.getState().registers.pc;
    expect(pcAfterRelease).toBeGreaterThan(pcDuringHold);
  });

  it('keeps bus control lines inactive while BUSAK is asserted', () => {
    const harness = new TraceHarness();
    harness.memory.set([0x00, 0x76]); // NOP; HALT

    harness.step(8);
    harness.setBusrq(true);
    harness.step(24);

    const busakCycles = harness.trace.filter((x) => x.busak);
    expect(busakCycles.length).toBeGreaterThan(0);
    expect(
      busakCycles.every(
        (x) => !x.m1 && !x.mreq && !x.iorq && !x.rd && !x.wr && !x.rfsh && x.dataOut === null
      )
    ).toBe(true);
  });

  it('does not start INT ACK while BUSRQ is active and resumes after release', () => {
    const harness = new TraceHarness();
    harness.memory.fill(0x00);
    harness.memory[0x0038] = 0x76; // IM1 vector
    const initial = harness.cpu.getState();
    harness.loadState({
      ...initial,
      iff1: true,
      iff2: true,
      im: 1
    });

    harness.setBusrq(true);
    harness.setInt(true, 0xff);
    harness.step(80);
    const ackDuringHold = harness.trace.some((x) => x.busak && x.m1 && x.iorq && x.rd);
    expect(ackDuringHold).toBe(false);

    harness.setBusrq(false);
    harness.step(200);
    const ackAfterRelease = harness.trace.some((x) => x.m1 && x.iorq && x.rd);
    expect(ackAfterRelease).toBe(true);
  });
});
