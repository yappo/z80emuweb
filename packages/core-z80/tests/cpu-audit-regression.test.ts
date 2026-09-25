import { describe, expect, it } from 'vitest';
import { Z80Cpu } from '../src/z80-cpu';
import { Z80_DEFAULT_PINS_IN, type CpuRegisters, type CpuState, type Z80PinsIn, type Z80PinsOut } from '../src/types';

// Oracle: Zilog UM008011-0816, instruction entries and Timing/Interrupt Response.
// No expected durations/flags are imported from the implementation timing table.
class Machine {
  readonly cpu = new Z80Cpu();
  readonly memory = new Uint8Array(65536);
  readonly trace: Z80PinsOut[] = [];
  readonly writes: [number, number][] = [];
  pins = this.cpu.getPinsOut();
  vector = 0xff;
  ioData = 0x42;
  private writing = false;

  constructor(bytes: number[] = [], registers: Partial<CpuRegisters> = {}, state: Partial<CpuState> = {}) {
    this.memory.set(bytes);
    const initial = this.cpu.getState();
    this.cpu.loadState({ ...initial, ...state, registers: {
      ...initial.registers, sp: 0x9000, h: 0x20, d: 0x30, ix: 0x2000, iy: 0x2000, ...registers
    } });
  }

  tick(lines: Partial<Z80PinsIn> = {}): Z80PinsOut {
    const data = this.pins.m1 && this.pins.iorq ? this.vector :
      this.pins.mreq && this.pins.rd ? (this.memory[this.pins.addr] ?? 0xff) : this.ioData;
    this.pins = this.cpu.tick({ ...Z80_DEFAULT_PINS_IN, data, ...lines });
    this.trace.push(this.pins);
    const writing = this.pins.wr && this.pins.mreq;
    if (writing && !this.writing) {
      this.memory[this.pins.addr] = this.pins.dataOut!;
      this.writes.push([this.pins.addr, this.pins.dataOut!]);
    }
    this.writing = writing;
    return this.pins;
  }

  instruction(lines: Partial<Z80PinsIn> = {}): number {
    let ticks = 0;
    do {
      this.tick(lines);
      if (++ticks > 100) throw new Error('instruction did not complete');
    } while (this.cpu.getState().queueDepth !== 0);
    return ticks;
  }
}

