import {
  FLAG_C,
  FLAG_H,
  FLAG_N,
  FLAG_PV,
  FLAG_S,
  FLAG_X,
  FLAG_Y,
  FLAG_Z,
  parity8
} from './flags';
import type { Bus, Cpu, CpuRegisters, CpuShadowRegisters, CpuState, InterruptMode } from './types';

type IndexMode = 'HL' | 'IX' | 'IY';
type TStateOp = () => void;
type RotateOp = 'RLC' | 'RL' | 'RRC' | 'RR' | 'SLA' | 'SRA' | 'SLL' | 'SRL';
type Alu8Op = 'ADD' | 'ADC' | 'SUB' | 'SBC' | 'AND' | 'XOR' | 'OR' | 'CP';

export interface Z80CpuOptions {
  strictUnsupportedOpcodes?: boolean;
  onUnsupportedOpcode?: (pc: number, opcode: number, prefix?: string) => void;
}

const RST_VECTOR_BY_OPCODE = new Map<number, number>([
  [0xc7, 0x00],
  [0xcf, 0x08],
  [0xd7, 0x10],
  [0xdf, 0x18],
  [0xe7, 0x20],
  [0xef, 0x28],
  [0xf7, 0x30],
  [0xff, 0x38]
]);

// 値を 8/16bit に収める基本ユーティリティ。
function clamp8(value: number): number {
  return value & 0xff;
}

function clamp16(value: number): number {
  return value & 0xffff;
}

function signExtend8(value: number): number {
  return (value & 0x80) !== 0 ? value - 0x100 : value;
}

function halfCarryAdd8(left: number, right: number, carry: number): boolean {
  return (((left & 0x0f) + (right & 0x0f) + carry) & 0x10) !== 0;
}

function halfCarrySub8(left: number, right: number, carry: number): boolean {
  return (((left & 0x0f) - (right & 0x0f) - carry) & 0x10) !== 0;
}

function overflowAdd8(left: number, right: number, result: number): boolean {
  return (((left ^ result) & (right ^ result) & 0x80) !== 0);
}

function overflowSub8(left: number, right: number, result: number): boolean {
  return (((left ^ right) & (left ^ result) & 0x80) !== 0);
}

export class Z80Cpu implements Cpu {
  private readonly bus: Bus;

  private readonly options: Z80CpuOptions;

  // 1 T-state ごとに消費するマイクロオペレーション列。
  private readonly queue: TStateOp[] = [];

  private readonly regs: CpuRegisters = {
    a: 0,
    f: 0,
    b: 0,
    c: 0,
    d: 0,
    e: 0,
    h: 0,
    l: 0,
    ix: 0,
    iy: 0,
    sp: 0xffff,
    pc: 0,
    i: 0,
    r: 0
  };

  private readonly shadowRegs: CpuShadowRegisters = {
    a: 0,
    f: 0,
    b: 0,
    c: 0,
    d: 0,
    e: 0,
    h: 0,
    l: 0
  };

  private iff1 = false;

  private iff2 = false;

  private im: InterruptMode = 1;

  private halted = false;

  private pendingIntDataBus: number | undefined;

  private pendingNmi = false;

  private deferInterruptAcceptance = false;

  private tstates = 0;

  constructor(bus: Bus, options?: Z80CpuOptions) {
    this.bus = bus;
    this.options = options ?? {};
  }

  reset(): void {
    this.queue.length = 0;
    this.regs.a = 0;
    this.regs.f = 0;
    this.regs.b = 0;
    this.regs.c = 0;
    this.regs.d = 0;
    this.regs.e = 0;
    this.regs.h = 0;
    this.regs.l = 0;
    this.regs.ix = 0;
    this.regs.iy = 0;
    this.regs.sp = 0xffff;
    this.regs.pc = 0;
    this.regs.i = 0;
    this.regs.r = 0;
    this.shadowRegs.a = 0;
    this.shadowRegs.f = 0;
    this.shadowRegs.b = 0;
    this.shadowRegs.c = 0;
    this.shadowRegs.d = 0;
    this.shadowRegs.e = 0;
    this.shadowRegs.h = 0;
    this.shadowRegs.l = 0;
    this.iff1 = false;
    this.iff2 = false;
    this.im = 1;
    this.halted = false;
    this.pendingIntDataBus = undefined;
    this.pendingNmi = false;
    this.deferInterruptAcceptance = false;
    this.tstates = 0;
  }

  stepTState(count: number): void {
    for (let i = 0; i < count; i += 1) {
      // 命令デコードは queue が空になったタイミングでのみ行う。
      if (this.queue.length === 0) {
        this.scheduleNextInstruction();
      }
      const next = this.queue.shift();
      if (next === undefined) {
        this.tstates += 1;
        continue;
      }
      next();
      this.tstates += 1;
    }
  }

  raiseInt(dataBus = 0xff): void {
    this.pendingIntDataBus = clamp8(dataBus);
  }

  raiseNmi(): void {
    this.pendingNmi = true;
  }

  getState(): CpuState {
    return {
      registers: { ...this.regs },
      shadowRegisters: { ...this.shadowRegs },
      iff1: this.iff1,
      iff2: this.iff2,
      im: this.im,
      halted: this.halted,
      pendingNmi: this.pendingNmi,
      pendingIntDataBus: this.pendingIntDataBus,
      tstates: this.tstates,
      queueDepth: this.queue.length
    };
  }

  loadState(state: CpuState): void {
    this.queue.length = 0;
    this.regs.a = state.registers.a & 0xff;
    this.regs.f = state.registers.f & 0xff;
    this.regs.b = state.registers.b & 0xff;
    this.regs.c = state.registers.c & 0xff;
    this.regs.d = state.registers.d & 0xff;
    this.regs.e = state.registers.e & 0xff;
    this.regs.h = state.registers.h & 0xff;
    this.regs.l = state.registers.l & 0xff;
    this.regs.ix = state.registers.ix & 0xffff;
    this.regs.iy = state.registers.iy & 0xffff;
    this.regs.sp = state.registers.sp & 0xffff;
    this.regs.pc = state.registers.pc & 0xffff;
    this.regs.i = state.registers.i & 0xff;
    this.regs.r = state.registers.r & 0xff;
    this.shadowRegs.a = (state.shadowRegisters?.a ?? 0) & 0xff;
    this.shadowRegs.f = (state.shadowRegisters?.f ?? 0) & 0xff;
    this.shadowRegs.b = (state.shadowRegisters?.b ?? 0) & 0xff;
    this.shadowRegs.c = (state.shadowRegisters?.c ?? 0) & 0xff;
    this.shadowRegs.d = (state.shadowRegisters?.d ?? 0) & 0xff;
    this.shadowRegs.e = (state.shadowRegisters?.e ?? 0) & 0xff;
    this.shadowRegs.h = (state.shadowRegisters?.h ?? 0) & 0xff;
    this.shadowRegs.l = (state.shadowRegisters?.l ?? 0) & 0xff;
    this.iff1 = state.iff1;
    this.iff2 = state.iff2;
    this.im = state.im;
    this.halted = state.halted;
    this.pendingNmi = state.pendingNmi;
    this.pendingIntDataBus = state.pendingIntDataBus;
    this.deferInterruptAcceptance = false;
    this.tstates = state.tstates;
  }

  private enqueueInternal(action?: () => void): void {
    this.queue.push(() => {
      action?.();
    });
  }

  private enqueueIdle(count: number): void {
    for (let i = 0; i < count; i += 1) {
      this.queue.push(() => undefined);
    }
  }

  private enqueueReadPc(target: (value: number) => void): void {
    this.enqueueIdle(2);
    this.queue.push(() => {
      const value = this.bus.read8(this.regs.pc);
      this.regs.pc = clamp16(this.regs.pc + 1);
      target(clamp8(value));
    });
  }

  private enqueueReadMem(addr: () => number, target: (value: number) => void): void {
    this.enqueueIdle(2);
    this.queue.push(() => {
      const value = this.bus.read8(clamp16(addr()));
      target(clamp8(value));
    });
  }

  private enqueueWriteMem(addr: () => number, value: () => number): void {
    this.enqueueIdle(2);
    this.queue.push(() => {
      this.bus.write8(clamp16(addr()), clamp8(value()));
    });
  }

  private enqueueReadIo(port: () => number, target: (value: number) => void): void {
    this.enqueueIdle(3);
    this.queue.push(() => {
      const value = this.bus.in8(clamp8(port()));
      target(clamp8(value));
    });
  }

  private enqueueWriteIo(port: () => number, value: () => number): void {
    this.enqueueIdle(3);
    this.queue.push(() => {
      this.bus.out8(clamp8(port()), clamp8(value()));
    });
  }

  private enqueueFetchOpcode(target: (opcode: number) => void): void {
    this.enqueueIdle(3);
    this.queue.push(() => {
      const pc = this.regs.pc;
      const opcode = this.bus.read8(pc);
      this.bus.onM1?.(pc);
      // R レジスタは命令フェッチごとに下位 7bit を進める。
      this.bumpR();
      this.regs.pc = clamp16(this.regs.pc + 1);
      target(clamp8(opcode));
    });
  }

  private enqueuePushWord(value: () => number): void {
    let word = 0;
    this.enqueueInternal(() => {
      word = clamp16(value());
    });

    this.enqueueInternal(() => {
      this.regs.sp = clamp16(this.regs.sp - 1);
    });
    this.enqueueWriteMem(() => this.regs.sp, () => (word >>> 8) & 0xff);

    this.enqueueInternal(() => {
      this.regs.sp = clamp16(this.regs.sp - 1);
    });
    this.enqueueWriteMem(() => this.regs.sp, () => word & 0xff);
  }

