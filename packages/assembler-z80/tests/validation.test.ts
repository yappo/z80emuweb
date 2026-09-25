import { describe, expect, it } from 'vitest';
import { assemble } from '../src/index';

const fullMemory = { addressRange: { start: 0, end: 0xffff } };
const values = (source: string) => Object.fromEntries(assemble(source).symbols.map(s => [s.name, s.value]));

describe('LD operand combinations', () => {
  // Zilog UM008011-0816 pp.71–87; index halves are an existing assembler extension.
  it.each([
    ['LD H,(IX+1)', [0xdd, 0x66, 1]], ['LD L,(IY-1)', [0xfd, 0x6e, 0xff]],
    ['LD (IX+2),H', [0xdd, 0x74, 2]], ['LD (IY+3),L', [0xfd, 0x75, 3]],
    ['LD H,(HL)', [0x66]], ['LD (HL),L', [0x75]], ['LD H,L', [0x65]],
    ['LD IXH,IXL', [0xdd, 0x65]], ['LD IYL,IYH', [0xfd, 0x6c]],
    ['LD B,IXH', [0xdd, 0x44]], ['LD IXH,B', [0xdd, 0x60]],
    ['LD A,IYL', [0xfd, 0x7d]], ['LD IYL,A', [0xfd, 0x6f]],
    ['LD IXH,42', [0xdd, 0x26, 42]], ['LD (IX),42', [0xdd, 0x36, 0, 42]]
  ] as [string, number[]][])('encodes %s exactly', (source, bytes) => {
    const r = assemble(source);
    expect(r.diagnostics).toEqual([]);
    expect([...r.binary]).toEqual(bytes);
  });
  const invalid: string[] = [];
  for (const half of ['IXH', 'IXL', 'IYH', 'IYL']) {
    for (const other of ['H', 'L', '(HL)', '(IX+1)', '(IY-1)']) {
      invalid.push(`LD ${half},${other}`, `LD ${other},${half}`);
    }
  }
  invalid.push('LD IXH,IYL', 'LD IYL,IXH', 'LD (HL),(HL)', 'LD (IX),(IY)', 'LD (IX),(IX)');
  it.each(invalid)('rejects unencodable %s', source => {
    const r = assemble(source, { filename: 'operands.asm' });
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]).toMatchObject({ file: 'operands.asm', line: 1, severity: 'error' });
  });
});