type TimingCase = [string, number[], number, Partial<CpuRegisters>?];
const timings: TimingCase[] = [
  ['NOP', [0x00], 4], ['HALT', [0x76], 4], ['LD B,C', [0x41], 4],
  ['LD A,n', [0x3e, 42], 7], ['LD BC,nn', [0x01, 0x34, 0x12], 10],
  ['LD A,(BC)', [0x0a], 7], ['LD (DE),A', [0x12], 7], ['LD r,(HL)', [0x46], 7],
  ['LD (HL),r', [0x70], 7], ['LD (HL),n', [0x36, 42], 10],
  ['LD A,(nn)', [0x3a, 0, 0x20], 13], ['LD (nn),A', [0x32, 0, 0x20], 13],
  ['LD HL,(nn)', [0x2a, 0, 0x20], 16], ['LD (nn),HL', [0x22, 0, 0x20], 16],
  ['LD SP,HL', [0xf9], 6], ['INC BC', [0x03], 6], ['DEC DE', [0x1b], 6],
  ['INC HL', [0x23], 6], ['DEC SP', [0x3b], 6], ['ADD HL,BC', [0x09], 11],
  ['INC A', [0x3c], 4], ['DEC L', [0x2d], 4], ['INC (HL)', [0x34], 11], ['DEC (HL)', [0x35], 11],
  ['PUSH BC', [0xc5], 11], ['POP BC', [0xc1], 10], ['EX (SP),HL', [0xe3], 19],
  ['EX DE,HL', [0xeb], 4], ['EX AF,AF', [0x08], 4], ['EXX', [0xd9], 4],
  ['DAA', [0x27], 4], ['SCF', [0x37], 4], ['CCF', [0x3f], 4], ['CPL', [0x2f], 4],
  ['DI', [0xf3], 4], ['EI', [0xfb], 4], ['RLCA', [0x07], 4], ['RRA', [0x1f], 4],
  ['JP nn', [0xc3, 0x34, 0x12], 10], ['JP NZ taken', [0xc2, 0x34, 0x12], 10],
  ['JP NZ not taken', [0xc2, 0x34, 0x12], 10, { f: 0x40 }], ['JP (HL)', [0xe9], 4],
  ['JR', [0x18, 2], 12], ['JR NZ taken', [0x20, 2], 12],
  ['JR NZ not taken', [0x20, 2], 7, { f: 0x40 }],
  ['DJNZ taken', [0x10, 2], 13, { b: 2 }], ['DJNZ not taken', [0x10, 2], 8, { b: 1 }],
  ['CALL', [0xcd, 0x34, 0x12], 17], ['CALL NZ taken', [0xc4, 0x34, 0x12], 17],
  ['CALL NZ not taken', [0xc4, 0x34, 0x12], 10, { f: 0x40 }],
  ['RET', [0xc9], 10], ['RET NZ taken', [0xc0], 11], ['RET NZ not taken', [0xc0], 5, { f: 0x40 }],
  ['RST 38', [0xff], 11], ['IN A,(n)', [0xdb, 0x10], 11], ['OUT (n),A', [0xd3, 0x10], 11],
  ['RLC B', [0xcb, 0x00], 8], ['RL (HL)', [0xcb, 0x16], 15], ['BIT 0,B', [0xcb, 0x40], 8],
  ['BIT 0,(HL)', [0xcb, 0x46], 12], ['RES 0,B', [0xcb, 0x80], 8], ['SET 0,(HL)', [0xcb, 0xc6], 15],
  ['NEG', [0xed, 0x44], 8], ['IM 0', [0xed, 0x46], 8], ['IM 1', [0xed, 0x56], 8], ['IM 2', [0xed, 0x5e], 8],
  ['LD A,I', [0xed, 0x57], 9], ['LD A,R', [0xed, 0x5f], 9], ['LD I,A', [0xed, 0x47], 9], ['LD R,A', [0xed, 0x4f], 9],
  ['RETN', [0xed, 0x45], 14], ['RETI', [0xed, 0x4d], 14],
  ['ADC HL,BC', [0xed, 0x4a], 15], ['SBC HL,BC', [0xed, 0x42], 15],
  ['LD BC,(nn)', [0xed, 0x4b, 0, 0x20], 20], ['LD (nn),SP', [0xed, 0x73, 0, 0x20], 20],
  ['IN B,(C)', [0xed, 0x40], 12], ['OUT (C),B', [0xed, 0x41], 12],
  ['RRD', [0xed, 0x67], 18], ['RLD', [0xed, 0x6f], 18]
];
for (let group = 0; group < 8; group++) {
  timings.push([`ALU group ${group} r`, [0x80 + group * 8], 4]);
  timings.push([`ALU group ${group} (HL)`, [0x86 + group * 8], 7]);
  timings.push([`ALU group ${group} n`, [0xc6 + group * 8, 1], 7]);
}
for (const prefix of [0xdd, 0xfd]) {
  for (const [name, suffix, time] of [
    ['LD index,nn', [0x21, 0, 0x20], 14], ['LD r,(index+d)', [0x66, 1], 19],
    ['LD (index+d),r', [0x75, 1], 19], ['LD (index+d),n', [0x36, 1, 42], 19],
    ['INC (index+d)', [0x34, 1], 23], ['DEC (index+d)', [0x35, 1], 23],
    ['ADD A,(index+d)', [0x86, 1], 19], ['ADD index,SP', [0x39], 15],
    ['INC index', [0x23], 10], ['DEC index', [0x2b], 10], ['JP (index)', [0xe9], 8],
    ['LD SP,index', [0xf9], 10], ['PUSH index', [0xe5], 15], ['POP index', [0xe1], 14],
    ['EX (SP),index', [0xe3], 23], ['BIT 0,(index+d)', [0xcb, 1, 0x46], 20],
    ['RLC (index+d)', [0xcb, 1, 0x06], 23], ['RES 0,(index+d)', [0xcb, 1, 0x86], 23],
    ['SET 0,(index+d)', [0xcb, 1, 0xc6], 23]
  ] as [string, number[], number][]) timings.push([`${prefix.toString(16)} ${name}`, [prefix, ...suffix], time]);
}
for (const op of [0xa0, 0xa8, 0xa1, 0xa9, 0xa2, 0xaa, 0xa3, 0xab]) timings.push([
  `block ${op.toString(16)}`, [0xed, op], 16, { b: 1, c: 2, a: 1 }
]);
for (const op of [0xb0, 0xb8, 0xb1, 0xb9, 0xb2, 0xba, 0xb3, 0xbb]) {
  timings.push([`block ${op.toString(16)} repeat`, [0xed, op], 21, { b: 2, c: 2, a: 1 }]);
  timings.push([`block ${op.toString(16)} final`, [0xed, op], 16, { b: (op & 2) ? 1 : 0, c: 1, a: 1 }]);
}