  private enqueuePopWord(target: (word: number) => void): void {
    let low = 0;
    let high = 0;
    this.enqueueReadMem(() => this.regs.sp, (value) => {
      low = value;
    });
    this.enqueueInternal(() => {
      this.regs.sp = clamp16(this.regs.sp + 1);
    });

    this.enqueueReadMem(() => this.regs.sp, (value) => {
      high = value;
    });
    this.enqueueInternal(() => {
      this.regs.sp = clamp16(this.regs.sp + 1);
      target((high << 8) | low);
    });
  }

  private scheduleNextInstruction(): void {
    // 割り込み受理の優先順位は NMI > マスク可能割り込み > 通常命令。
    if (this.pendingNmi) {
      this.scheduleNmi();
      return;
    }

    const interruptDeferred = this.deferInterruptAcceptance;
    if (this.deferInterruptAcceptance) {
      this.deferInterruptAcceptance = false;
    }

    if (!interruptDeferred && this.pendingIntDataBus !== undefined && this.iff1) {
      this.scheduleMaskableInterrupt();
      return;
    }

    if (this.halted) {
      this.scheduleHaltCycle();
      return;
    }

    this.enqueueFetchOpcode((opcode) => {
      this.decodeOpcode(opcode, 'HL');
    });
  }

  private scheduleHaltCycle(): void {
    const intPending = this.pendingNmi || (this.pendingIntDataBus !== undefined && this.iff1);
    if (intPending) {
      this.halted = false;
      this.scheduleNextInstruction();
      return;
    }
    this.enqueueIdle(4);
  }

  private scheduleNmi(): void {
    this.pendingNmi = false;
    this.halted = false;
    this.enqueueIdle(5);
    this.enqueuePushWord(() => this.regs.pc);
    this.enqueueInternal(() => {
      this.iff2 = this.iff1;
      this.iff1 = false;
      this.regs.pc = 0x0066;
    });
  }

  private scheduleMaskableInterrupt(): void {
    const dataBus = this.pendingIntDataBus ?? 0xff;
    this.pendingIntDataBus = undefined;
    this.halted = false;
    this.iff1 = false;
    this.iff2 = false;

    this.enqueueIdle(7);
    this.enqueuePushWord(() => this.regs.pc);
    this.enqueueInternal(() => {
      // IM2 は (I:dataBus) ベクタ参照、それ以外は IM0/IM1 の固定挙動へ。
      if (this.im === 2) {
        const vector = ((this.regs.i << 8) | dataBus) & 0xfffe;
        const low = this.bus.read8(vector);
        const high = this.bus.read8((vector + 1) & 0xffff);
        this.regs.pc = ((high << 8) | low) & 0xffff;
        return;
      }

      if (this.im === 0) {
        this.regs.pc = dataBus & 0x38;
        return;
      }

      this.regs.pc = 0x0038;
    });
  }

