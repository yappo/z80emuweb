import type { CpuState } from '@z80emu/core-z80';
import type { MonitorRuntimeSnapshot } from '@z80emu/firmware-monitor';

export interface SnapshotV1 {
  version: 1;
  cpu: CpuState;
  ram: number[];
  vram: {
    text: number[];
    icons: number[];
    cursor: number;
  };
  io: {
    selectedKeyRow: number;
    keyboardRows: number[];
    asciiQueue: number[];
    romBankSelect: number;
    expansionControl: number;
    runtime: MonitorRuntimeSnapshot;
  };
  timestampTStates: number;
}

export interface MachinePCG815 {
  tick(tstates: number): void;
  setKeyState(code: string, pressed: boolean): void;
  getFrameBuffer(): Uint8Array;
  reset(cold: boolean): void;
}

export interface PCG815MachineOptions {
  rom?: Uint8Array;
  strictCpuOpcodes?: boolean;
}