describe('symbol resolution and fixed layout', () => {
  it('evaluates EQU $ at the definition address', () => {
    const r = assemble('ORG 0x100\nSTART: DB 1,2,3\nSIZE EQU $-START\nDW SIZE');
    expect(r.diagnostics).toEqual([]);
    expect([...r.binary]).toEqual([1, 2, 3, 3, 0]);
    expect(r.symbols).toContainEqual({ name: 'SIZE', value: 3, kind: 'equ' });
  });
  it('retains definition addresses when EQU depends on later labels/constants', () => {
    const source = 'ORG 0x100\nDIST EQU END_LABEL-$\nOTHER EQU DIST+1\nDB 1,2,3\nEND_LABEL:\nDW OTHER';
    const r = assemble(source);
    expect(r.diagnostics).toEqual([]);
    expect([...r.binary]).toEqual([1, 2, 3, 4, 0]);
  });
  it('uses already resolvable constants and labels in ORG and DS', () => {
    const source = 'BASE EQU 0x100\nCOUNT EQU NEXT_COUNT+1\nNEXT_COUNT EQU 3\nORG BASE\nSTART:\nDS COUNT,0xaa\nLEN EQU $-START\nDS LEN,0xbb\nNEXT: DB 42';
    const r = assemble(source);
    expect(r.diagnostics).toEqual([]);
    expect(r.origin).toBe(0x100);
    expect([...r.binary]).toEqual([0xaa, 0xaa, 0xaa, 0xaa, 0xbb, 0xbb, 0xbb, 0xbb, 42]);
    expect(values(source)).toMatchObject({ START: 0x100, LEN: 4, NEXT: 0x108 });
    expect(r.listing.map(l => l.address)).toEqual([0x100, 0x104, 0x108]);
  });
  it('retains $ for EQU inside INCLUDE and keeps forward instruction references', () => {
    const r = assemble('ORG 0x100\nINCLUDE "defs.asm"\nJP TARGET\nTARGET: NOP\nDW HERE', {
      filename: 'main.asm', includeResolver: () => ({ filename: 'defs.asm', source: 'DB 42\nHERE EQU $' })
    });
    expect(r.diagnostics).toEqual([]);
    expect([...r.binary]).toEqual([42, 0xc3, 0x04, 0x01, 0, 0x01, 0x01]);
    expect(r.listing[0]).toMatchObject({ file: 'defs.asm', line: 1, address: 0x100 });
  });
  it('ENTRY $ uses the address of its own statement', () => {
    const r = assemble('ORG 0x100\nDB 42\nENTRY $\nNOP');
    expect(r.ok).toBe(true); expect(r.entry).toBe(0x101);
  });
  it.each([
    'ORG LATER\nLATER EQU 0x100\nNOP', 'DS LATER\nLATER EQU 4\nNOP',
    'A EQU B\nB EQU A\nDW A', 'A EQU A+1\nDB 1', 'A EQU MISSING\nDB 1'
  ])('diagnoses unresolved layout or EQU: %s', source => {
    const r = assemble(source, { filename: 'symbols.asm' });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some(d => d.file === 'symbols.asm' && d.line > 0 && d.column > 0)).toBe(true);
  });
  it('allows a one-past-the-end EQU to calculate a full image size', () => {
    const r = assemble('START: DS 65536\nSIZE EQU $-START', fullMemory);
    expect(r.ok).toBe(true);
    expect(r.symbols).toContainEqual({ name: 'SIZE', value: 65536, kind: 'equ' });
  });
});

describe('source diagnostics', () => {
  it.each([
    'ORG', 'ENTRY', 'VALUE EQU', 'EQU 1', 'DS', 'DS 1,256', 'DS -1',
    'DB 256', 'DB -129', 'DB', 'DW', 'DB 1,', 'DW 1,', 'ORG 1,2', 'END 1',
    'DB "unterminated', 'DB 1/0', 'DS 1,1/0', 'NOP 1', 'DB (1', 'DB 1)',
    'DS 1000000000', 'DS 9007199254740992', 'ENTRY 65536', 'ENTRY -1'
  ])('returns a located diagnostic instead of throwing for %s', source => {
    const r = assemble(`; header\n  ${source}`, { filename: 'bad.asm' });
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]).toMatchObject({ file: 'bad.asm', line: 2, severity: 'error' });
    expect(r.diagnostics[0]!.column).toBeGreaterThan(0);
  });
  it('preserves the included file and line on a directive error', () => {
    const r = assemble('INCLUDE "bad.asm"', { filename: 'main.asm', includeResolver: () => ({ filename: 'bad.asm', source: '; header\nDB 256' }) });
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]).toMatchObject({ file: 'bad.asm', line: 2 });
  });
  it('does not publish partial binary/listing when any source line fails', () => {
    const r = assemble('DB 1\nDB MISSING\nDB 3');
    expect(r.ok).toBe(false);
    expect(r.binary).toHaveLength(0);
    expect(r.listing).toEqual([]);
    expect(r.dump).toBe('');
  });
  it('stops parsing statements after END', () => {
    const r = assemble('DB 1\nEND\nDB "unterminated\nINVALID');
    expect(r.diagnostics).toEqual([]); expect([...r.binary]).toEqual([1]);
  });
  it('allows ENTRY to point outside the output range within the 16-bit address space', () => {
    const r = assemble('ENTRY 0x8000\nDB 1');
    expect(r.diagnostics).toEqual([]); expect(r.entry).toBe(0x8000);
  });
});