  private decodeOpcode(opcode: number, indexMode: IndexMode): void {
    // RST は opcode 値から直接ベクタ決定できるので先に処理する。
    const rstVector = RST_VECTOR_BY_OPCODE.get(opcode);
    if (rstVector !== undefined) {
      this.enqueuePushWord(() => this.regs.pc);
      this.enqueueInternal(() => {
        this.regs.pc = rstVector;
      });
      return;
    }

    // xxxxx110b は「8bit レジスタ、またはメモリ間接先へ即値を代入する」命令群。
    // regCode=6 の場合はレジスタではなく (HL)/(IX+d)/(IY+d) を対象にする。
    if ((opcode & 0xc7) === 0x06) {
      this.decodeLdRImmediate(opcode, indexMode);
      return;
    }

    // xxxxx100b は「8bit 値を 1 増やす」命令群。
    if ((opcode & 0xc7) === 0x04) {
      this.decodeIncReg(opcode, indexMode);
      return;
    }

    // xxxxx101b は「8bit 値を 1 減らす」命令群。
    if ((opcode & 0xc7) === 0x05) {
      this.decodeDecReg(opcode, indexMode);
      return;
    }

    // 01dddsssb は「8bit レジスタ/間接メモリ間の転送」命令群。
    // 0x76 (HALT) は switch 側で先に個別処理する。
    if ((opcode & 0xc0) === 0x40 && opcode !== 0x76) {
      this.decodeLdRegReg(opcode, indexMode);
      return;
    }

    // 10xxxyyyb は「A に対する 8bit ALU 演算（r/(HL)/(IX+d)/(IY+d)）」命令群。
    if ((opcode & 0xc0) === 0x80) {
      this.decodeAluReg(opcode, indexMode);
      return;
    }

    // ここから先は実装済み opcode を個別に分岐する。
    // コメントは「命令ニーモニック / 引数 / 実装上の要点」を記載する。
    switch (opcode) {
      case 0x00:
        // NOP: 何も変更せず、1 命令ぶんの時間だけ消費する。
        return;
      case 0x76:
        // HALT: 割り込みが入るまで命令フェッチを停止する。
        this.enqueueInternal(() => {
          this.halted = true;
        });
        return;
      case 0xdd:
        // プレフィクス DD: 後続命令で HL/H/L を IX/IXH/IXL とみなして実行する。
        this.enqueueFetchOpcode((next) => {
          this.decodeOpcode(next, 'IX');
        });
        return;
      case 0xfd:
        // プレフィクス FD: 後続命令で HL/H/L を IY/IYH/IYL とみなして実行する。
        this.enqueueFetchOpcode((next) => {
          this.decodeOpcode(next, 'IY');
        });
        return;
      case 0xed:
        // プレフィクス ED: 拡張命令群へ分岐する（本実装は一部の命令のみ対応）。
        this.enqueueFetchOpcode((next) => {
          this.decodeED(next);
        });
        return;
      case 0xcb:
        // プレフィクス CB: ビットテスト・ビット更新・ローテート命令群へ分岐する。
        if (indexMode === 'HL') {
          this.enqueueFetchOpcode((next) => {
            this.decodeCB(next, 'HL', 0);
          });
          return;
        }
        this.decodeIndexedCB(indexMode);
        return;
      case 0x01:
        // LD BC,nn: 16bit 即値 nn を B/C レジスタ対へ代入する。
        this.decodeLdPairImmediate('BC');
        return;
      case 0x02:
        // LD (BC),A
        this.enqueueWriteMem(() => this.getPair('BC'), () => this.regs.a);
        return;
      case 0x03:
        // INC BC
        this.decodeIncPair('BC');
        return;
      case 0x07:
        // RLCA
        this.enqueueInternal(() => {
          const carry = (this.regs.a >>> 7) & 1;
          this.regs.a = clamp8((this.regs.a << 1) | carry);
          this.regs.f = (this.regs.f & (FLAG_S | FLAG_Z | FLAG_PV)) | (this.regs.a & (FLAG_X | FLAG_Y)) | (carry ? FLAG_C : 0);
        });
        return;
      case 0x08:
        // EX AF,AF'
        this.enqueueInternal(() => {
          const a = this.regs.a;
          const f = this.regs.f;
          this.regs.a = this.shadowRegs.a;
          this.regs.f = this.shadowRegs.f;
          this.shadowRegs.a = a;
          this.shadowRegs.f = f;
        });
        return;
      case 0x09:
        // ADD HL,BC / ADD IX,BC / ADD IY,BC
        this.decodeAddHlPair(indexMode, 'BC');
        return;
      case 0x0a:
        // LD A,(BC)
        this.enqueueReadMem(() => this.getPair('BC'), (value) => {
          this.regs.a = value;
        });
        return;
      case 0x0b:
        // DEC BC
        this.decodeDecPair('BC');
        return;
      case 0x0f:
        // RRCA
        this.enqueueInternal(() => {
          const carry = this.regs.a & 1;
          this.regs.a = clamp8((this.regs.a >>> 1) | (carry << 7));
          this.regs.f = (this.regs.f & (FLAG_S | FLAG_Z | FLAG_PV)) | (this.regs.a & (FLAG_X | FLAG_Y)) | (carry ? FLAG_C : 0);
        });
        return;
      case 0x10:
        // DJNZ e
        this.decodeDjnz();
        return;
      case 0x11:
        // LD DE,nn: 16bit 即値 nn を D/E レジスタ対へ代入する。
        this.decodeLdPairImmediate('DE');
        return;
      case 0x12:
        // LD (DE),A
        this.enqueueWriteMem(() => this.getPair('DE'), () => this.regs.a);
        return;
      case 0x13:
        // INC DE
        this.decodeIncPair('DE');
        return;
      case 0x17:
        // RLA
        this.enqueueInternal(() => {
          const carryIn = (this.regs.f & FLAG_C) !== 0 ? 1 : 0;
          const carryOut = (this.regs.a >>> 7) & 1;
          this.regs.a = clamp8((this.regs.a << 1) | carryIn);
          this.regs.f = (this.regs.f & (FLAG_S | FLAG_Z | FLAG_PV)) | (this.regs.a & (FLAG_X | FLAG_Y)) | (carryOut ? FLAG_C : 0);
        });
        return;
      case 0x19:
        // ADD HL,DE / ADD IX,DE / ADD IY,DE
        this.decodeAddHlPair(indexMode, 'DE');
        return;
      case 0x1a:
        // LD A,(DE)
        this.enqueueReadMem(() => this.getPair('DE'), (value) => {
          this.regs.a = value;
        });
        return;
      case 0x1b:
        // DEC DE
        this.decodeDecPair('DE');
        return;
      case 0x1f:
        // RRA
        this.enqueueInternal(() => {
          const carryIn = (this.regs.f & FLAG_C) !== 0 ? 1 : 0;
          const carryOut = this.regs.a & 1;
          this.regs.a = clamp8((this.regs.a >>> 1) | (carryIn << 7));
          this.regs.f = (this.regs.f & (FLAG_S | FLAG_Z | FLAG_PV)) | (this.regs.a & (FLAG_X | FLAG_Y)) | (carryOut ? FLAG_C : 0);
        });
        return;
      case 0x21:
        // LD HL,nn / LD IX,nn / LD IY,nn: 16bit 即値 nn をインデックス系レジスタ対へ代入する。
        this.decodeLdPairImmediate(indexMode === 'HL' ? 'HL' : indexMode);
        return;
      case 0x22:
        // LD (nn),HL / LD (nn),IX / LD (nn),IY
        this.decodeLdAbsoluteFromPair(indexMode === 'HL' ? 'HL' : indexMode);
        return;
      case 0x31:
        // LD SP,nn: 16bit 即値 nn をスタックポインタへ代入する。
        this.decodeLdPairImmediate('SP');
        return;
      case 0x27:
        // DAA
        this.enqueueInternal(() => {
          this.regs.a = this.applyDaa(this.regs.a);
        });
        return;
      case 0x29:
        // ADD HL,HL / ADD IX,IX / ADD IY,IY
        this.decodeAddHlPair(indexMode, indexMode === 'HL' ? 'HL' : indexMode);
        return;
      case 0x2a:
        // LD HL,(nn) / LD IX,(nn) / LD IY,(nn)
        this.decodeLdPairFromAbsolute(indexMode === 'HL' ? 'HL' : indexMode);
        return;
      case 0x2f:
        // CPL
        this.enqueueInternal(() => {
          this.regs.a = clamp8(~this.regs.a);
          this.regs.f = (this.regs.f & (FLAG_S | FLAG_Z | FLAG_PV | FLAG_C)) | FLAG_H | FLAG_N | (this.regs.a & (FLAG_X | FLAG_Y));
        });
        return;
      case 0x33:
        // INC SP
        this.decodeIncPair('SP');
        return;
      case 0x37:
        // SCF
        this.enqueueInternal(() => {
          this.regs.f = (this.regs.f & (FLAG_S | FLAG_Z | FLAG_PV)) | (this.regs.a & (FLAG_X | FLAG_Y)) | FLAG_C;
        });
        return;
      case 0x39:
        // ADD HL,SP / ADD IX,SP / ADD IY,SP
        this.decodeAddHlPair(indexMode, 'SP');
        return;
      case 0x3b:
        // DEC SP
        this.decodeDecPair('SP');
        return;
      case 0x3f:
        // CCF
        this.enqueueInternal(() => {
          const carry = (this.regs.f & FLAG_C) !== 0;
          this.regs.f =
            (this.regs.f & (FLAG_S | FLAG_Z | FLAG_PV)) |
            (this.regs.a & (FLAG_X | FLAG_Y)) |
            (carry ? FLAG_H : 0) |
            (carry ? 0 : FLAG_C);
        });
        return;
      case 0x23:
        // INC HL / INC IX / INC IY: 16bit レジスタ対を 1 増やす。
        this.enqueueInternal(() => {
          const value = clamp16(this.getPair(indexMode === 'HL' ? 'HL' : indexMode) + 1);
          this.setPair(indexMode === 'HL' ? 'HL' : indexMode, value);
        });
        return;
      case 0x2b:
        // DEC HL / DEC IX / DEC IY: 16bit レジスタ対を 1 減らす。
        this.enqueueInternal(() => {
          const value = clamp16(this.getPair(indexMode === 'HL' ? 'HL' : indexMode) - 1);
          this.setPair(indexMode === 'HL' ? 'HL' : indexMode, value);
        });
        return;
      case 0x3a:
        // LD A,(nn): アドレス nn の 1 バイトを読み取り、A レジスタへ格納する。
        this.decodeLdAFromAbsolute();
        return;
      case 0x32:
        // LD (nn),A: A レジスタの値をアドレス nn へ書き込む。
        this.decodeLdAbsoluteFromA();
        return;
      case 0x7e:
        // LD A,(HL) / LD A,(IX+d) / LD A,(IY+d): 間接先メモリの 1 バイトを A へ読み込む。
        this.decodeLdAFromPointer(indexMode);
        return;
      case 0x77:
        // LD (HL),A / LD (IX+d),A / LD (IY+d),A: A の 1 バイトを間接先メモリへ書き込む。
        this.decodeLdPointerFromA(indexMode);
        return;
      case 0x36:
        // LD (HL),n / LD (IX+d),n / LD (IY+d),n: 8bit 即値 n を間接先メモリへ書き込む。
        this.decodeLdPointerImmediate(indexMode);
        return;
      case 0x3e:
        // LD A,n: 8bit 即値 n を A レジスタへ代入する。
        this.enqueueReadPc((value) => {
          this.regs.a = value;
        });
        return;
      case 0xaf:
        // XOR A: A と A の排他的論理和を取り、結果 0 を A に入れて対応フラグを更新する。
        this.enqueueInternal(() => {
          this.regs.a = 0;
          this.regs.f = FLAG_Z | FLAG_PV;
        });
        return;
      case 0xb7:
        // OR A: A と A の論理和を評価し、A の値は保ったまま状態フラグを再計算する。
        this.enqueueInternal(() => {
          const value = this.regs.a;
          this.regs.f = this.getSzxyParityFlags(value);
        });
        return;
      case 0xe3:
        // EX (SP),HL / EX (SP),IX / EX (SP),IY
        this.decodeExSpWithPair(indexMode === 'HL' ? 'HL' : indexMode);
        return;
      case 0xc6:
        // ADD A,n: A に 8bit 即値 n を加算し、結果を A に格納する。
        this.enqueueReadPc((value) => {
          this.addToA(value, false);
        });
        return;
      case 0xce:
        // ADC A,n: A + n + キャリーフラグの値を計算し、結果を A に格納する。
        this.enqueueReadPc((value) => {
          this.addToA(value, (this.regs.f & FLAG_C) !== 0);
        });
        return;
      case 0xd6:
        // SUB n: A から 8bit 即値 n を減算し、結果を A に格納する。
        this.enqueueReadPc((value) => {
          this.subFromA(value, false);
        });
        return;
      case 0xde:
        // SBC A,n: A から n とキャリーフラグ分を減算し、結果を A に格納する。
        this.enqueueReadPc((value) => {
          this.subFromA(value, (this.regs.f & FLAG_C) !== 0);
        });
        return;
      case 0xfe:
        // CP n: A - n を比較用に計算し、A は変更せずフラグだけを更新する。
        this.enqueueReadPc((value) => {
          this.compareWithA(value);
        });
        return;
      case 0x18:
        // JR e: 次の signed 8bit オフセット e を PC に加えて相対ジャンプする。
        this.decodeJr(true);
        return;
      case 0x20:
        // JR NZ,e: ゼロフラグが 0 の場合だけ相対ジャンプする。
        this.decodeJr((this.regs.f & FLAG_Z) === 0);
        return;
      case 0x28:
        // JR Z,e: ゼロフラグが 1 の場合だけ相対ジャンプする。
        this.decodeJr((this.regs.f & FLAG_Z) !== 0);
        return;
      case 0x30:
        // JR NC,e: キャリーフラグが 0 の場合だけ相対ジャンプする。
        this.decodeJr((this.regs.f & FLAG_C) === 0);
        return;
      case 0x38:
        // JR C,e: キャリーフラグが 1 の場合だけ相対ジャンプする。
        this.decodeJr((this.regs.f & FLAG_C) !== 0);
        return;
      case 0xc3:
        // JP nn: 16bit 即値 nn をそのまま PC に設定して絶対ジャンプする。
        this.decodeJp(true);
        return;
      case 0xc2:
        // JP NZ,nn: ゼロフラグが 0 の場合だけ nn へ絶対ジャンプする。
        this.decodeJp((this.regs.f & FLAG_Z) === 0);
        return;
      case 0xca:
        // JP Z,nn: ゼロフラグが 1 の場合だけ nn へ絶対ジャンプする。
        this.decodeJp((this.regs.f & FLAG_Z) !== 0);
        return;
      case 0xd2:
        // JP NC,nn: キャリーフラグが 0 の場合だけ nn へ絶対ジャンプする。
        this.decodeJp((this.regs.f & FLAG_C) === 0);
        return;
      case 0xda:
        // JP C,nn: キャリーフラグが 1 の場合だけ nn へ絶対ジャンプする。
        this.decodeJp((this.regs.f & FLAG_C) !== 0);
        return;
      case 0xe2:
        // JP PO,nn
        this.decodeJp((this.regs.f & FLAG_PV) === 0);
        return;
      case 0xea:
        // JP PE,nn
        this.decodeJp((this.regs.f & FLAG_PV) !== 0);
        return;
      case 0xf2:
        // JP P,nn
        this.decodeJp((this.regs.f & FLAG_S) === 0);
        return;
      case 0xfa:
        // JP M,nn
        this.decodeJp((this.regs.f & FLAG_S) !== 0);
        return;
      case 0xcd:
        // CALL nn: 復帰先アドレスをスタックへ退避し、サブルーチン先 nn へ分岐する。
        this.decodeCall(true);
        return;
      case 0xc4:
        // CALL NZ,nn: ゼロフラグが 0 の場合だけサブルーチン呼び出しを行う。
        this.decodeCall((this.regs.f & FLAG_Z) === 0);
        return;
      case 0xcc:
        // CALL Z,nn: ゼロフラグが 1 の場合だけサブルーチン呼び出しを行う。
        this.decodeCall((this.regs.f & FLAG_Z) !== 0);
        return;
      case 0xd4:
        // CALL NC,nn: キャリーフラグが 0 の場合だけサブルーチン呼び出しを行う。
        this.decodeCall((this.regs.f & FLAG_C) === 0);
        return;
      case 0xdc:
        // CALL C,nn: キャリーフラグが 1 の場合だけサブルーチン呼び出しを行う。
        this.decodeCall((this.regs.f & FLAG_C) !== 0);
        return;
      case 0xe4:
        // CALL PO,nn
        this.decodeCall((this.regs.f & FLAG_PV) === 0);
        return;
      case 0xec:
        // CALL PE,nn
        this.decodeCall((this.regs.f & FLAG_PV) !== 0);
        return;
      case 0xf4:
        // CALL P,nn
        this.decodeCall((this.regs.f & FLAG_S) === 0);
        return;
      case 0xfc:
        // CALL M,nn
        this.decodeCall((this.regs.f & FLAG_S) !== 0);
        return;
      case 0xc9:
        // RET: スタックから 16bit の復帰先アドレスを取り出し、PC に戻す。
        this.enqueuePopWord((word) => {
          this.regs.pc = word;
        });
        return;
      case 0xc0:
        // RET NZ: ゼロフラグが 0 の場合だけ復帰処理を行う。
        this.decodeRet((this.regs.f & FLAG_Z) === 0);
        return;
      case 0xc8:
        // RET Z: ゼロフラグが 1 の場合だけ復帰処理を行う。
        this.decodeRet((this.regs.f & FLAG_Z) !== 0);
        return;
      case 0xd0:
        // RET NC: キャリーフラグが 0 の場合だけ復帰処理を行う。
        this.decodeRet((this.regs.f & FLAG_C) === 0);
        return;
      case 0xd8:
        // RET C: キャリーフラグが 1 の場合だけ復帰処理を行う。
        this.decodeRet((this.regs.f & FLAG_C) !== 0);
        return;
      case 0xe0:
        // RET PO
        this.decodeRet((this.regs.f & FLAG_PV) === 0);
        return;
      case 0xe8:
        // RET PE
        this.decodeRet((this.regs.f & FLAG_PV) !== 0);
        return;
      case 0xf0:
        // RET P
        this.decodeRet((this.regs.f & FLAG_S) === 0);
        return;
      case 0xf8:
        // RET M
        this.decodeRet((this.regs.f & FLAG_S) !== 0);
        return;
      case 0xd9:
        // EXX
        this.enqueueInternal(() => {
          const b = this.regs.b;
          const c = this.regs.c;
          const d = this.regs.d;
          const e = this.regs.e;
          const h = this.regs.h;
          const l = this.regs.l;
          this.regs.b = this.shadowRegs.b;
          this.regs.c = this.shadowRegs.c;
          this.regs.d = this.shadowRegs.d;
          this.regs.e = this.shadowRegs.e;
          this.regs.h = this.shadowRegs.h;
          this.regs.l = this.shadowRegs.l;
          this.shadowRegs.b = b;
          this.shadowRegs.c = c;
          this.shadowRegs.d = d;
          this.shadowRegs.e = e;
          this.shadowRegs.h = h;
          this.shadowRegs.l = l;
        });
        return;
      case 0xc5:
        // PUSH BC: B/C レジスタ対の 16bit 値をスタックへ退避する。
        this.enqueuePushWord(() => this.getPair('BC'));
        return;
      case 0xd5:
        // PUSH DE: D/E レジスタ対の 16bit 値をスタックへ退避する。
        this.enqueuePushWord(() => this.getPair('DE'));
        return;
      case 0xe5:
        // PUSH HL / PUSH IX / PUSH IY: 対象 16bit レジスタ対の値をスタックへ退避する。
        this.enqueuePushWord(() => this.getPair(indexMode === 'HL' ? 'HL' : indexMode));
        return;
      case 0xf5:
        // PUSH AF: A/F レジスタ対の 16bit 値をスタックへ退避する。
        this.enqueuePushWord(() => this.getPair('AF'));
        return;
      case 0xc1:
        // POP BC: スタック先頭の 16bit 値を取り出し、B/C レジスタ対へ復元する。
        this.enqueuePopWord((word) => {
          this.setPair('BC', word);
        });
        return;
      case 0xd1:
        // POP DE: スタック先頭の 16bit 値を取り出し、D/E レジスタ対へ復元する。
        this.enqueuePopWord((word) => {
          this.setPair('DE', word);
        });
        return;
      case 0xe1:
        // POP HL / POP IX / POP IY: スタック先頭の 16bit 値を対象レジスタ対へ復元する。
        this.enqueuePopWord((word) => {
          this.setPair(indexMode === 'HL' ? 'HL' : indexMode, word);
        });
        return;
      case 0xf1:
        // POP AF: スタック先頭の 16bit 値を A/F レジスタ対へ復元する。
        this.enqueuePopWord((word) => {
          this.setPair('AF', word);
        });
        return;
      case 0xdb:
        // IN A,(n): 即値 n で指定した I/O ポートから 1 バイト読み取り、A に格納する。
        this.decodeInAImmediate();
        return;
      case 0xd3:
        // OUT (n),A: A レジスタの 1 バイトを即値 n の I/O ポートへ出力する。
        this.decodeOutImmediateA();
        return;
      case 0xf3:
        // DI: マスク可能割り込みの受理を無効化する。
        this.enqueueInternal(() => {
          this.iff1 = false;
          this.iff2 = false;
        });
        return;
      case 0xfb:
        // EI: マスク可能割り込みの受理を有効化し、直後 1 命令分だけ受理を遅延する。
        this.enqueueInternal(() => {
          this.iff1 = true;
          this.iff2 = true;
          this.deferInterruptAcceptance = true;
        });
        return;
      case 0xeb:
        // EX DE,HL / EX DE,IX / EX DE,IY: DE と対象 16bit レジスタ対の値を交換する。
        this.enqueueInternal(() => {
          const de = this.getPair('DE');
          const hl = this.getPair(indexMode === 'HL' ? 'HL' : indexMode);
          this.setPair('DE', hl);
          this.setPair(indexMode === 'HL' ? 'HL' : indexMode, de);
        });
        return;
      case 0xe6:
        // AND n
        this.enqueueReadPc((value) => {
          this.applyAlu8ToA('AND', value);
        });
        return;
      case 0xe9:
        // JP (HL) / JP (IX) / JP (IY)
        this.enqueueInternal(() => {
          this.regs.pc = this.getPair(indexMode === 'HL' ? 'HL' : indexMode);
        });
        return;
      case 0xee:
        // XOR n
        this.enqueueReadPc((value) => {
          this.applyAlu8ToA('XOR', value);
        });
        return;
      case 0xf6:
        // OR n
        this.enqueueReadPc((value) => {
          this.applyAlu8ToA('OR', value);
        });
        return;
      case 0xf9:
        // LD SP,HL / LD SP,IX / LD SP,IY
        this.enqueueInternal(() => {
          this.regs.sp = this.getPair(indexMode === 'HL' ? 'HL' : indexMode);
        });
        return;
      default:
        // 未定義/予約 opcode は NOP 相当として扱う。
        this.enqueueInternal();
    }
  }

