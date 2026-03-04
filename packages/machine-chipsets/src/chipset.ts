import {
  Z80_DEFAULT_PINS_IN,
  Z80_IDLE_PINS_OUT,
  type CpuState,
  type Z80Core,
  type Z80PinsIn,
  type Z80PinsOut
} from '@z80emu/core-z80';

import type {
  Chipset,
  ChipsetCycleTrace,
  ChipsetReadSource,
  ChipsetSignalProvider,
  ChipsetTraceHook,
  CpuStateProvider,
  IoDevice,
  MemoryDevice,
  Pin11Device
} from './types';

function clamp8(value: number): number {
  return value & 0xff;
}

function clamp16(value: number): number {
  return value & 0xffff;
}

export class NoOpPin11Device implements Pin11Device {
  read(_port: number): number {
    return 0;
  }

  write(_port: number, _value: number): void {}
}

export interface BasicChipsetOptions {
  memory: MemoryDevice;
  io: IoDevice;
  getSignals?: ChipsetSignalProvider;
  pin11?: Pin11Device;
  onCycleTrace?: ChipsetTraceHook;
}

export class BasicChipset implements Chipset, CpuStateProvider {
  private readonly memory: MemoryDevice;

  private readonly io: IoDevice;

  private readonly getSignals: ChipsetSignalProvider;

  private readonly pin11: Pin11Device;

  private readonly onCycleTrace?: ChipsetTraceHook;

  private cpu: Z80Core | undefined;

  private lastPinsOut: Z80PinsOut = { ...Z80_IDLE_PINS_OUT };

  private prevWriteActive = false;

  private prevReadActive = false;

  private readLatch = Z80_DEFAULT_PINS_IN.data;

  private prevReadSource: ChipsetReadSource = 'none';

  private prevReadAddr = 0;

  private readonly tickInput: Z80PinsIn = {
    data: Z80_DEFAULT_PINS_IN.data,
    wait: false,
    int: false,
    nmi: false,
    busrq: false,
    reset: false
  };

  private lastIntDataBus = 0xff;

  private stepCounter = 0;

  constructor(options: BasicChipsetOptions) {
    this.memory = options.memory;
    this.io = options.io;
    this.getSignals = options.getSignals ?? (() => ({}));
    this.pin11 = options.pin11 ?? new NoOpPin11Device();
    this.onCycleTrace = options.onCycleTrace;
  }

  attachCpu(cpu: Z80Core): void {
    this.cpu = cpu;
    this.lastPinsOut = cpu.getPinsOut();
    this.prevWriteActive = false;
    this.prevReadActive = false;
    this.readLatch = Z80_DEFAULT_PINS_IN.data;
    this.prevReadSource = 'none';
    this.prevReadAddr = 0;
    this.lastIntDataBus = 0xff;
    this.stepCounter = 0;
  }

  reset(): void {
    this.cpu?.reset();
    this.lastPinsOut = this.cpu?.getPinsOut() ?? { ...Z80_IDLE_PINS_OUT };
    this.prevWriteActive = false;
    this.prevReadActive = false;
    this.readLatch = Z80_DEFAULT_PINS_IN.data;
    this.prevReadSource = 'none';
    this.prevReadAddr = 0;
    this.lastIntDataBus = 0xff;
    this.stepCounter = 0;
  }

  tick(tstates: number): void {
    this.tickInternal(tstates);
  }

  tickWithInstructionFetchWatch(tstates: number, address: number): boolean {
    return this.tickInternal(tstates, clamp16(address));
  }

