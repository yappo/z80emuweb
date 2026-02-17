import { describe, expect, it } from 'vitest';

import { assemble } from '../src/index';

describe('assembler-z80', () => {
  it('assembles basic program and emits dump/lst/sym', () => {
    const source = `
ORG 0x0000
ENTRY START
START: LD A,0x01
       LD (0x1000),A
       JP START
`;

    const result = assemble(source, { filename: 'basic.asm' });
    expect(result.ok).toBe(true);
    expect(result.origin).toBe(0x0000);
    expect(result.entry).toBe(0x0000);
    expect(Array.from(result.binary)).toEqual([0x3e, 0x01, 0x32, 0x00, 0x10, 0xc3, 0x00, 0x00]);
    expect(result.dump).toContain('0000: 3E013200 10C30000');
    expect(result.lst).toContain('START: LD A,0x01');
    expect(result.sym).toContain('START');
  });

  it('supports INCLUDE and EQU', () => {
    const files = new Map<string, string>([
      ['/prj/main.asm', 'ORG 0x0100\nENTRY START\nINCLUDE "sub.asm"\n'],
      ['/prj/sub.asm', 'CONST EQU 0x2A\nSTART: LD A,CONST\n']
    ]);

    const result = assemble(files.get('/prj/main.asm') ?? '', {
      filename: '/prj/main.asm',
      includeResolver: (from, includePath) => {
        const base = from.slice(0, from.lastIndexOf('/') + 1);
        const resolved = `${base}${includePath}`;
        const source = files.get(resolved);
        if (!source) {
          return undefined;
        }
        return { filename: resolved, source };
      }
    });

    expect(result.ok).toBe(true);
    expect(result.origin).toBe(0x0100);
    expect(result.entry).toBe(0x0100);
    expect(Array.from(result.binary)).toEqual([0x3e, 0x2a]);
    expect(result.sym).toContain('CONST');
    expect(result.sym).toContain('START');
  });

  it('covers representative Z80 mnemonics including indexed forms', () => {
    const source = `
ORG 0x0000
NOP
LD BC,0x1234
LD DE,0x5678
LD HL,0x9ABC
LD SP,0xFFF0
LD A,(BC)
LD (DE),A
LD A,(0x1000)
LD (0x1001),A
LD I,A
LD A,I
LD R,A
LD A,R
PUSH BC
POP BC
EX AF,AF'
EX DE,HL
EX (SP),HL
EXX
INC A
DEC A
INC BC
DEC BC
ADD A,B
ADC A,C
SUB D
SBC A,E
AND H
XOR L
OR (HL)
CP 0x10
ADD HL,BC
ADC HL,BC
SBC HL,DE
RLCA
RRCA
RLA
RRA
DAA
CPL
SCF
CCF
RLC B
RRC C
RL D
RR E
SLA H
SRA L
SLL (HL)
SRL A
BIT 3,A
RES 2,B
SET 1,C
JP NZ,0x0200
JR NZ,NEXT
DJNZ NEXT
CALL Z,0x0300
RET NZ
RST 0x18
IN A,(0x10)
OUT (0x11),A
IN B,(C)
OUT (C),B
IM 1
DI
EI
NEG
RLD
RRD
LDI
LDD
LDIR
LDDR
CPI
CPD
CPIR
CPDR
INI
IND
INIR
INDR
OUTI
OUTD
OTIR
OTDR
LD IX,0x2000
LD IY,0x2100
LD IXH,0x12
LD IYL,0x34
LD A,(IX+2)
LD (IY-1),A
INC (IX+1)
DEC (IY+2)
ADD A,(IX+1)
BIT 0,(IY+3)
JP (IX)
JP (IY)
PUSH IX
POP IY
EX DE,IX
EX (SP),IY
ADD IX,SP
ADD IY,DE
LD (0x3000),IX
LD IY,(0x3002)
LD SP,IX
NEXT: HALT
RETN
RETI
`;

    const result = assemble(source, { filename: 'mnemonics.asm' });
    expect(result.ok).toBe(true);
    expect(result.binary.length).toBeGreaterThan(100);
    expect(result.dump).toContain('0000:');
    expect(result.diagnostics).toHaveLength(0);
  });

  it('reports syntax/semantic errors with location', () => {
    const result = assemble('ORG 0x9000\nLD A,(IX+999)', { filename: 'bad.asm' });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]?.file).toBe('bad.asm');
  });
});