  private decodeLdRImmediate(opcode: number, indexMode: IndexMode): void {
    // 「8bit レジスタ/間接メモリへ即値を代入する命令」の共通処理。
    const regCode = (opcode >>> 3) & 0x07;
    if (regCode === 6) {
      this.decodeLdPointerImmediate(indexMode);
      return;
    }

    this.enqueueReadPc((value) => {
      this.setRegByCode(regCode, value, indexMode);
    });
  }

  private decodeLdRegReg(opcode: number, indexMode: IndexMode): void {
    // 「LD r,r' / LD r,(HL/IX+d/IY+d) / LD (HL/IX+d/IY+d),r」の共通処理。
    const dstCode = (opcode >>> 3) & 0x07;
    const srcCode = opcode & 0x07;

    let displacement = 0;
    if (indexMode !== 'HL' && (dstCode === 6 || srcCode === 6)) {
      this.enqueueReadPc((value) => {
        displacement = signExtend8(value);
      });
    }

    const ptrAddr = () => {
      if (indexMode === 'HL') {
        return this.getPair('HL');
      }
      return clamp16(this.getPair(indexMode) + displacement);
    };

    if (dstCode === 6) {
      if (srcCode === 6) {
        return;
      }
      this.enqueueWriteMem(ptrAddr, () => this.getRegByCode(srcCode, indexMode));
      return;
    }

    if (srcCode === 6) {
      this.enqueueReadMem(ptrAddr, (value) => {
        this.setRegByCode(dstCode, value, indexMode);
      });
      return;
    }

    this.enqueueInternal(() => {
      this.setRegByCode(dstCode, this.getRegByCode(srcCode, indexMode), indexMode);
    });
  }

  private decodeAluReg(opcode: number, indexMode: IndexMode): void {
    const opGroup = (opcode >>> 3) & 0x07;
    const srcCode = opcode & 0x07;
    const opByGroup: Alu8Op[] = ['ADD', 'ADC', 'SUB', 'SBC', 'AND', 'XOR', 'OR', 'CP'];
    const op = opByGroup[opGroup] ?? 'ADD';

    if (srcCode === 6) {
      if (indexMode === 'HL') {
        this.enqueueReadMem(() => this.getPair('HL'), (value) => {
          this.applyAlu8ToA(op, value);
        });
        return;
      }

      let displacement = 0;
      this.enqueueReadPc((value) => {
        displacement = signExtend8(value);
      });
      this.enqueueReadMem(() => clamp16(this.getPair(indexMode) + displacement), (value) => {
        this.applyAlu8ToA(op, value);
      });
      return;
    }

    this.enqueueInternal(() => {
      this.applyAlu8ToA(op, this.getRegByCode(srcCode, indexMode));
    });
  }

  private decodeIncPair(pair: 'BC' | 'DE' | 'HL' | 'IX' | 'IY' | 'SP'): void {
    this.enqueueInternal(() => {
      this.setPair(pair, clamp16(this.getPair(pair) + 1));
    });
  }

  private decodeDecPair(pair: 'BC' | 'DE' | 'HL' | 'IX' | 'IY' | 'SP'): void {
    this.enqueueInternal(() => {
      this.setPair(pair, clamp16(this.getPair(pair) - 1));
    });
  }