  private tickInternal(tstates: number, watchM1Address?: number): boolean {
    const cpu = this.cpu;
    if (!cpu) {
      throw new Error('CPU is not attached to chipset');
    }

    const steps = Math.max(0, Math.floor(tstates));
    let matched = false;
    for (let i = 0; i < steps; i += 1) {
      this.applyWriteIfNeeded(this.lastPinsOut);

      const signals = this.getSignals();
      const resolved = this.resolveDataBus(this.lastPinsOut, signals.intDataBus);
      this.tickInput.data = resolved.data;
      this.tickInput.wait = Boolean(signals.wait);
      this.tickInput.int = Boolean(signals.int);
      this.tickInput.nmi = Boolean(signals.nmi);
      this.tickInput.busrq = Boolean(signals.busrq);
      this.tickInput.reset = Boolean(signals.reset);
      this.lastIntDataBus = clamp8(signals.intDataBus ?? 0xff);

      if (this.onCycleTrace) {
        this.emitTrace({
          step: this.stepCounter,
          pinsOut: this.lastPinsOut,
          input: {
            ...signals,
            wait: this.tickInput.wait,
            int: this.tickInput.int,
            nmi: this.tickInput.nmi,
            busrq: this.tickInput.busrq,
            reset: this.tickInput.reset,
            data: this.tickInput.data
          },
          readSource: resolved.source
        });
      }
      this.lastPinsOut = cpu.tick(this.tickInput);
      if (
        watchM1Address !== undefined &&
        this.lastPinsOut.m1 &&
        this.lastPinsOut.mreq &&
        this.lastPinsOut.rd &&
        clamp16(this.lastPinsOut.addr) === watchM1Address
      ) {
        matched = true;
      }
      this.stepCounter += 1;
    }
    return matched;
  }

  getCpuState(): CpuState {
    const cpu = this.cpu;
    if (!cpu) {
      throw new Error('CPU is not attached to chipset');
    }
    return cpu.getState();
  }

  loadCpuState(state: CpuState): void {
    const cpu = this.cpu;
    if (!cpu) {
      throw new Error('CPU is not attached to chipset');
    }
    cpu.loadState(state);
    this.lastPinsOut = cpu.getPinsOut();
  }

  getLastPinsOut(): Z80PinsOut {
    return { ...this.lastPinsOut };
  }

  getLastPinsIn(): Z80PinsIn {
    return { ...this.tickInput };
  }

  getLastIntDataBus(): number {
    return this.lastIntDataBus & 0xff;
  }

  getPin11Device(): Pin11Device {
    return this.pin11;
  }

  private resolveDataBus(pins: Z80PinsOut, intDataBus: number | undefined): { data: number; source: ChipsetReadSource } {
    const readActive = Boolean(pins.rd && (pins.mreq || pins.iorq));
    if (!readActive) {
      this.prevReadActive = false;
      this.readLatch = Z80_DEFAULT_PINS_IN.data;
      this.prevReadSource = 'none';
      return { data: Z80_DEFAULT_PINS_IN.data, source: 'none' };
    }

    const source = this.identifyReadSource(pins);
    const addr = clamp16(pins.addr);
    if (this.prevReadActive && this.prevReadSource === source && this.prevReadAddr === addr) {
      return { data: this.readLatch, source };
    }

    if (source === 'int-ack') {
      this.readLatch = clamp8(intDataBus ?? 0xff);
    } else if (source === 'memory') {
      this.readLatch = clamp8(this.memory.read8(addr));
    } else if (source === 'io') {
      this.readLatch = clamp8(this.io.in8(clamp8(addr)));
    } else {
      this.readLatch = Z80_DEFAULT_PINS_IN.data;
    }
    this.prevReadActive = true;
    this.prevReadSource = source;
    this.prevReadAddr = addr;
    return { data: this.readLatch, source };
  }

  private identifyReadSource(pins: Z80PinsOut): ChipsetReadSource {
    if (pins.m1 && pins.iorq && pins.rd) {
      return 'int-ack';
    }
    if (pins.mreq && pins.rd) {
      return 'memory';
    }
    if (pins.iorq && pins.rd) {
      return 'io';
    }
    return 'none';
  }

  private emitTrace(trace: ChipsetCycleTrace): void {
    this.onCycleTrace?.({
      step: trace.step,
      pinsOut: { ...trace.pinsOut },
      input: { ...trace.input },
      readSource: trace.readSource
    });
  }

  private applyWriteIfNeeded(pins: Z80PinsOut): void {
    const writeActive = Boolean(pins.wr && (pins.mreq || pins.iorq) && pins.dataOut !== null);
    if (writeActive && !this.prevWriteActive) {
      const value = clamp8(pins.dataOut ?? 0);
      if (pins.mreq) {
        this.memory.write8(clamp16(pins.addr), value);
      } else if (pins.iorq) {
        this.io.out8(clamp8(pins.addr), value);
      }
    }
    this.prevWriteActive = writeActive;
  }
}
