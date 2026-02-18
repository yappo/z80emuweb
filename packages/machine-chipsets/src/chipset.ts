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
  ChipsetSignalProvider,
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
}

export class BasicChipset implements Chipset, CpuStateProvider {
  private readonly memory: MemoryDevice;

  private readonly io: IoDevice;

  private readonly getSignals: ChipsetSignalProvider;

  private readonly pin11: Pin11Device;

  private cpu: Z80Core | undefined;

  private lastPinsOut: Z80PinsOut = { ...Z80_IDLE_PINS_OUT };

  private prevWriteActive = false;

  constructor(options: BasicChipsetOptions) {
    this.memory = options.memory;
    this.io = options.io;
    this.getSignals = options.getSignals ?? (() => ({}));
    this.pin11 = options.pin11 ?? new NoOpPin11Device();
  }

  attachCpu(cpu: Z80Core): void {
    this.cpu = cpu;
    this.lastPinsOut = cpu.getPinsOut();
    this.prevWriteActive = false;
  }

  reset(): void {
    this.cpu?.reset();
    this.lastPinsOut = this.cpu?.getPinsOut() ?? { ...Z80_IDLE_PINS_OUT };
    this.prevWriteActive = false;
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
      const input: Z80PinsIn = {
        data: this.resolveDataBus(this.lastPinsOut, signals.intDataBus),
        wait: Boolean(signals.wait),
        int: Boolean(signals.int),
        nmi: Boolean(signals.nmi),
        busrq: Boolean(signals.busrq),
        reset: Boolean(signals.reset)
      };
      this.lastPinsOut = cpu.tick(input);
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

  private resolveDataBus(pins: Z80PinsOut, intDataBus: number | undefined): number {
    if (pins.m1 && pins.iorq && pins.rd) {
      return clamp8(intDataBus ?? 0xff);
    }
    if (pins.mreq && pins.rd) {
      return clamp8(this.memory.read8(clamp16(pins.addr)));
    }
    if (pins.iorq && pins.rd) {
      return clamp8(this.io.in8(clamp8(pins.addr)));
    }
    return Z80_DEFAULT_PINS_IN.data;
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