  private decodeAddHlPair(indexMode: IndexMode, rhs: 'BC' | 'DE' | 'HL' | 'IX' | 'IY' | 'SP'): void {
    this.enqueueInternal(() => {
      const lhsName = indexMode === 'HL' ? 'HL' : indexMode;
      const lhs = this.getPair(lhsName);
      const right = this.getPair(rhs);
      const sum = lhs + right;
      const result = clamp16(sum);
      this.setPair(lhsName, result);
      this.regs.f =
        (this.regs.f & (FLAG_S | FLAG_Z | FLAG_PV)) |
        (result >>> 8 & (FLAG_X | FLAG_Y)) |
        ((((lhs & 0x0fff) + (right & 0x0fff)) & 0x1000) !== 0 ? FLAG_H : 0) |
        (sum > 0xffff ? FLAG_C : 0);
    });
  }

  private decodeLdAbsoluteFromPair(source: 'BC' | 'DE' | 'HL' | 'IX' | 'IY' | 'SP' | 'AF'): void {
    let lowAddr = 0;
    let highAddr = 0;
    this.enqueueReadPc((value) => {
      lowAddr = value;
    });
    this.enqueueReadPc((value) => {
      highAddr = value;
    });
    this.enqueueWriteMem(() => (highAddr << 8) | lowAddr, () => this.getPair(source) & 0xff);
    this.enqueueWriteMem(() => clamp16(((highAddr << 8) | lowAddr) + 1), () => (this.getPair(source) >>> 8) & 0xff);
  }

  private decodeLdPairFromAbsolute(target: 'BC' | 'DE' | 'HL' | 'IX' | 'IY' | 'SP' | 'AF'): void {
    let lowAddr = 0;
    let highAddr = 0;
    let low = 0;
    let high = 0;
    this.enqueueReadPc((value) => {
      lowAddr = value;
    });
    this.enqueueReadPc((value) => {
      highAddr = value;
    });
    this.enqueueReadMem(() => (highAddr << 8) | lowAddr, (value) => {
      low = value;
    });
    this.enqueueReadMem(() => clamp16(((highAddr << 8) | lowAddr) + 1), (value) => {
      high = value;
    });
    this.enqueueInternal(() => {
      this.setPair(target, (high << 8) | low);
    });
  }

  private decodeExSpWithPair(target: 'HL' | 'IX' | 'IY'): void {
    let low = 0;
    let high = 0;
    let current = 0;
    this.enqueueReadMem(() => this.regs.sp, (value) => {
      low = value;
    });
    this.enqueueReadMem(() => clamp16(this.regs.sp + 1), (value) => {
      high = value;
    });
    this.enqueueInternal(() => {
      current = this.getPair(target);
      this.setPair(target, (high << 8) | low);
    });
    this.enqueueWriteMem(() => this.regs.sp, () => current & 0xff);
    this.enqueueWriteMem(() => clamp16(this.regs.sp + 1), () => (current >>> 8) & 0xff);
  }

  private decodeDjnz(): void {
    this.enqueueReadPc((rawOffset) => {
      this.regs.b = clamp8(this.regs.b - 1);
      if (this.regs.b === 0) {
        return;
      }
      this.enqueueIdle(5);
      this.enqueueInternal(() => {
        this.regs.pc = clamp16(this.regs.pc + signExtend8(rawOffset));
      });
    });
  }

  private decodeIncReg(opcode: number, indexMode: IndexMode): void {
    // 「8bit 値を 1 増やす命令」の共通処理。キャリーフラグは保持する。
    const regCode = (opcode >>> 3) & 0x07;
    if (regCode === 6) {
      this.decodeIncPointer(indexMode);
      return;
    }

    this.enqueueInternal(() => {
      const before = this.getRegByCode(regCode, indexMode);
      const after = clamp8(before + 1);
      this.setRegByCode(regCode, after, indexMode);
      this.updateFlagsForIncDec(before, after, false);
    });
  }

  private decodeDecReg(opcode: number, indexMode: IndexMode): void {
    // 「8bit 値を 1 減らす命令」の共通処理。減算フラグを立て、キャリーフラグは保持する。
    const regCode = (opcode >>> 3) & 0x07;
    if (regCode === 6) {
      this.decodeDecPointer(indexMode);
      return;
    }

    this.enqueueInternal(() => {
      const before = this.getRegByCode(regCode, indexMode);
      const after = clamp8(before - 1);
      this.setRegByCode(regCode, after, indexMode);
      this.updateFlagsForIncDec(before, after, true);
    });
  }

  private decodeLdPairImmediate(target: 'BC' | 'DE' | 'HL' | 'IX' | 'IY' | 'SP'): void {
    // 「16bit 即値をレジスタ対へ代入する命令」の共通処理。即値は下位バイト先行で読む。
    let low = 0;
    let high = 0;
    this.enqueueReadPc((value) => {
      low = value;
    });
    this.enqueueReadPc((value) => {
      high = value;
    });
    this.enqueueInternal(() => {
      this.setPair(target, (high << 8) | low);
    });
  }

  private decodeLdAFromAbsolute(): void {
    // 「アドレス nn のメモリ値を A に読み込む命令」の処理。
    let low = 0;
    let high = 0;
    this.enqueueReadPc((value) => {
      low = value;
    });
    this.enqueueReadPc((value) => {
      high = value;
    });
    this.enqueueReadMem(() => (high << 8) | low, (value) => {
      this.regs.a = value;
    });
  }

  private decodeLdAbsoluteFromA(): void {
    // 「A の値をアドレス nn のメモリへ書き込む命令」の処理。
    let low = 0;
    let high = 0;
    this.enqueueReadPc((value) => {
      low = value;
    });
    this.enqueueReadPc((value) => {
      high = value;
    });
    this.enqueueWriteMem(() => (high << 8) | low, () => this.regs.a);
  }

  private decodeLdAFromPointer(indexMode: IndexMode): void {
    // 「間接メモリから A へ読み込む命令」の処理。
    if (indexMode === 'HL') {
      this.enqueueReadMem(() => this.getPair('HL'), (value) => {
        this.regs.a = value;
      });
      return;
    }

    let displacement = 0;
    this.enqueueReadPc((value) => {
      displacement = signExtend8(value);
    });
    this.enqueueReadMem(() => clamp16(this.getPair(indexMode) + displacement), (value) => {
      this.regs.a = value;
    });
  }

  private decodeLdPointerFromA(indexMode: IndexMode): void {
    // 「A を間接メモリへ書き込む命令」の処理。
    if (indexMode === 'HL') {
      this.enqueueWriteMem(() => this.getPair('HL'), () => this.regs.a);
      return;
    }

    let displacement = 0;
    this.enqueueReadPc((value) => {
      displacement = signExtend8(value);
    });
    this.enqueueWriteMem(() => clamp16(this.getPair(indexMode) + displacement), () => this.regs.a);
  }

  private decodeLdPointerImmediate(indexMode: IndexMode): void {
    // 「即値 n を間接メモリへ書き込む命令」の処理。
    let displacement = 0;
    let immediate = 0;

    if (indexMode !== 'HL') {
      this.enqueueReadPc((value) => {
        displacement = signExtend8(value);
      });
    }

    this.enqueueReadPc((value) => {
      immediate = value;
    });

    this.enqueueWriteMem(
      () => {
        if (indexMode === 'HL') {
          return this.getPair('HL');
        }
        return clamp16(this.getPair(indexMode) + displacement);
      },
      () => immediate
    );
  }

  private decodeIncPointer(indexMode: IndexMode): void {
    // 「間接先メモリの 1 バイトを 1 増やす命令」の処理。
    let displacement = 0;
    let value = 0;

    if (indexMode !== 'HL') {
      this.enqueueReadPc((v) => {
        displacement = signExtend8(v);
      });
    }

    const addr = () => {
      if (indexMode === 'HL') {
        return this.getPair('HL');
      }
      return clamp16(this.getPair(indexMode) + displacement);
    };

    this.enqueueReadMem(addr, (v) => {
      value = v;
    });

    this.enqueueInternal(() => {
      const before = value;
      value = clamp8(value + 1);
      this.updateFlagsForIncDec(before, value, false);
    });

    this.enqueueWriteMem(addr, () => value);
  }

  private decodeDecPointer(indexMode: IndexMode): void {
    // 「間接先メモリの 1 バイトを 1 減らす命令」の処理。
    let displacement = 0;
    let value = 0;

    if (indexMode !== 'HL') {
      this.enqueueReadPc((v) => {
        displacement = signExtend8(v);
      });
    }

    const addr = () => {
      if (indexMode === 'HL') {
        return this.getPair('HL');
      }
      return clamp16(this.getPair(indexMode) + displacement);
    };

    this.enqueueReadMem(addr, (v) => {
      value = v;
    });

    this.enqueueInternal(() => {
      const before = value;
      value = clamp8(value - 1);
      this.updateFlagsForIncDec(before, value, true);
    });

    this.enqueueWriteMem(addr, () => value);
  }

  private decodeJr(takeBranch: boolean): void {
    // 「条件付き/無条件の相対ジャンプ命令」の処理。オフセットは signed 8bit。
    this.enqueueReadPc((rawOffset) => {
      if (!takeBranch) {
        return;
      }
      this.enqueueIdle(5);
      this.enqueueInternal(() => {
        this.regs.pc = clamp16(this.regs.pc + signExtend8(rawOffset));
      });
    });
  }

  private decodeJp(takeBranch: boolean): void {
    // 「条件付き/無条件の絶対ジャンプ命令」の処理。
    let low = 0;
    let high = 0;
    this.enqueueReadPc((value) => {
      low = value;
    });
    this.enqueueReadPc((value) => {
      high = value;
    });
    if (!takeBranch) {
      return;
    }
    this.enqueueInternal(() => {
      this.regs.pc = (high << 8) | low;
    });
  }

