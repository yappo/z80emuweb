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
import type { Bus, Cpu, CpuRegisters, CpuState, InterruptMode } from './types';

type IndexMode = 'HL' | 'IX' | 'IY';
type TStateOp = () => void;

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
    const rstVector = RST_VECTOR_BY_OPCODE.get(opcode);
    if (rstVector !== undefined) {
      this.enqueuePushWord(() => this.regs.pc);
      this.enqueueInternal(() => {
        this.regs.pc = rstVector;
      });
      return;
    }

    if ((opcode & 0xc7) === 0x06) {
      this.decodeLdRImmediate(opcode, indexMode);
      return;
    }

    if ((opcode & 0xc7) === 0x04) {
      this.decodeIncReg(opcode, indexMode);
      return;
    }

    if ((opcode & 0xc7) === 0x05) {
      this.decodeDecReg(opcode, indexMode);
      return;
    }

    switch (opcode) {
      case 0x00:
        return;
      case 0x76:
        this.enqueueInternal(() => {
          this.halted = true;
        });
        return;
      case 0xdd:
        this.enqueueFetchOpcode((next) => {
          this.decodeOpcode(next, 'IX');
        });
        return;
      case 0xfd:
        this.enqueueFetchOpcode((next) => {
          this.decodeOpcode(next, 'IY');
        });
        return;
      case 0xed:
        this.enqueueFetchOpcode((next) => {
          this.decodeED(next);
        });
        return;
      case 0xcb:
        if (indexMode === 'HL') {
          this.enqueueFetchOpcode((next) => {
            this.decodeCB(next, 'HL', 0);
          });
          return;
        }
        this.decodeIndexedCB(indexMode);
        return;
      case 0x01:
        this.decodeLdPairImmediate('BC');
        return;
      case 0x11:
        this.decodeLdPairImmediate('DE');
        return;
      case 0x21:
        this.decodeLdPairImmediate(indexMode === 'HL' ? 'HL' : indexMode);
        return;
      case 0x31:
        this.decodeLdPairImmediate('SP');
        return;
      case 0x23:
        this.enqueueInternal(() => {
          const value = clamp16(this.getPair(indexMode === 'HL' ? 'HL' : indexMode) + 1);
          this.setPair(indexMode === 'HL' ? 'HL' : indexMode, value);
        });
        return;
      case 0x2b:
        this.enqueueInternal(() => {
          const value = clamp16(this.getPair(indexMode === 'HL' ? 'HL' : indexMode) - 1);
          this.setPair(indexMode === 'HL' ? 'HL' : indexMode, value);
        });
        return;
      case 0x3a:
        this.decodeLdAFromAbsolute();
        return;
      case 0x32:
        this.decodeLdAbsoluteFromA();
        return;
      case 0x7e:
        this.decodeLdAFromPointer(indexMode);
        return;
      case 0x77:
        this.decodeLdPointerFromA(indexMode);
        return;
      case 0x36:
        this.decodeLdPointerImmediate(indexMode);
        return;
      case 0x3e:
        this.enqueueReadPc((value) => {
          this.regs.a = value;
        });
        return;
      case 0xaf:
        this.enqueueInternal(() => {
          this.regs.a = 0;
          this.regs.f = FLAG_Z | FLAG_PV;
        });
        return;
      case 0xb7:
        this.enqueueInternal(() => {
          const value = this.regs.a;
          this.regs.f = this.getSzxyParityFlags(value);
        });
        return;
      case 0xc6:
        this.enqueueReadPc((value) => {
          this.addToA(value, false);
        });
        return;
      case 0xce:
        this.enqueueReadPc((value) => {
          this.addToA(value, (this.regs.f & FLAG_C) !== 0);
        });
        return;
      case 0xd6:
        this.enqueueReadPc((value) => {
          this.subFromA(value, false);
        });
        return;
      case 0xde:
        this.enqueueReadPc((value) => {
          this.subFromA(value, (this.regs.f & FLAG_C) !== 0);
        });
        return;
      case 0xfe:
        this.enqueueReadPc((value) => {
          this.compareWithA(value);
        });
        return;
      case 0x18:
        this.decodeJr(true);
        return;
      case 0x20:
        this.decodeJr((this.regs.f & FLAG_Z) === 0);
        return;
      case 0x28:
        this.decodeJr((this.regs.f & FLAG_Z) !== 0);
        return;
      case 0x30:
        this.decodeJr((this.regs.f & FLAG_C) === 0);
        return;
      case 0x38:
        this.decodeJr((this.regs.f & FLAG_C) !== 0);
        return;
      case 0xc3:
        this.decodeJp(true);
        return;
      case 0xc2:
        this.decodeJp((this.regs.f & FLAG_Z) === 0);
        return;
      case 0xca:
        this.decodeJp((this.regs.f & FLAG_Z) !== 0);
        return;
      case 0xd2:
        this.decodeJp((this.regs.f & FLAG_C) === 0);
        return;
      case 0xda:
        this.decodeJp((this.regs.f & FLAG_C) !== 0);
        return;
      case 0xcd:
        this.decodeCall(true);
        return;
      case 0xc4:
        this.decodeCall((this.regs.f & FLAG_Z) === 0);
        return;
      case 0xcc:
        this.decodeCall((this.regs.f & FLAG_Z) !== 0);
        return;
      case 0xd4:
        this.decodeCall((this.regs.f & FLAG_C) === 0);
        return;
      case 0xdc:
        this.decodeCall((this.regs.f & FLAG_C) !== 0);
        return;
      case 0xc9:
        this.enqueuePopWord((word) => {
          this.regs.pc = word;
        });
        return;
      case 0xc0:
        this.decodeRet((this.regs.f & FLAG_Z) === 0);
        return;
      case 0xc8:
        this.decodeRet((this.regs.f & FLAG_Z) !== 0);
        return;
      case 0xd0:
        this.decodeRet((this.regs.f & FLAG_C) === 0);
        return;
      case 0xd8:
        this.decodeRet((this.regs.f & FLAG_C) !== 0);
        return;
      case 0xc5:
        this.enqueuePushWord(() => this.getPair('BC'));
        return;
      case 0xd5:
        this.enqueuePushWord(() => this.getPair('DE'));
        return;
      case 0xe5:
        this.enqueuePushWord(() => this.getPair(indexMode === 'HL' ? 'HL' : indexMode));
        return;
      case 0xf5:
        this.enqueuePushWord(() => this.getPair('AF'));
        return;
      case 0xc1:
        this.enqueuePopWord((word) => {
          this.setPair('BC', word);
        });
        return;
      case 0xd1:
        this.enqueuePopWord((word) => {
          this.setPair('DE', word);
        });
        return;
      case 0xe1:
        this.enqueuePopWord((word) => {
          this.setPair(indexMode === 'HL' ? 'HL' : indexMode, word);
        });
        return;
      case 0xf1:
        this.enqueuePopWord((word) => {
          this.setPair('AF', word);
        });
        return;
      case 0xdb:
        this.decodeInAImmediate();
        return;
      case 0xd3:
        this.decodeOutImmediateA();
        return;
      case 0xf3:
        this.enqueueInternal(() => {
          this.iff1 = false;
          this.iff2 = false;
        });
        return;
      case 0xfb:
        this.enqueueInternal(() => {
          this.iff1 = true;
          this.iff2 = true;
          this.deferInterruptAcceptance = true;
        });
        return;
      case 0xeb:
        this.enqueueInternal(() => {
          const de = this.getPair('DE');
          const hl = this.getPair(indexMode === 'HL' ? 'HL' : indexMode);
          this.setPair('DE', hl);
          this.setPair(indexMode === 'HL' ? 'HL' : indexMode, de);
        });
        return;
      default:
        this.handleUnsupported(opcode, indexMode === 'HL' ? undefined : indexMode);
    }
  }

  private decodeLdRImmediate(opcode: number, indexMode: IndexMode): void {
    const regCode = (opcode >>> 3) & 0x07;
    if (regCode === 6) {
      this.decodeLdPointerImmediate(indexMode);
      return;
    }

    this.enqueueReadPc((value) => {
      this.setRegByCode(regCode, value, indexMode);
    });
  }

  private decodeIncReg(opcode: number, indexMode: IndexMode): void {
    const regCode = (opcode >>> 3) & 0x07;
    if (regCode === 6) {
      this.decodeIncPointer(indexMode);
      return;
    }

    this.enqueueInternal(() => {
      const before = this.getRegByCode(regCode, indexMode);
      const after = clamp8(before + 1);
      this.setRegByCode(regCode, after, indexMode);
      this.regs.f =
        (this.regs.f & FLAG_C) |
        (after & (FLAG_X | FLAG_Y)) |
        (after === 0 ? FLAG_Z : 0) |
        (after & 0x80 ? FLAG_S : 0) |
        (before === 0x7f ? FLAG_PV : 0) |
        ((before & 0x0f) === 0x0f ? FLAG_H : 0);
    });
  }

  private decodeDecReg(opcode: number, indexMode: IndexMode): void {
    const regCode = (opcode >>> 3) & 0x07;
    if (regCode === 6) {
      this.decodeDecPointer(indexMode);
      return;
    }

    this.enqueueInternal(() => {
      const before = this.getRegByCode(regCode, indexMode);
      const after = clamp8(before - 1);
      this.setRegByCode(regCode, after, indexMode);
      this.regs.f =
        (this.regs.f & FLAG_C) |
        FLAG_N |
        (after & (FLAG_X | FLAG_Y)) |
        (after === 0 ? FLAG_Z : 0) |
        (after & 0x80 ? FLAG_S : 0) |
        (before === 0x80 ? FLAG_PV : 0) |
        ((before & 0x0f) === 0x00 ? FLAG_H : 0);
    });
  }

  private decodeLdPairImmediate(target: 'BC' | 'DE' | 'HL' | 'IX' | 'IY' | 'SP'): void {
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
      this.regs.f =
        (this.regs.f & FLAG_C) |
        (value & (FLAG_X | FLAG_Y)) |
        (value === 0 ? FLAG_Z : 0) |
        (value & FLAG_S) |
        (before === 0x7f ? FLAG_PV : 0) |
        ((before & 0x0f) === 0x0f ? FLAG_H : 0);
    });

    this.enqueueWriteMem(addr, () => value);
  }

  private decodeDecPointer(indexMode: IndexMode): void {
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
      this.regs.f =
        (this.regs.f & FLAG_C) |
        FLAG_N |
        (value & (FLAG_X | FLAG_Y)) |
        (value === 0 ? FLAG_Z : 0) |
        (value & FLAG_S) |
        (before === 0x80 ? FLAG_PV : 0) |
        ((before & 0x0f) === 0x00 ? FLAG_H : 0);
    });

    this.enqueueWriteMem(addr, () => value);
  }

  private decodeJr(takeBranch: boolean): void {
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
    if (!takeBranch) {
      this.enqueueInternal();
      return;
    }
    this.enqueuePopWord((word) => {
      this.regs.pc = word;
    });
  }

  private decodeInAImmediate(): void {
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
    let port = 0;
    this.enqueueReadPc((v) => {
      port = v;
    });
    this.enqueueWriteIo(() => port, () => this.regs.a);
  }

  private decodeIndexedCB(indexMode: 'IX' | 'IY'): void {
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
      this.decodeRotateTarget(readTarget, writeTarget, 'RLC');
      return;
    }
    if ((opcode & 0xf8) === 0x10) {
      this.decodeRotateTarget(readTarget, writeTarget, 'RL');
      return;
    }

    this.handleUnsupported(opcode, 'CB');
  }

  private decodeRotateTarget(
    readTarget: (target: (value: number) => void) => void,
    writeTarget: (value: () => number) => void,
    op: 'RLC' | 'RL'
  ): void {
    let readValue = 0;
    let result = 0;
    readTarget((value) => {
      readValue = value;
    });

    this.enqueueInternal(() => {
      if (op === 'RLC') {
        const carry = (readValue >>> 7) & 1;
        result = clamp8((readValue << 1) | carry);
        this.regs.f = this.getSzxyParityFlags(result) | (carry ? FLAG_C : 0);
        return;
      }

      const carryIn = (this.regs.f & FLAG_C) !== 0 ? 1 : 0;
      const carryOut = (readValue >>> 7) & 1;
      result = clamp8((readValue << 1) | carryIn);
      this.regs.f = this.getSzxyParityFlags(result) | (carryOut ? FLAG_C : 0);
    });

    writeTarget(() => result);
  }

  private decodeED(opcode: number): void {
    switch (opcode) {
      case 0x44:
      case 0x4c:
      case 0x54:
      case 0x5c:
      case 0x64:
      case 0x6c:
      case 0x74:
      case 0x7c:
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
      case 0x45:
      case 0x55:
      case 0x5d:
      case 0x65:
      case 0x6d:
      case 0x75:
      case 0x7d:
        this.enqueuePopWord((word) => {
          this.regs.pc = word;
          this.iff1 = this.iff2;
        });
        return;
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
      case 0xb0:
        this.decodeLdir();
        return;
      default:
        this.handleUnsupported(opcode, 'ED');
    }
  }

  private decodeLdir(): void {
    let value = 0;
    this.enqueueReadMem(() => this.getPair('HL'), (v) => {
      value = v;
    });
    this.enqueueWriteMem(() => this.getPair('DE'), () => value);
    this.enqueueInternal(() => {
      this.setPair('HL', clamp16(this.getPair('HL') + 1));
      this.setPair('DE', clamp16(this.getPair('DE') + 1));
      const bc = clamp16(this.getPair('BC') - 1);
      this.setPair('BC', bc);
      const baseFlags = this.regs.f & FLAG_C;
      this.regs.f = baseFlags | (bc !== 0 ? FLAG_PV : 0);
      if (bc !== 0) {
        this.enqueueIdle(5);
        this.enqueueInternal(() => {
          this.regs.pc = clamp16(this.regs.pc - 2);
        });
      }
    });
  }

  private getCbAddress(indexMode: IndexMode, displacement: number): number {
    if (indexMode === 'HL') {
      return this.getPair('HL');
    }
    return clamp16(this.getPair(indexMode) + displacement);
  }

  private addToA(value: number, carryIn: boolean): void {
    const carry = carryIn ? 1 : 0;
    const left = this.regs.a;
    const right = clamp8(value);
    const result = clamp8(left + right + carry);

    this.regs.a = result;
    this.regs.f =
      (result & (FLAG_S | FLAG_X | FLAG_Y)) |
      (result === 0 ? FLAG_Z : 0) |
      (halfCarryAdd8(left, right, carry) ? FLAG_H : 0) |
      (overflowAdd8(left, right + carry, result) ? FLAG_PV : 0) |
      (((left + right + carry) & 0x100) !== 0 ? FLAG_C : 0);
  }

  private subFromA(value: number, carryIn: boolean): void {
    const carry = carryIn ? 1 : 0;
    const left = this.regs.a;
    const right = clamp8(value);
    const result = clamp8(left - right - carry);

    this.regs.a = result;
    this.regs.f =
      FLAG_N |
      (result & (FLAG_S | FLAG_X | FLAG_Y)) |
      (result === 0 ? FLAG_Z : 0) |
      (halfCarrySub8(left, right, carry) ? FLAG_H : 0) |
      (overflowSub8(left, right + carry, result) ? FLAG_PV : 0) |
      (left < (right + carry) ? FLAG_C : 0);
  }

  private compareWithA(value: number): void {
    const left = this.regs.a;
    const right = clamp8(value);
    const result = clamp8(left - right);
    this.regs.f =
      FLAG_N |
      (result & FLAG_S) |
      (result === 0 ? FLAG_Z : 0) |
      (halfCarrySub8(left, right, 0) ? FLAG_H : 0) |
      (overflowSub8(left, right, result) ? FLAG_PV : 0) |
      (left < right ? FLAG_C : 0) |
      (right & (FLAG_X | FLAG_Y));
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