describe('documented instruction T-state totals (WAIT inactive)', () => {
  it.each(timings)('%s', (_name, bytes, expected, registers) => {
    const m = new Machine(bytes, registers);
    expect(m.instruction()).toBe(expected);
  });
  it('repeated LDIR includes fresh opcode fetches and ends in 21 + 16 states', () => {
    const m = new Machine([0xed, 0xb0], { c: 2 });
    m.memory.set([0x12, 0x34], 0x2000);
    expect(m.instruction()).toBe(21);
    expect(m.cpu.getState().registers.pc).toBe(0);
    expect(m.instruction()).toBe(16);
    expect([...m.memory.slice(0x3000, 0x3002)]).toEqual([0x12, 0x34]);
  });
  it.each([0xdd, 0xfd])('indexed CB %i fetches exactly two M1 opcodes', (prefix) => {
    const m = new Machine([prefix, 0xcb, 1, 0x06]);
    m.memory[0x2001] = 0x81;
    m.instruction();
    expect(m.cpu.getState().registers.r).toBe(2);
    expect(m.trace.filter(p => p.rfsh)).toHaveLength(2);
    expect(m.memory[0x2001]).toBe(3);
  });
  it('CALL/RET use the correct stack addresses and return PC', () => {
    const m = new Machine([0xcd, 0x00, 0x10]); m.memory[0x1000] = 0xc9;
    expect(m.instruction()).toBe(17);
    expect(m.writes).toEqual([[0x8fff, 0], [0x8ffe, 3]]);
    expect(m.instruction()).toBe(10);
    expect(m.cpu.getState().registers).toMatchObject({ pc: 3, sp: 0x9000 });
  });
});