  private decodeCall(takeBranch: boolean): void {
    // 「条件付き/無条件のサブルーチン呼び出し命令」の処理。
    let low = 0;
    let high = 0;
    this.enqueueReadPc((value) => {
      low = value;
    });
    this.enqueueReadPc((value) => {
      high = value;
    });
    if (!takeBranch) {
      return;
    }
    this.enqueuePushWord(() => this.regs.pc);
    this.enqueueInternal(() => {
      this.regs.pc = (high << 8) | low;
    });
  }

  private decodeRet(takeBranch: boolean): void {
    // 「条件付き/無条件のサブルーチン復帰命令」の処理。
    if (!takeBranch) {
      this.enqueueInternal();
      return;
    }
    this.enqueuePopWord((word) => {
      this.regs.pc = word;
    });
  }

  private decodeInAImmediate(): void {
    // 「I/O ポートから A へ入力する命令」の処理。
    let port = 0;
    let value = 0;
    this.enqueueReadPc((v) => {
      port = v;
    });
    this.enqueueReadIo(() => port, (v) => {
      value = v;
    });
    this.enqueueInternal(() => {
      this.regs.a = value;
    });
  }

  private decodeOutImmediateA(): void {
    // 「A の値を I/O ポートへ出力する命令」の処理。
    let port = 0;
    this.enqueueReadPc((v) => {
      port = v;
    });
    this.enqueueWriteIo(() => port, () => this.regs.a);
  }

  private decodeIndexedCB(indexMode: 'IX' | 'IY'): void {
    // IX/IY を基準にした CB 拡張命令。先に変位 d を読んでから演算種別を解釈する。
    let displacement = 0;
    this.enqueueReadPc((value) => {
      displacement = signExtend8(value);
    });
    this.enqueueFetchOpcode((opcode) => {
      this.decodeCB(opcode, indexMode, displacement);
    });
  }

  private decodeCB(opcode: number, indexMode: IndexMode, displacement: number): void {
    const opGroup = opcode >>> 6;
    const bitIndex = (opcode >>> 3) & 0x07;
    const regCode = opcode & 0x07;

    // CB 拡張命令は「対象値の読出し -> ビット演算 -> 必要なら書戻し」を共通化している。
    const readTarget = (target: (value: number) => void): void => {
      if (regCode === 6) {
        const addr = this.getCbAddress(indexMode, displacement);
        this.enqueueReadMem(() => addr, target);
        return;
      }
      this.enqueueInternal(() => {
        target(this.getRegByCode(regCode, indexMode));
      });
    };

    const writeTarget = (value: () => number): void => {
      if (regCode === 6) {
        const addr = this.getCbAddress(indexMode, displacement);
        this.enqueueWriteMem(() => addr, value);
        return;
      }
      this.enqueueInternal(() => {
        this.setRegByCode(regCode, value(), indexMode);
      });
    };

    if (opGroup === 1) {
      // BIT b,target: 指定ビットを検査し、結果をフラグへ反映する（値は変更しない）。
      readTarget((value) => {
        const bit = (value >>> bitIndex) & 1;
        this.regs.f =
          (this.regs.f & FLAG_C) |
          FLAG_H |
          (bit === 0 ? FLAG_Z | FLAG_PV : 0) |
          (bitIndex === 7 && bit === 1 ? FLAG_S : 0) |
          (value & (FLAG_X | FLAG_Y));
      });
      return;
    }

    if (opGroup === 2 || opGroup === 3) {
      // RES b,target / SET b,target: 指定ビットを 0/1 に更新して書き戻す。
      let readValue = 0;
      readTarget((value) => {
        readValue = value;
      });
      writeTarget(() => {
        const mask = 1 << bitIndex;
        return opGroup === 2 ? (readValue & ~mask) : (readValue | mask);
      });
      return;
    }

    if ((opcode & 0xf8) === 0x00) {
      // RLC target: 対象値を左循環ローテートし、最上位ビットをキャリーへ出す。
      this.decodeRotateTarget(readTarget, writeTarget, 'RLC');
      return;
    }
    if ((opcode & 0xf8) === 0x10) {
      // RL target: キャリーを介した左ローテートを行う。
      this.decodeRotateTarget(readTarget, writeTarget, 'RL');
      return;
    }
    if ((opcode & 0xf8) === 0x08) {
      // RRC target
      this.decodeRotateTarget(readTarget, writeTarget, 'RRC');
      return;
    }
    if ((opcode & 0xf8) === 0x18) {
      // RR target
      this.decodeRotateTarget(readTarget, writeTarget, 'RR');
      return;
    }
    if ((opcode & 0xf8) === 0x20) {
      // SLA target
      this.decodeRotateTarget(readTarget, writeTarget, 'SLA');
      return;
    }
    if ((opcode & 0xf8) === 0x28) {
      // SRA target
      this.decodeRotateTarget(readTarget, writeTarget, 'SRA');
      return;
    }
    if ((opcode & 0xf8) === 0x30) {
      // SLL target
      this.decodeRotateTarget(readTarget, writeTarget, 'SLL');
      return;
    }
    if ((opcode & 0xf8) === 0x38) {
      // SRL target
      this.decodeRotateTarget(readTarget, writeTarget, 'SRL');
      return;
    }

    // CB 空間は全デコード済みの想定だが、保険として NOP 相当で継続。
    this.enqueueInternal();
  }

  private decodeRotateTarget(
    readTarget: (target: (value: number) => void) => void,
    writeTarget: (value: () => number) => void,
    op: RotateOp
  ): void {
    // CB 系ローテート命令の共通演算部。
    let readValue = 0;
    let result = 0;
    readTarget((value) => {
      readValue = value;
    });

    this.enqueueInternal(() => {
      result = this.rotate8(readValue, op);
    });

    writeTarget(() => result);
  }

  private decodeED(opcode: number): void {
    const isNegAlias = opcode === 0x44 || opcode === 0x4c || opcode === 0x54 || opcode === 0x5c || opcode === 0x64 || opcode === 0x6c || opcode === 0x74 || opcode === 0x7c;
    if (isNegAlias) {
      this.enqueueInternal(() => {
        const value = this.regs.a;
        const result = clamp8(0 - value);
        this.regs.a = result;
        this.regs.f =
          FLAG_N |
          (result & (FLAG_S | FLAG_X | FLAG_Y)) |
          (result === 0 ? FLAG_Z : 0) |
          (value !== 0 ? FLAG_C : 0) |
          (value === 0x80 ? FLAG_PV : 0) |
          (value !== 0 ? FLAG_H : 0);
      });
      return;
    }

    const isRetnAlias = opcode === 0x45 || opcode === 0x55 || opcode === 0x5d || opcode === 0x65 || opcode === 0x6d || opcode === 0x75 || opcode === 0x7d;
    if (isRetnAlias) {
      this.enqueuePopWord((word) => {
        this.regs.pc = word;
        this.iff1 = this.iff2;
      });
      return;
    }

    if ((opcode & 0xc7) === 0x40) {
      this.decodeEdInFromC(opcode);
      return;
    }

    if ((opcode & 0xc7) === 0x41) {
      this.decodeEdOutToC(opcode);
      return;
    }

    if ((opcode & 0xcf) === 0x42) {
      this.decodeEdSbcHlPair(opcode);
      return;
    }

    if ((opcode & 0xcf) === 0x4a) {
      this.decodeEdAdcHlPair(opcode);
      return;
    }

    if ((opcode & 0xcf) === 0x43) {
      this.decodeEdLdMemNnPair(opcode);
      return;
    }

    if ((opcode & 0xcf) === 0x4b) {
      this.decodeEdLdPairMemNn(opcode);
      return;
    }

    switch (opcode) {
      case 0x4d:
        this.enqueuePopWord((word) => {
          this.regs.pc = word;
        });
        return;
      case 0x57:
        this.enqueueInternal(() => {
          this.regs.a = this.regs.i;
          this.regs.f =
            (this.regs.f & FLAG_C) |
            this.getSzxyFlags(this.regs.a) |
            (this.iff2 ? FLAG_PV : 0);
        });
        return;
      case 0x5f:
        this.enqueueInternal(() => {
          this.regs.a = this.regs.r;
          this.regs.f =
            (this.regs.f & FLAG_C) |
            this.getSzxyFlags(this.regs.a) |
            (this.iff2 ? FLAG_PV : 0);
        });
        return;
      case 0x47:
        this.enqueueInternal(() => {
          this.regs.i = this.regs.a;
        });
        return;
      case 0x4f:
        this.enqueueInternal(() => {
          this.regs.r = this.regs.a;
        });
        return;
      case 0x46:
      case 0x4e:
      case 0x66:
      case 0x6e:
        this.enqueueInternal(() => {
          this.im = 0;
        });
        return;
      case 0x56:
      case 0x76:
        this.enqueueInternal(() => {
          this.im = 1;
        });
        return;
      case 0x5e:
      case 0x7e:
        this.enqueueInternal(() => {
          this.im = 2;
        });
        return;
      case 0x67:
        this.decodeRrd();
        return;
      case 0x6f:
        this.decodeRld();
        return;
      case 0xa0:
        this.decodeBlockTransfer(false, false);
        return;
      case 0xa8:
        this.decodeBlockTransfer(false, true);
        return;
      case 0xb0:
        this.decodeBlockTransfer(true, false);
        return;
      case 0xb8:
        this.decodeBlockTransfer(true, true);
        return;
      case 0xa1:
        this.decodeBlockCompare(false, false);
        return;
      case 0xa9:
        this.decodeBlockCompare(false, true);
        return;
      case 0xb1:
        this.decodeBlockCompare(true, false);
        return;
      case 0xb9:
        this.decodeBlockCompare(true, true);
        return;
      case 0xa2:
        this.decodeBlockIn(false, false);
        return;
      case 0xaa:
        this.decodeBlockIn(false, true);
        return;
      case 0xb2:
        this.decodeBlockIn(true, false);
        return;
      case 0xba:
        this.decodeBlockIn(true, true);
        return;
      case 0xa3:
        this.decodeBlockOut(false, false);
        return;
      case 0xab:
        this.decodeBlockOut(false, true);
        return;
      case 0xb3:
        this.decodeBlockOut(true, false);
        return;
      case 0xbb:
        this.decodeBlockOut(true, true);
        return;
      default:
        // ED の未定義/予約 opcode は NOP 相当として扱う。
        this.enqueueInternal();
    }
  }

