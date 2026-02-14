// CPU が外部バスとやり取りする最小インターフェース。
export interface Bus {
  read8(addr: number): number;
  write8(addr: number, value: number): void;
  in8(port: number): number;
  out8(port: number, value: number): void;
  onM1?(pc: number): void;
}

export type InterruptMode = 0 | 1 | 2;

// エミュレータが保持する主レジスタ群。
export interface CpuRegisters {
  a: number;
  f: number;
  b: number;
  c: number;
  d: number;
  e: number;
  h: number;
  l: number;
  ix: number;
  iy: number;
  sp: number;
  pc: number;
  i: number;
  r: number;
}

export interface CpuShadowRegisters {
  a: number;
  f: number;
  b: number;
  c: number;
  d: number;
  e: number;
  h: number;
  l: number;
}

// 保存/復元可能な CPU 実行状態スナップショット。
export interface CpuState {
  registers: CpuRegisters;
  shadowRegisters?: CpuShadowRegisters;
  iff1: boolean;
  iff2: boolean;
  im: InterruptMode;
  halted: boolean;
  pendingNmi: boolean;
  pendingIntDataBus?: number;
  tstates: number;
  queueDepth: number;
}

// CPU 実装の公開操作。
export interface Cpu {
  reset(): void;
  stepTState(count: number): void;
  raiseInt(dataBus?: number): void;
  raiseNmi(): void;
  getState(): CpuState;
  loadState?(state: CpuState): void;
}
