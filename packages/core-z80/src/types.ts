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
  pendingInt: boolean;
  pendingIntDataBus?: number;
  tstates: number;
  queueDepth: number;
}

// CPU へ渡す pin 入力。
export interface Z80PinsIn {
  data: number;
  wait: boolean;
  int: boolean;
  nmi: boolean;
  busrq: boolean;
  reset: boolean;
}

// CPU から出る pin 出力。
export interface Z80PinsOut {
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
}

export const Z80_IDLE_PINS_OUT: Z80PinsOut = Object.freeze({
  addr: 0,
  dataOut: null,
  m1: false,
  mreq: false,
  iorq: false,
  rd: false,
  wr: false,
  rfsh: false,
  halt: false,
  busak: false
});

export const Z80_DEFAULT_PINS_IN: Z80PinsIn = Object.freeze({
  data: 0xff,
  wait: false,
  int: false,
  nmi: false,
  busrq: false,
  reset: false
});

// CPU 実装の公開操作（pin 駆動）。
export interface Z80Core {
  reset(): void;
  tick(input: Z80PinsIn): Z80PinsOut;
  getPinsOut(): Z80PinsOut;
  getState(): CpuState;
  loadState(state: CpuState): void;
}