  private decodeEdInFromC(opcode: number): void {
    const regCode = (opcode >>> 3) & 0x07;
    let value = 0;
    this.enqueueReadIo(() => this.regs.c, (v) => {
      value = v;
    });
    this.enqueueInternal(() => {
      if (regCode !== 6) {
        this.setRegByCode(regCode, value, 'HL');
      }
      this.regs.f = (this.regs.f & FLAG_C) | this.getSzxyParityFlags(value);
    });
  }

  private decodeEdOutToC(opcode: number): void {
    const regCode = (opcode >>> 3) & 0x07;
    this.enqueueWriteIo(() => this.regs.c, () => {
      if (regCode === 6) {
        return 0;
      }
      return this.getRegByCode(regCode, 'HL');
    });
  }

  private decodeEdSbcHlPair(opcode: number): void {
    this.enqueueInternal(() => {
      const left = this.getPair('HL');
      const right = this.getPair(this.getPairByEdOpcode(opcode));
      const carry = (this.regs.f & FLAG_C) !== 0 ? 1 : 0;
      const result = clamp16(left - right - carry);
      this.setPair('HL', result);
      this.regs.f =
        FLAG_N |
        ((result & 0x8000) !== 0 ? FLAG_S : 0) |
        (result === 0 ? FLAG_Z : 0) |
        ((result >>> 8) & (FLAG_X | FLAG_Y)) |
        (((left ^ right ^ result) & 0x1000) !== 0 ? FLAG_H : 0) |
        ((((left ^ right) & (left ^ result)) & 0x8000) !== 0 ? FLAG_PV : 0) |
        (left < (right + carry) ? FLAG_C : 0);
    });
  }

  private decodeEdAdcHlPair(opcode: number): void {
    this.enqueueInternal(() => {
      const left = this.getPair('HL');
      const right = this.getPair(this.getPairByEdOpcode(opcode));
      const carry = (this.regs.f & FLAG_C) !== 0 ? 1 : 0;
      const sum = left + right + carry;
      const result = clamp16(sum);
      this.setPair('HL', result);
      this.regs.f =
        ((result & 0x8000) !== 0 ? FLAG_S : 0) |
        (result === 0 ? FLAG_Z : 0) |
        ((result >>> 8) & (FLAG_X | FLAG_Y)) |
        ((((left & 0x0fff) + (right & 0x0fff) + carry) & 0x1000) !== 0 ? FLAG_H : 0) |
        ((((~(left ^ right)) & (left ^ result)) & 0x8000) !== 0 ? FLAG_PV : 0) |
        (sum > 0xffff ? FLAG_C : 0);
    });
  }

  private decodeEdLdMemNnPair(opcode: number): void {
    this.decodeLdAbsoluteFromPair(this.getPairByEdOpcode(opcode));
  }

  private decodeEdLdPairMemNn(opcode: number): void {
    this.decodeLdPairFromAbsolute(this.getPairByEdOpcode(opcode));
  }

  private decodeRrd(): void {
    let mem = 0;
    this.enqueueReadMem(() => this.getPair('HL'), (value) => {
      mem = value;
    });
    this.enqueueInternal(() => {
      const aLow = this.regs.a & 0x0f;
      this.regs.a = (this.regs.a & 0xf0) | (mem & 0x0f);
      mem = ((aLow << 4) | (mem >>> 4)) & 0xff;
      this.regs.f = (this.regs.f & FLAG_C) | this.getSzxyParityFlags(this.regs.a);
    });
    this.enqueueWriteMem(() => this.getPair('HL'), () => mem);
  }

  private decodeRld(): void {
    let mem = 0;
    this.enqueueReadMem(() => this.getPair('HL'), (value) => {
      mem = value;
    });
    this.enqueueInternal(() => {
      const aLow = this.regs.a & 0x0f;
      this.regs.a = (this.regs.a & 0xf0) | (mem >>> 4);
      mem = ((mem << 4) | aLow) & 0xff;
      this.regs.f = (this.regs.f & FLAG_C) | this.getSzxyParityFlags(this.regs.a);
    });
    this.enqueueWriteMem(() => this.getPair('HL'), () => mem);
  }

  private decodeBlockTransfer(repeat: boolean, decrement: boolean): void {
    let value = 0;
    this.enqueueReadMem(() => this.getPair('HL'), (v) => {
      value = v;
    });
    this.enqueueWriteMem(() => this.getPair('DE'), () => value);
    this.enqueueInternal(() => {
      const step = decrement ? -1 : 1;
      this.setPair('HL', clamp16(this.getPair('HL') + step));
      this.setPair('DE', clamp16(this.getPair('DE') + step));
      const bc = clamp16(this.getPair('BC') - 1);
      this.setPair('BC', bc);
      this.regs.f = (this.regs.f & FLAG_C) | (bc !== 0 ? FLAG_PV : 0);
      if (repeat && bc !== 0) {
        this.enqueueIdle(5);
        this.enqueueInternal(() => {
          this.regs.pc = clamp16(this.regs.pc - 2);
        });
      }
    });
  }

  private decodeBlockCompare(repeat: boolean, decrement: boolean): void {
    let value = 0;
    this.enqueueReadMem(() => this.getPair('HL'), (v) => {
      value = v;
    });
    this.enqueueInternal(() => {
      const result = clamp8(this.regs.a - value);
      const step = decrement ? -1 : 1;
      this.setPair('HL', clamp16(this.getPair('HL') + step));
      const bc = clamp16(this.getPair('BC') - 1);
      this.setPair('BC', bc);
      this.regs.f =
        (this.regs.f & FLAG_C) |
        FLAG_N |
        (result & FLAG_S) |
        (result === 0 ? FLAG_Z : 0) |
        (halfCarrySub8(this.regs.a, value, 0) ? FLAG_H : 0) |
        (bc !== 0 ? FLAG_PV : 0) |
        (result & (FLAG_X | FLAG_Y));
      if (repeat && bc !== 0 && result !== 0) {
        this.enqueueIdle(5);
        this.enqueueInternal(() => {
          this.regs.pc = clamp16(this.regs.pc - 2);
        });
      }
    });
  }

  private decodeBlockIn(repeat: boolean, decrement: boolean): void {
    let value = 0;
    this.enqueueReadIo(() => this.regs.c, (v) => {
      value = v;
    });
    this.enqueueWriteMem(() => this.getPair('HL'), () => value);
    this.enqueueInternal(() => {
      const step = decrement ? -1 : 1;
      this.setPair('HL', clamp16(this.getPair('HL') + step));
      this.regs.b = clamp8(this.regs.b - 1);
      this.regs.f = (this.regs.b === 0 ? FLAG_Z : 0) | FLAG_N;
      if (repeat && this.regs.b !== 0) {
        this.enqueueIdle(5);
        this.enqueueInternal(() => {
          this.regs.pc = clamp16(this.regs.pc - 2);
        });
      }
    });
  }

  private decodeBlockOut(repeat: boolean, decrement: boolean): void {
    let value = 0;
    this.enqueueReadMem(() => this.getPair('HL'), (v) => {
      value = v;
    });
    this.enqueueWriteIo(() => this.regs.c, () => value);
    this.enqueueInternal(() => {
      const step = decrement ? -1 : 1;
      this.setPair('HL', clamp16(this.getPair('HL') + step));
      this.regs.b = clamp8(this.regs.b - 1);
      this.regs.f = (this.regs.b === 0 ? FLAG_Z : 0) | FLAG_N;
      if (repeat && this.regs.b !== 0) {
        this.enqueueIdle(5);
        this.enqueueInternal(() => {
          this.regs.pc = clamp16(this.regs.pc - 2);
        });
      }
    });
  }

  private getPairByEdOpcode(opcode: number): 'BC' | 'DE' | 'HL' | 'SP' {
    const key = (opcode >>> 4) & 0x03;
    if (key === 0) {
      return 'BC';
    }
    if (key === 1) {
      return 'DE';
    }
    if (key === 2) {
      return 'HL';
    }
    return 'SP';
  }

  private applyDaa(value: number): number {
    const current = value & 0xff;
    const carryIn = (this.regs.f & FLAG_C) !== 0;
    const halfIn = (this.regs.f & FLAG_H) !== 0;
    const isSub = (this.regs.f & FLAG_N) !== 0;

    let correction = 0;
    let carryOut = carryIn;
    if (!isSub) {
      if (halfIn || (current & 0x0f) > 9) {
        correction |= 0x06;
      }
      if (carryIn || current > 0x99) {
        correction |= 0x60;
        carryOut = true;
      }
    } else {
      if (halfIn) {
        correction |= 0x06;
      }
      if (carryIn) {
        correction |= 0x60;
      }
    }

    const result = clamp8(current + (isSub ? -correction : correction));
    this.regs.f =
      (isSub ? FLAG_N : 0) |
      (result & (FLAG_S | FLAG_X | FLAG_Y)) |
      (result === 0 ? FLAG_Z : 0) |
      (parity8(result) ? FLAG_PV : 0) |
      ((((current ^ result ^ correction) & 0x10) !== 0) ? FLAG_H : 0) |
      (carryOut ? FLAG_C : 0);
    return result;
  }

