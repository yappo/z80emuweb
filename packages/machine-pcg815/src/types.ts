import type { CpuState } from '@z80emu/core-z80';
import type { MonitorRuntimeSnapshot } from '@z80emu/firmware-monitor';

// 永続化用スナップショットの現行フォーマット。
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
    kanaMode: boolean;
    kanaComposeBuffer: string;
    romBankSelect: number;
    expansionControl: number;
    runtime: MonitorRuntimeSnapshot;
  };
  timestampTStates: number;
}

// マシン本体が外部へ公開する最小操作。
export interface MachinePCG815 {
  tick(tstates: number): void;
  setKeyState(code: string, pressed: boolean): void;
  setKanaMode(enabled: boolean): void;
  getKanaMode(): boolean;
  getFrameBuffer(): Uint8Array;
  reset(cold: boolean): void;
}

// マシン初期化オプション。
export interface PCG815MachineOptions {
  rom?: Uint8Array;
  strictCpuOpcodes?: boolean;
}
