export interface Bus {
  read8(addr: number): number;
  write8(addr: number, value: number): void;
  in8(port: number): number;
  out8(port: number, value: number): void;
  onM1?(pc: number): void;
}

export type InterruptMode = 0 | 1 | 2;

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

export interface CpuState {
  registers: CpuRegisters;
  iff1: boolean;
  iff2: boolean;
  im: InterruptMode;
  halted: boolean;
  pendingNmi: boolean;
  pendingIntDataBus?: number;
  tstates: number;
  queueDepth: number;
}

export interface Cpu {
  reset(): void;
  stepTState(count: number): void;
  raiseInt(dataBus?: number): void;
  raiseNmi(): void;
  getState(): CpuState;
  loadState?(state: CpuState): void;
}