describe('comments and quoted literals', () => {
  it.each(["EX AF,AF' ; swap registers", "ex af,af';swap", "EX AF',AF ; swap", "EX AF,AF' ; unmatched ' quote"])(
    'handles the register apostrophe in %s', source => {
      const r = assemble(source); expect(r.diagnostics).toEqual([]); expect([...r.binary]).toEqual([8]);
    }
  );
  it('keeps semicolons and commas in strings, including escaped quotes and backslashes', () => {
    const source = String.raw`DB "a\";b,c",';','\'','\\' ; comment`;
    const r = assemble(source);
    expect(r.diagnostics).toEqual([]);
    expect([...r.binary]).toEqual([97, 34, 59, 98, 44, 99, 59, 39, 92]);
  });
  it('distinguishes character expressions from whole string literals', () => {
    const r = assemble("DB 'A'+'B', 'A'+1 ; comment");
    expect(r.diagnostics).toEqual([]); expect([...r.binary]).toEqual([131, 66]);
  });
  it('keeps apostrophes in supported symbol names', () => {
    const r = assemble("LABEL': DB 1 ; data\nDW LABEL' ; address");
    expect(r.diagnostics).toEqual([]); expect([...r.binary]).toEqual([1, 0, 0]);
  });
});

describe('address-space boundaries and overlaps', () => {
  it('accepts exactly 65536 bytes without losing listing/binary agreement', () => {
    const r = assemble('DS 65536,0xaa', fullMemory);
    expect(r.diagnostics).toEqual([]); expect(r.binary).toHaveLength(65536);
    expect(r.binary[0]).toBe(0xaa); expect(r.binary[65535]).toBe(0xaa);
    expect(r.listing[0]!.bytes).toHaveLength(65536);
  });
  it.each(['DS 65537,0xaa', 'ORG 0xffff\nDW 1', 'ORG 0xffff\nDB 1,2', 'ORG 0xffff\nLD A,1', 'ORG 0xffff\nDB 1\nDB 2', 'ORG 0x10000\nNOP', 'ORG -1\nNOP', 'ORG 0x100\nDB 1\nORG 0x100\nDB 2'])(
    'rejects overflow or overlap: %s', source => {
      const r = assemble(source, fullMemory);
      expect(r.ok).toBe(false); expect(r.binary).toHaveLength(0);
      expect(r.diagnostics.length).toBeGreaterThan(0);
    }
  );
  it('respects the default RAM boundary', () => {
    expect(assemble('ORG 0x7fff\nDB 1').ok).toBe(true);
    expect(assemble('ORG 0x7fff\nDW 1').ok).toBe(false);
  });
  it('keeps gaps and disjoint backward ORG bytes in the binary', () => {
    const r = assemble('ORG 0x104\nDB 5\nORG 0x100\nDB 1,2');
    expect(r.diagnostics).toEqual([]);
    expect(r.origin).toBe(0x100); expect(r.entry).toBe(0x104);
    expect([...r.binary]).toEqual([1, 2, 0, 0, 5]);
    expect(r.listing.map(l => l.address)).toEqual([0x104, 0x100]);
  });
  it.each([
    { start: -1, end: 0xffff }, { start: 0, end: 0x10000 },
    { start: 4, end: 3 }, { start: 0.5, end: 8 }, { start: 0, end: Infinity }
  ])('diagnoses invalid addressRange %o', addressRange => {
    const r = assemble('DB 1', { addressRange });
    expect(r.ok).toBe(false); expect(r.binary).toHaveLength(0);
    expect(r.diagnostics[0]!.message).toContain('addressRange');
  });
  it('handles a nonzero lower bound and zero-length reservations at the upper boundary', () => {
    const r = assemble('ORG 0x100\nDS 4,1\nDS 0\nSIZE EQU $-0x100', { addressRange: { start: 0x100, end: 0x103 } });
    expect(r.diagnostics).toEqual([]); expect([...r.binary]).toEqual([1, 1, 1, 1]);
    expect(r.symbols).toContainEqual({ name: 'SIZE', value: 4, kind: 'equ' });
    expect(assemble('DB 1', { addressRange: { start: 0x100, end: 0x103 } }).ok).toBe(false);
  });
});