const signed = (n: number) => n < 128 ? n : n - 256;
describe('documented arithmetic flags', () => {
  it.each(['ADD', 'ADC', 'SUB', 'SBC', 'CP'])('%s exhaustive input combinations', (op) => {
    const opcode = { ADD: 0x80, ADC: 0x88, SUB: 0x90, SBC: 0x98, CP: 0xb8 }[op]!;
    const m = new Machine([opcode]);
    const initial = m.cpu.getState();
    const subtract = ['SUB', 'SBC', 'CP'].includes(op);
    let tested = 0;
    for (let a = 0; a < 256; a++) for (let b = 0; b < 256; b++) {
      for (let carry = 0; carry < (['ADC', 'SBC'].includes(op) ? 2 : 1); carry++) {
        m.cpu.loadState({ ...initial, registers: { ...initial.registers, a, b, f: carry } });
        // Observe the complete opcode through the public pin interface.
        for (let t = 0; t < 4; t++) m.cpu.tick({ ...Z80_DEFAULT_PINS_IN, data: opcode });
        const result = subtract ? a - b - carry : a + b + carry;
        const sr = subtract ? signed(a) - signed(b) - carry : signed(a) + signed(b) + carry;
        const low = subtract ? (a % 16) - (b % 16) - carry : (a % 16) + (b % 16) + carry;
        const byte = ((result % 256) + 256) % 256;
        const expected = (byte >= 128 ? 0x80 : 0) | (byte === 0 ? 0x40 : 0) |
          (low < 0 || low > 15 ? 0x10 : 0) | (sr < -128 || sr > 127 ? 4 : 0) |
          (subtract ? 2 : 0) | (result < 0 || result > 255 ? 1 : 0);
        const actual = m.cpu.getState().registers;
        if ((actual.f & 0xd7) !== expected || actual.a !== (op === 'CP' ? a : byte)) {
          throw new Error(`${op} A=${a} B=${b} C=${carry}: A=${actual.a} F=${actual.f.toString(16)}, expected A=${op === 'CP' ? a : byte} F=${expected.toString(16)}`);
        }
        tested++;
      }
    }
    expect(tested).toBe(['ADC', 'SBC'].includes(op) ? 131072 : 65536);
  });
  it('NEG has half-borrow exactly when the low nibble is nonzero', () => {
    for (let a = 0; a < 256; a++) {
      const m = new Machine([0xed, 0x44], { a }); m.instruction();
      const byte = (-a) & 255;
      const flags = 2 | (byte >= 128 ? 128 : 0) | (byte === 0 ? 64 : 0) |
        (a % 16 !== 0 ? 16 : 0) | (a === 128 ? 4 : 0) | (a !== 0 ? 1 : 0);
      expect(m.cpu.getState().registers.f & 0xd7, `A=${a}`).toBe(flags);
    }
  });
  it.each([0xa0, 0xa8, 0xb0, 0xb8])('block transfer ED %i preserves S/Z/C, clears H/N, derives PV from BC', (op) => {
    for (const f of [0, 0xff, 0x80, 0x40, 1]) for (const c of [1, 2]) {
      const m = new Machine([0xed, op], { f, c }); m.memory[0x2000] = 42;
      m.instruction();
      expect(m.memory[0x3000]).toBe(42);
      expect(m.cpu.getState().registers.f & 0xd7).toBe((f & 0xc1) | (c === 2 ? 4 : 0));
    }
  });
  it.each([
    ['ADC n', [0xce, 0x7f], 4], ['ADC (HL)', [0x8e], 4],
    ['SBC n', [0xde, 0x7f], 0], ['SBC (HL)', [0x9e], 0]
  ] as [string, number[], number][])('%s shares the corrected overflow rule', (_name, bytes, pv) => {
    const m = new Machine(bytes, { f: 1 }); m.memory[0x2000] = 0x7f; m.instruction();
    expect(m.cpu.getState().registers).toMatchObject({ a: 0x80 });
    expect(m.cpu.getState().registers.f & 4).toBe(pv);
  });
});

