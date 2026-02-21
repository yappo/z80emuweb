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

  private prevReadSignature: string | undefined;

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
    this.prevReadSignature = undefined;
    this.stepCounter = 0;
  }

  reset(): void {
    this.cpu?.reset();
    this.lastPinsOut = this.cpu?.getPinsOut() ?? { ...Z80_IDLE_PINS_OUT };
    this.prevWriteActive = false;
    this.prevReadActive = false;
    this.readLatch = Z80_DEFAULT_PINS_IN.data;
    this.prevReadSignature = undefined;
    this.stepCounter = 0;
  }

  tick(tstates: number): void {
    const cpu = this.cpu;
    if (!cpu) {
      throw new Error('CPU is not attached to chipset');
    }

    const steps = Math.max(0, Math.floor(tstates));
    for (let i = 0; i < steps; i += 1) {
      this.applyWriteIfNeeded(this.lastPinsOut);

      const signals = this.getSignals();
      const resolved = this.resolveDataBus(this.lastPinsOut, signals.intDataBus);
      const input: Z80PinsIn = {
        data: resolved.data,
        wait: Boolean(signals.wait),
        int: Boolean(signals.int),
        nmi: Boolean(signals.nmi),
        busrq: Boolean(signals.busrq),
        reset: Boolean(signals.reset)
      };
      this.emitTrace({
        step: this.stepCounter,
        pinsOut: this.lastPinsOut,
        input: {
          ...signals,
          wait: Boolean(signals.wait),
          int: Boolean(signals.int),
          nmi: Boolean(signals.nmi),
          busrq: Boolean(signals.busrq),
          reset: Boolean(signals.reset),
          data: input.data
        },
        readSource: resolved.source
      });
      this.lastPinsOut = cpu.tick(input);
      this.stepCounter += 1;
    }
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

  getPin11Device(): Pin11Device {
    return this.pin11;
  }

  private resolveDataBus(pins: Z80PinsOut, intDataBus: number | undefined): { data: number; source: ChipsetReadSource } {
    const readActive = Boolean(pins.rd && (pins.mreq || pins.iorq));
    if (!readActive) {
      this.prevReadActive = false;
      this.readLatch = Z80_DEFAULT_PINS_IN.data;
      this.prevReadSignature = undefined;
      return { data: Z80_DEFAULT_PINS_IN.data, source: 'none' };
    }

    const source = this.identifyReadSource(pins);
    const signature = `${source}:${clamp16(pins.addr)}`;
    if (this.prevReadActive && this.prevReadSignature === signature) {
      return { data: this.readLatch, source: this.identifyReadSource(pins) };
    }

    if (source === 'int-ack') {
      this.readLatch = clamp8(intDataBus ?? 0xff);
    } else if (source === 'memory') {
      this.readLatch = clamp8(this.memory.read8(clamp16(pins.addr)));
    } else if (source === 'io') {
      this.readLatch = clamp8(this.io.in8(clamp8(pins.addr)));
    } else {
      this.readLatch = Z80_DEFAULT_PINS_IN.data;
    }
    this.prevReadActive = true;
    this.prevReadSignature = signature;
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