  private getCbAddress(indexMode: IndexMode, displacement: number): number {
    if (indexMode === 'HL') {
      return this.getPair('HL');
    }
    return clamp16(this.getPair(indexMode) + displacement);
  }

  private addToA(value: number, carryIn: boolean): void {
    this.applyAlu8ToA(carryIn ? 'ADC' : 'ADD', value);
  }

  private subFromA(value: number, carryIn: boolean): void {
    this.applyAlu8ToA(carryIn ? 'SBC' : 'SUB', value);
  }

  private compareWithA(value: number): void {
    this.applyAlu8ToA('CP', value);
  }

  private updateFlagsForIncDec(before: number, after: number, isDec: boolean): void {
    const base = this.regs.f & FLAG_C;
    this.regs.f =
      base |
      (isDec ? FLAG_N : 0) |
      (after & (FLAG_X | FLAG_Y)) |
      (after === 0 ? FLAG_Z : 0) |
      (after & FLAG_S) |
      (!isDec && before === 0x7f ? FLAG_PV : 0) |
      (isDec && before === 0x80 ? FLAG_PV : 0) |
      (!isDec && (before & 0x0f) === 0x0f ? FLAG_H : 0) |
      (isDec && (before & 0x0f) === 0x00 ? FLAG_H : 0);
  }

  private rotate8(value: number, op: RotateOp): number {
    const clamped = clamp8(value);
    let result = clamped;
    let carry = 0;
    const carryIn = (this.regs.f & FLAG_C) !== 0 ? 1 : 0;

    switch (op) {
      case 'RLC':
        carry = (clamped >>> 7) & 1;
        result = clamp8((clamped << 1) | carry);
        break;
      case 'RL':
        carry = (clamped >>> 7) & 1;
        result = clamp8((clamped << 1) | carryIn);
        break;
      case 'RRC':
        carry = clamped & 1;
        result = clamp8((clamped >>> 1) | (carry << 7));
        break;
      case 'RR':
        carry = clamped & 1;
        result = clamp8((clamped >>> 1) | (carryIn << 7));
        break;
      case 'SLA':
        carry = (clamped >>> 7) & 1;
        result = clamp8(clamped << 1);
        break;
      case 'SRA':
        carry = clamped & 1;
        result = clamp8((clamped >>> 1) | (clamped & 0x80));
        break;
      case 'SLL':
        carry = (clamped >>> 7) & 1;
        result = clamp8((clamped << 1) | 0x01);
        break;
      case 'SRL':
        carry = clamped & 1;
        result = clamp8(clamped >>> 1);
        break;
      default:
        result = clamped;
    }

    this.regs.f = this.getSzxyParityFlags(result) | (carry ? FLAG_C : 0);
    return result;
  }

  private applyAlu8ToA(op: Alu8Op, value: number): void {
    const left = this.regs.a;
    const right = clamp8(value);

    switch (op) {
      case 'ADD':
      case 'ADC': {
        const carry = op === 'ADC' && (this.regs.f & FLAG_C) !== 0 ? 1 : 0;
        const result = clamp8(left + right + carry);
        this.regs.a = result;
        this.regs.f =
          (result & (FLAG_S | FLAG_X | FLAG_Y)) |
          (result === 0 ? FLAG_Z : 0) |
          (halfCarryAdd8(left, right, carry) ? FLAG_H : 0) |
          (overflowAdd8(left, right + carry, result) ? FLAG_PV : 0) |
          (((left + right + carry) & 0x100) !== 0 ? FLAG_C : 0);
        return;
      }
      case 'SUB':
      case 'SBC': {
        const carry = op === 'SBC' && (this.regs.f & FLAG_C) !== 0 ? 1 : 0;
        const result = clamp8(left - right - carry);
        this.regs.a = result;
        this.regs.f =
          FLAG_N |
          (result & (FLAG_S | FLAG_X | FLAG_Y)) |
          (result === 0 ? FLAG_Z : 0) |
          (halfCarrySub8(left, right, carry) ? FLAG_H : 0) |
          (overflowSub8(left, right + carry, result) ? FLAG_PV : 0) |
          (left < (right + carry) ? FLAG_C : 0);
        return;
      }
      case 'AND': {
        const result = left & right;
        this.regs.a = result;
        this.regs.f = this.getSzxyParityFlags(result) | FLAG_H;
        return;
      }
      case 'XOR': {
        const result = left ^ right;
        this.regs.a = result;
        this.regs.f = this.getSzxyParityFlags(result);
        return;
      }
      case 'OR': {
        const result = left | right;
        this.regs.a = result;
        this.regs.f = this.getSzxyParityFlags(result);
        return;
      }
      case 'CP': {
        const result = clamp8(left - right);
        this.regs.f =
          FLAG_N |
          (result & FLAG_S) |
          (result === 0 ? FLAG_Z : 0) |
          (halfCarrySub8(left, right, 0) ? FLAG_H : 0) |
          (overflowSub8(left, right, result) ? FLAG_PV : 0) |
          (left < right ? FLAG_C : 0) |
          (right & (FLAG_X | FLAG_Y));
        return;
      }
      default:
        return;
    }
  }

  private getPair(name: 'AF' | 'BC' | 'DE' | 'HL' | 'IX' | 'IY' | 'SP'): number {
    switch (name) {
      case 'AF':
        return (this.regs.a << 8) | this.regs.f;
      case 'BC':
        return (this.regs.b << 8) | this.regs.c;
      case 'DE':
        return (this.regs.d << 8) | this.regs.e;
      case 'HL':
        return (this.regs.h << 8) | this.regs.l;
      case 'IX':
        return this.regs.ix;
      case 'IY':
        return this.regs.iy;
      case 'SP':
        return this.regs.sp;
      default:
        return 0;
    }
  }

  private setPair(name: 'AF' | 'BC' | 'DE' | 'HL' | 'IX' | 'IY' | 'SP', value: number): void {
    const clamped = clamp16(value);
    switch (name) {
      case 'AF':
        this.regs.a = (clamped >>> 8) & 0xff;
        this.regs.f = clamped & 0xff;
        return;
      case 'BC':
        this.regs.b = (clamped >>> 8) & 0xff;
        this.regs.c = clamped & 0xff;
        return;
      case 'DE':
        this.regs.d = (clamped >>> 8) & 0xff;
        this.regs.e = clamped & 0xff;
        return;
      case 'HL':
        this.regs.h = (clamped >>> 8) & 0xff;
        this.regs.l = clamped & 0xff;
        return;
      case 'IX':
        this.regs.ix = clamped;
        return;
      case 'IY':
        this.regs.iy = clamped;
        return;
      case 'SP':
        this.regs.sp = clamped;
        return;
      default:
        return;
    }
  }

  private getRegByCode(regCode: number, indexMode: IndexMode): number {
    switch (regCode & 0x07) {
      case 0:
        return this.regs.b;
      case 1:
        return this.regs.c;
      case 2:
        return this.regs.d;
      case 3:
        return this.regs.e;
      case 4:
        if (indexMode === 'IX') {
          return (this.regs.ix >>> 8) & 0xff;
        }
        if (indexMode === 'IY') {
          return (this.regs.iy >>> 8) & 0xff;
        }
        return this.regs.h;
      case 5:
        if (indexMode === 'IX') {
          return this.regs.ix & 0xff;
        }
        if (indexMode === 'IY') {
          return this.regs.iy & 0xff;
        }
        return this.regs.l;
      case 7:
        return this.regs.a;
      default:
        return 0;
    }
  }

  private setRegByCode(regCode: number, value: number, indexMode: IndexMode): void {
    const clamped = clamp8(value);
    switch (regCode & 0x07) {
      case 0:
        this.regs.b = clamped;
        return;
      case 1:
        this.regs.c = clamped;
        return;
      case 2:
        this.regs.d = clamped;
        return;
      case 3:
        this.regs.e = clamped;
        return;
      case 4:
        if (indexMode === 'IX') {
          this.regs.ix = ((clamped << 8) | (this.regs.ix & 0x00ff)) & 0xffff;
          return;
        }
        if (indexMode === 'IY') {
          this.regs.iy = ((clamped << 8) | (this.regs.iy & 0x00ff)) & 0xffff;
          return;
        }
        this.regs.h = clamped;
        return;
      case 5:
        if (indexMode === 'IX') {
          this.regs.ix = ((this.regs.ix & 0xff00) | clamped) & 0xffff;
          return;
        }
        if (indexMode === 'IY') {
          this.regs.iy = ((this.regs.iy & 0xff00) | clamped) & 0xffff;
          return;
        }
        this.regs.l = clamped;
        return;
      case 7:
        this.regs.a = clamped;
        return;
      default:
        return;
    }
  }

  private bumpR(): void {
    const high = this.regs.r & 0x80;
    const low = (this.regs.r + 1) & 0x7f;
    this.regs.r = high | low;
  }

  private getSzxyFlags(value: number): number {
    const clamped = value & 0xff;
    return (clamped & (FLAG_S | FLAG_X | FLAG_Y)) | (clamped === 0 ? FLAG_Z : 0);
  }

  private getSzxyParityFlags(value: number): number {
    const clamped = value & 0xff;
    return this.getSzxyFlags(clamped) | (parity8(clamped) ? FLAG_PV : 0);
  }

  private handleUnsupported(opcode: number, prefix?: string): void {
    const currentPc = clamp16(this.regs.pc - 1);
    this.options.onUnsupportedOpcode?.(currentPc, opcode, prefix);

    if (this.options.strictUnsupportedOpcodes) {
      throw new Error(`Unsupported opcode ${prefix ? `${prefix} ` : ''}${opcode.toString(16).padStart(2, '0')} at 0x${currentPc.toString(16).padStart(4, '0')}`);
    }

    this.enqueueInternal();
  }
}
