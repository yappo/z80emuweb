import type { CpuState, Z80Core } from '@z80emu/core-z80';

export interface MemoryDevice {
  read8(addr: number): number;
  write8(addr: number, value: number): void;
}

export interface IoDevice {
  in8(port: number): number;
  out8(port: number, value: number): void;
}

export interface ChipsetInputSignals {
  wait: boolean;
  int: boolean;
  nmi: boolean;
  busrq: boolean;
  reset: boolean;
  intDataBus?: number;
}

export type ChipsetSignalProvider = () => Partial<ChipsetInputSignals>;

export interface Pin11Device {
  read(port: number): number;
  write(port: number, value: number): void;
}

export type ChipsetReadSource = 'none' | 'memory' | 'io' | 'int-ack';

export interface ChipsetCycleTrace {
  step: number;
  pinsOut: Readonly<{
    addr: number;
    dataOut: number | null;
    m1: boolean;
    mreq: boolean;
    iorq: boolean;
    rd: boolean;
    wr: boolean;
    rfsh: boolean;
    halt: boolean;
    busak: boolean;
  }>;
  input: Readonly<ChipsetInputSignals & { data: number }>;
  readSource: ChipsetReadSource;
}

export type ChipsetTraceHook = (trace: ChipsetCycleTrace) => void;

export interface Chipset {
  attachCpu(cpu: Z80Core): void;
  tick(tstates: number): void;
}

export interface CpuStateProvider {
  getCpuState(): CpuState;
  loadCpuState(state: CpuState): void;
}