describe('interrupt semantics and timing', () => {
  it('initialization and RESET select IM0 and clear both IFFs', () => {
    const m = new Machine(); expect(m.cpu.getState().im).toBe(0);
    m.cpu.loadState({ ...m.cpu.getState(), im: 2, iff1: true, iff2: true });
    m.tick({ reset: true });
    expect(m.cpu.getState()).toMatchObject({ im: 0, iff1: false, iff2: false });
  });
  it('does not remember an INT pulse received while interrupts are disabled', () => {
    const m = new Machine([0xf3, 0xfb, 0x00, 0x76]);
    m.tick({ int: true });
    for (let t = 1; t < 16; t++) m.tick();
    expect(m.cpu.getState()).toMatchObject({ halted: true, pendingInt: false });
    expect(m.cpu.getState().registers).toMatchObject({ pc: 4, sp: 0x9000 });
  });
  it.each([0, 1, 2] as const)('IM%i acknowledge samples bus data and uses documented total', (im) => {
    const m = new Machine([], { i: 0x40, pc: 0x1234 }, { im, iff1: true, iff2: true });
    m.vector = im === 2 ? 0x10 : 0xff;
    m.memory[0x4010] = 0x78; m.memory[0x4011] = 0x56;
    expect(m.instruction({ int: true })).toBe(im === 2 ? 19 : 13);
    expect(m.cpu.getState().registers).toMatchObject({ pc: im === 2 ? 0x5678 : 0x38, sp: 0x8ffe, r: 1 });
    expect(m.writes).toEqual([[0x8fff, 0x12], [0x8ffe, 0x34]]);
    const ack = m.trace.filter(p => p.m1 && p.iorq);
    expect(ack.length).toBeGreaterThan(0);
    expect(ack.every(p => !p.rd && !p.wr && !p.mreq)).toBe(true);
  });
  it('IM0 can execute a supplied non-RST instruction without fetching it from memory', () => {
    const m = new Machine([0x76], {}, { iff1: true, iff2: true }); m.vector = 0x00;
    expect(m.instruction({ int: true })).toBe(6);
    expect(m.cpu.getState().registers.pc).toBe(0);
    expect(m.cpu.getState().halted).toBe(false);
  });
  it('EI defers a held INT until the following instruction completes', () => {
    const m = new Machine([0xfb, 0x06, 42], {}, { im: 1 });
    expect(m.instruction({ int: true })).toBe(4);
    expect(m.instruction({ int: true })).toBe(7);
    expect(m.cpu.getState().registers.b).toBe(42);
    expect(m.instruction({ int: true })).toBe(13);
    expect(m.memory[0x8ffe]).toBe(3);
  });
  it('HALT repeats four-state refresh cycles and resumes after EI/HALT', () => {
    const m = new Machine([0xfb, 0x76], {}, { im: 1 });
    expect(m.instruction()).toBe(4); expect(m.instruction()).toBe(4);
    expect(m.instruction()).toBe(4);
    expect(m.cpu.getState().registers).toMatchObject({ pc: 2, r: 3 });
    expect(m.instruction({ int: true })).toBe(13);
    expect(m.cpu.getState().halted).toBe(false);
    expect(m.memory[0x8ffe]).toBe(2);
  });
  it('nested NMI preserves IFF2; RETN restores IFF1 and PC', () => {
    const m = new Machine([], { pc: 0x1234 }, { iff1: true, iff2: true });
    m.memory.set([0xed, 0x45], 0x66);
    expect(m.instruction({ nmi: true })).toBe(11);
    expect(m.cpu.getState()).toMatchObject({ iff1: false, iff2: true });
    m.tick({ nmi: false }); // begin RETN, then latch another NMI edge
    m.tick({ nmi: true });
    while (m.cpu.getState().queueDepth) m.tick();
    expect(m.instruction()).toBe(11);
    expect(m.cpu.getState()).toMatchObject({ iff1: false, iff2: true });
    expect(m.instruction()).toBe(14);
    expect(m.cpu.getState()).toMatchObject({ iff1: true, iff2: true });
    expect(m.cpu.getState().registers).toMatchObject({ pc: 0x1234, sp: 0x9000 });
  });
  it('a second NMI before RETN does not erase IFF2', () => {
    const m = new Machine([], {}, { iff1: true, iff2: true });
    expect(m.instruction({ nmi: true })).toBe(11);
    m.tick({ nmi: false }); m.tick({ nmi: true });
    while (m.cpu.getState().queueDepth) m.tick();
    expect(m.instruction()).toBe(11);
    expect(m.cpu.getState()).toMatchObject({ iff1: false, iff2: true });
    expect(m.cpu.getState().registers.sp).toBe(0x8ffc);
  });
});

