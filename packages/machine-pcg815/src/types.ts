import type { CpuState, Z80PinsOut } from '@z80emu/core-z80';
import type { MonitorRuntimeSnapshot } from '@z80emu/firmware-monitor';

export type PCG815ExecutionBackend = 'z80-firmware' | 'ts-compat';
export type PCG815ExecutionDomain = 'firmware' | 'user-program';

export interface FirmwareIoStats {
  queuedBytes: number;
  inReads: number;
  consumedBytes: number;
  outWrites: number;
  eotWrites: number;
  pendingBytes: number;
}

export interface BasicEngineStatus {
  entry: number;
  romBank: number;
  activeRomBank: number;
  basicRamStart: number;
  basicRamEnd: number;
  executionBackend: PCG815ExecutionBackend;
  executionDomain: PCG815ExecutionDomain;
}

export interface CpuPinsInSnapshot {
  wait: boolean;
  int: boolean;
  nmi: boolean;
  busrq: boolean;
  reset: boolean;
  intDataBus: number;
  data: number;
}

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
    executionDomain?: PCG815ExecutionDomain;
    executionBackend?: PCG815ExecutionBackend;
    firmwareReturnAddress?: number;
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
  getExecutionBackend(): PCG815ExecutionBackend;
  getExecutionDomain(): PCG815ExecutionDomain;
  setExecutionDomain(domain: PCG815ExecutionDomain): void;
  setRuntimePumpEnabled(enabled: boolean): void;
  getFirmwareReturnAddress(): number;
  setFirmwareReturnAddress(address: number): void;
  getActiveRomBank(): number;
  getActiveExRomBank(): number;
  getActiveRamBank(): number;
  drainAsciiQueue(): number[];
  isRuntimeProgramRunning(): boolean;
  getFrameBuffer(): Uint8Array;
  getFrameRevision(): number;
  getCpuState(): CpuState;
  getCpuPinsOut(): Z80PinsOut;
  getCpuPinsIn(): CpuPinsInSnapshot;
  reset(cold: boolean): void;
  loadProgram(bytes: Uint8Array | readonly number[], origin: number): void;
  setProgramCounter(entry: number): void;
  setStackPointer(value: number): void;
  getRamRange(): { start: number; end: number };
  runBasicInterpreter(
    bytes: readonly number[],
    options?: {
      appendEot?: boolean;
      maxTStates?: number;
    }
  ): void;
  getBasicEngineStatus(): BasicEngineStatus;
  runFirmwareInputBridge(
    bytes: readonly number[],
    options?: {
      appendEot?: boolean;
      maxTStates?: number;
      entryAddress?: number;
      programBinary?: Uint8Array | readonly number[];
    }
  ): void;
  enqueueFirmwareInput(bytes: readonly number[]): void;
  clearFirmwareInput(): void;
  getFirmwareIoStats(): FirmwareIoStats;
  resetFirmwareIoStats(): void;
}

// マシン初期化オプション。
export interface PCG815MachineOptions {
  rom?: Uint8Array;
  strictCpuOpcodes?: boolean;
  executionBackend?: PCG815ExecutionBackend;
  firmwareReturnAddress?: number;
  basicInterpreterRomImage?: Uint8Array;
  basicInterpreterEntry?: number;
  basicRamStart?: number;
  basicRamEnd?: number;
  basicInterpreterRomBank?: number;
}