describe('WAIT and machine-cycle bus handoff', () => {
  it.each([0, 1, 2, 3])('BUSRQ in NOP phase %i finishes M1 before granting the bus', (phase) => {
    const m = new Machine([0]);
    // Raise at T1/T2/T3/T4 after entering this machine cycle.
    for (let i = 0; i <= phase; i++) m.tick();
    for (let i = phase + 1; i < 4; i++) expect(m.tick({ busrq: true }).busak).toBe(false);
    expect(m.tick({ busrq: true }).busak).toBe(true);
    const before = m.cpu.getState();
    for (let i = 0; i < 3; i++) expect(m.tick({ busrq: true })).toMatchObject({ busak: true, rd: false, wr: false, mreq: false, iorq: false, dataOut: null });
    expect(m.cpu.getState().registers).toEqual(before.registers);
    expect(m.tick().busak).toBe(false);
  });
  it('BUSRQ can stop between operand reads, without waiting for the whole instruction', () => {
    const m = new Machine([0x01, 0x34, 0x12]);
    for (let t = 0; t < 5; t++) m.tick(); // M2 T1
    expect(m.tick({ busrq: true }).busak).toBe(false);
    expect(m.tick({ busrq: true }).busak).toBe(false);
    expect(m.tick({ busrq: true }).busak).toBe(true);
    expect(m.cpu.getState().registers.pc).toBe(2);
    for (let t = 0; t < 3; t++) m.tick();
    expect(m.cpu.getState().registers).toMatchObject({ b: 0x12, c: 0x34, pc: 3 });
  });
  it('WAIT holds the address and blocks BUSAK until the memory cycle completes', () => {
    const m = new Machine([0x3e, 42]);
    for (let t = 0; t < 5; t++) m.tick();
    for (let t = 0; t < 3; t++) expect(m.tick({ wait: true, busrq: true })).toMatchObject({ addr: 1, rd: true, mreq: true, busak: false });
    expect(m.tick({ busrq: true }).busak).toBe(false); // finish T2
    expect(m.tick({ busrq: true }).busak).toBe(false); // T3 samples data
    expect(m.cpu.getState().registers.a).toBe(42);
    expect(m.tick({ busrq: true }).busak).toBe(true);
    expect(m.cpu.getState().tstates).toBe(11); // 7 + 3 waits + 1 bus hold
  });
  it('a write finishes once before BUSAK, and its address/data survive WAIT', () => {
    const m = new Machine([0x77], { a: 42 });
    for (let t = 0; t < 5; t++) m.tick();
    for (let t = 0; t < 2; t++) expect(m.tick({ wait: true, busrq: true })).toMatchObject({ addr: 0x2000, dataOut: 42, wr: true, busak: false });
    m.tick({ busrq: true }); m.tick({ busrq: true });
    expect(m.tick({ busrq: true }).busak).toBe(true);
    expect(m.writes).toEqual([[0x2000, 42]]);
  });
  it('an extended five-state PUSH fetch is not interrupted at T4', () => {
    const m = new Machine([0xc5]);
    for (let t = 0; t < 4; t++) m.tick();
    expect(m.tick({ busrq: true }).busak).toBe(false);
    expect(m.tick({ busrq: true }).busak).toBe(true);
    expect(m.writes).toEqual([]);
  });
  it.each([0xdb, 0xd3])('IO opcode %i samples WAIT in Tw and completes before BUSAK', (opcode) => {
    const m = new Machine([opcode, 0x10], { a: 0x34 });
    for (let t = 0; t < 9; t++) m.tick(); // fetch + operand + IO T1/T2
    for (let t = 0; t < 3; t++) expect(m.tick({ wait: true, busrq: true })).toMatchObject({ addr: 0x3410, iorq: true, busak: false });
    m.tick({ busrq: true }); // mandatory Tw completes
    m.tick({ busrq: true }); // T3 completes
    expect(m.cpu.getState().tstates).toBe(14); // 11 + three external waits
    expect(m.tick({ busrq: true }).busak).toBe(true);
    if (opcode === 0xdb) expect(m.cpu.getState().registers.a).toBe(0x42);
  });
  it('INT acknowledge can wait and yields the bus before its stack writes', () => {
    const m = new Machine([], {}, { iff1: true, iff2: true, im: 1 });
    for (let t = 0; t < 3; t++) m.tick({ int: true });
    for (let t = 0; t < 2; t++) expect(m.tick({ int: true, wait: true, busrq: true })).toMatchObject({ m1: true, iorq: true, rd: false, busak: false });
    for (let t = 0; t < 4; t++) expect(m.tick({ int: true, busrq: true }).busak).toBe(false);
    expect(m.tick({ int: true, busrq: true }).busak).toBe(true);
    expect(m.writes).toEqual([]);
    for (let t = 0; t < 6; t++) m.tick();
    expect(m.cpu.getState().registers).toMatchObject({ pc: 0x38, sp: 0x8ffe });
    expect(m.cpu.getState().tstates).toBe(16); // 13 + two waits + one bus hold
  });
  it('WAIT outside the sampling phase does not extend a fetch', () => {
    const m = new Machine([0]);
    m.tick({ wait: true }); m.tick(); m.tick({ wait: true }); m.tick({ wait: true });
    expect(m.cpu.getState().queueDepth).toBe(0);
    expect(m.cpu.getState().tstates).toBe(4);
  });
});
