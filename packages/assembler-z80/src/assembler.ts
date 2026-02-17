import { evaluateExpression } from './expression.js';
import type { AssembleOptions, AssembleResult, AssemblerDiagnostic, ListingRecord, SymbolEntry } from './types.js';

interface SourceLine {
  file: string;
  line: number;
  text: string;
}

interface ParsedLine {
  source: SourceLine;
  raw: string;
  label?: string;
  mnemonic?: string;
  operands: string[];
}

interface SymbolDef {
  name: string;
  key: string;
  kind: 'label' | 'equ';
  value?: number;
  expr?: string;
  file: string;
  line: number;
  column: number;
}

interface ParseState {
  firstOrigin?: number;
  entryExpr?: { expr: string; file: string; line: number; column: number };
}

interface EncodedReg8 {
  code: number;
  prefix?: 0xdd | 0xfd;
  dispExpr?: string;
}

class AssembleError extends Error {}

const RAM_START = 0x0000;
const RAM_END = 0x7fff;

const REG8_CODE = new Map<string, number>([
  ['B', 0],
  ['C', 1],
  ['D', 2],
  ['E', 3],
  ['H', 4],
  ['L', 5],
  ['A', 7]
]);

const COND_CODE = new Map<string, number>([
  ['NZ', 0],
  ['Z', 1],
  ['NC', 2],
  ['C', 3],
  ['PO', 4],
  ['PE', 5],
  ['P', 6],
  ['M', 7]
]);

const JR_CONDITIONS = new Set(['NZ', 'Z', 'NC', 'C']);

const BASE_MNEMONICS = [
  'ADC',
  'ADD',
  'AND',
  'BIT',
  'CALL',
  'CCF',
  'CP',
  'CPD',
  'CPDR',
  'CPI',
  'CPIR',
  'CPL',
  'DAA',
  'DEC',
  'DI',
  'DJNZ',
  'EI',
  'EX',
  'EXX',
  'HALT',
  'IM',
  'IN',
  'INC',
  'IND',
  'INDR',
  'INI',
  'INIR',
  'JP',
  'JR',
  'LD',
  'LDD',
  'LDDR',
  'LDI',
  'LDIR',
  'NEG',
  'NOP',
  'OR',
  'OTDR',
  'OTIR',
  'OUT',
  'OUTD',
  'OUTI',
  'POP',
  'PUSH',
  'RES',
  'RET',
  'RETI',
  'RETN',
  'RLA',
  'RL',
  'RLCA',
  'RLC',
  'RLD',
  'RRA',
  'RR',
  'RRCA',
  'RRD',
  'RST',
  'SBC',
  'SCF',
  'SET',
  'SLA',
  'SLL',
  'SRA',
  'SRL',
  'SUB',
  'XOR'
] as const;

export const Z80_MNEMONICS = [...BASE_MNEMONICS];

function addDiagnostic(
  diagnostics: AssemblerDiagnostic[],
  file: string,
  line: number,
  column: number,
  message: string
): void {
  diagnostics.push({
    severity: 'error',
    file,
    line,
    column,
    message
  });
}

function stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] ?? '';
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === ';' && !inSingle && !inDouble) {
      return line.slice(0, i);
    }
  }
  return line;
}

function splitOperands(raw: string): string[] {
  const out: string[] = [];
  let current = '';
  let depth = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i] ?? '';
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === '(') {
        depth += 1;
      } else if (ch === ')') {
        depth = Math.max(0, depth - 1);
      } else if (ch === ',' && depth === 0) {
        out.push(current.trim());
        current = '';
        continue;
      }
    }
    current += ch;
  }

  if (current.trim().length > 0) {
    out.push(current.trim());
  }

  return out;
}

function parseLine(line: SourceLine): ParsedLine {
  const body = stripComment(line.text).trim();
  if (body.length === 0) {
    return { source: line, raw: '', operands: [] };
  }

  let rest = body;
  let label: string | undefined;

  const colonLabel = rest.match(/^([A-Za-z_.$?][A-Za-z0-9_.$?']*)\s*:\s*(.*)$/);
  if (colonLabel) {
    label = colonLabel[1];
    rest = colonLabel[2] ?? '';
  } else {
    const equLabel = rest.match(/^([A-Za-z_.$?][A-Za-z0-9_.$?']*)\s+(EQU\b.*)$/i);
    if (equLabel) {
      label = equLabel[1];
      rest = equLabel[2] ?? '';
    }
  }

  rest = rest.trim();
  if (rest.length === 0) {
    return {
      source: line,
      raw: body,
      label,
      operands: []
    };
  }

  const mnemonicMatch = rest.match(/^([^\s]+)\s*(.*)$/);
  if (!mnemonicMatch) {
    return {
      source: line,
      raw: body,
      label,
      operands: []
    };
  }

  const mnemonic = mnemonicMatch[1]?.toUpperCase();
  const operandText = mnemonicMatch[2] ?? '';
  const operands = operandText.length > 0 ? splitOperands(operandText) : [];

  return {
    source: line,
    raw: body,
    label,
    mnemonic,
    operands
  };
}

function parseIncludePath(line: string): string | undefined {
  const body = stripComment(line).trim();
  const match = body.match(/^INCLUDE\s+(.+)$/i);
  if (!match) {
    return undefined;
  }
  const arg = match[1]?.trim() ?? '';
  const dq = arg.match(/^"([\s\S]*)"$/);
  if (dq) {
    return dq[1] ?? '';
  }
  const sq = arg.match(/^'([\s\S]*)'$/);
  if (sq) {
    return sq[1] ?? '';
  }
  return undefined;
}

function expandSource(
  source: string,
  filename: string,
  options: AssembleOptions,
  diagnostics: AssemblerDiagnostic[],
  stack: string[] = []
): SourceLine[] {
  const lines: SourceLine[] = [];
  const normalized = source.replace(/\r\n?/g, '\n').split('\n');

  for (let idx = 0; idx < normalized.length; idx += 1) {
    const text = normalized[idx] ?? '';
    const includePath = parseIncludePath(text);
    if (!includePath) {
      lines.push({ file: filename, line: idx + 1, text });
      continue;
    }

    if (!options.includeResolver) {
      addDiagnostic(
        diagnostics,
        filename,
        idx + 1,
        1,
        `INCLUDE requires includeResolver: ${includePath}`
      );
      continue;
    }

    const resolved = options.includeResolver(filename, includePath);
    if (!resolved) {
      addDiagnostic(diagnostics, filename, idx + 1, 1, `INCLUDE not found: ${includePath}`);
      continue;
    }

    if (stack.includes(resolved.filename)) {
      addDiagnostic(diagnostics, filename, idx + 1, 1, `Recursive INCLUDE: ${resolved.filename}`);
      continue;
    }

    const nested = expandSource(resolved.source, resolved.filename, options, diagnostics, [...stack, filename]);
    lines.push(...nested);
  }

  return lines;
}

function normalizeSymbolName(name: string): string {
  return name.trim().toUpperCase();
}

function isStringLiteral(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length < 2) {
    return false;
  }
  const q = trimmed[0];
  if (q !== '"' && q !== "'") {
    return false;
  }
  return trimmed[trimmed.length - 1] === q;
}

function decodeStringLiteral(raw: string): string {
  const trimmed = raw.trim();
  const quote = trimmed[0] ?? '"';
  let out = '';
  for (let i = 1; i < trimmed.length - 1; i += 1) {
    const ch = trimmed[i] ?? '';
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = trimmed[i + 1] ?? '';
    i += 1;
    switch (next) {
      case 'n':
        out += '\n';
        break;
      case 'r':
        out += '\r';
        break;
      case 't':
        out += '\t';
        break;
      case '0':
        out += '\0';
        break;
      case '\\':
        out += '\\';
        break;
      case '"':
        out += '"';
        break;
      case "'":
        out += "'";
        break;
      default:
        // Unknown escape: keep literal to avoid silent truncation.
        out += next;
        break;
    }
  }
  if ((trimmed[trimmed.length - 1] ?? '') !== quote) {
    throw new AssembleError('Unterminated string literal');
  }
  return out;
}

function parseIndexIndirect(op: string): { prefix: 0xdd | 0xfd; dispExpr: string } | undefined {
  const match = op.trim().match(/^\(\s*(IX|IY)\s*(?:([+-])\s*(.+))?\s*\)$/i);
  if (!match) {
    return undefined;
  }
  const register = (match[1] ?? '').toUpperCase();
  const sign = match[2];
  const expr = (match[3] ?? '0').trim();
  const dispExpr = sign === '-' ? `-(${expr})` : expr;
  return {
    prefix: register === 'IX' ? 0xdd : 0xfd,
    dispExpr
  };
}

function isIndirectRegister(op: string, register: string): boolean {
  const normalized = op.trim().toUpperCase().replace(/\s+/g, '');
  return normalized === `(${register})`;
}

function parseMemExpr(op: string): string | undefined {
  const match = op.trim().match(/^\((.+)\)$/);
  if (!match) {
    return undefined;
  }
  const inner = (match[1] ?? '').trim();
  if (/^(BC|DE|HL|SP|C|IX|IY)([+-].+)?$/i.test(inner.replace(/\s+/g, ''))) {
    return undefined;
  }
  return inner;
}

function parseReg16(op: string): 'BC' | 'DE' | 'HL' | 'SP' | 'AF' | 'IX' | 'IY' | undefined {
  const upper = op.trim().toUpperCase();
  if (upper === 'BC' || upper === 'DE' || upper === 'HL' || upper === 'SP' || upper === 'AF') {
    return upper;
  }
  if (upper === 'IX' || upper === 'IY') {
    return upper;
  }
  return undefined;
}

function parseReg8(op: string): EncodedReg8 | undefined {
  const upper = op.trim().toUpperCase();
  const direct = REG8_CODE.get(upper);
  if (direct !== undefined) {
    return { code: direct };
  }

  if (upper === 'IXH') {
    return { code: 4, prefix: 0xdd };
  }
  if (upper === 'IXL') {
    return { code: 5, prefix: 0xdd };
  }
  if (upper === 'IYH') {
    return { code: 4, prefix: 0xfd };
  }
  if (upper === 'IYL') {
    return { code: 5, prefix: 0xfd };
  }

  if (isIndirectRegister(op, 'HL')) {
    return { code: 6 };
  }

  const indexed = parseIndexIndirect(op);
  if (indexed) {
    return {
      code: 6,
      prefix: indexed.prefix,
      dispExpr: indexed.dispExpr
    };
  }

  return undefined;
}

function parseReg8ForCb(op: string): { code: number } | { prefix: 0xdd | 0xfd; dispExpr: string } | undefined {
  const upper = op.trim().toUpperCase();
  const direct = REG8_CODE.get(upper);
  if (direct !== undefined) {
    return { code: direct };
  }
  if (isIndirectRegister(op, 'HL')) {
    return { code: 6 };
  }
  const indexed = parseIndexIndirect(op);
  if (indexed) {
    return { prefix: indexed.prefix, dispExpr: indexed.dispExpr };
  }
  return undefined;
}

function parseCondition(op: string): number | undefined {
  return COND_CODE.get(op.trim().toUpperCase());
}

function mergePrefix(a?: 0xdd | 0xfd, b?: 0xdd | 0xfd): 0xdd | 0xfd | undefined {
  if (a === undefined) {
    return b;
  }
  if (b === undefined) {
    return a;
  }
  if (a !== b) {
    throw new AssembleError('Cannot mix IX and IY in one instruction');
  }
  return a;
}

function toWord(value: number): number {
  return value & 0xffff;
}

function toByte(value: number, name: string): number {
  if (value < -128 || value > 0xff) {
    throw new AssembleError(`${name} out of range: ${value}`);
  }
  return value & 0xff;
}

function parseBitIndex(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 7) {
    throw new AssembleError(`BIT index out of range: ${value}`);
  }
  return value;
}

function parseRelative(target: number, pc: number, length: number): number {
  const next = (pc + length) & 0xffff;
  const delta = target - next;
  if (delta < -128 || delta > 127) {
    throw new AssembleError(`Relative jump out of range: ${delta}`);
  }
  return delta & 0xff;
}

function expectOperandCount(mnemonic: string, operands: string[], expected: number | number[]): void {
  if (Array.isArray(expected)) {
    if (expected.includes(operands.length)) {
      return;
    }
    throw new AssembleError(`${mnemonic} expects ${expected.join(' or ')} operand(s)`);
  }
  if (operands.length !== expected) {
    throw new AssembleError(`${mnemonic} expects ${expected} operand(s)`);
  }
}

function isPlainExpressionOperand(op: string): boolean {
  const trimmed = op.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    return false;
  }
  return true;
}

function emitPrefixed(
  opcode: number,
  opts: {
    prefix?: 0xdd | 0xfd;
    dispExpr?: string;
    extra?: number[];
    pc: number;
    forSize: boolean;
    evalExpr: (expr: string, pc: number) => number;
  }
): number[] {
  const out: number[] = [];
  if (opts.prefix !== undefined) {
    out.push(opts.prefix);
  }
  out.push(opcode & 0xff);
  if (opts.dispExpr !== undefined) {
    const disp = opts.forSize ? 0 : toByte(opts.evalExpr(opts.dispExpr, opts.pc), 'displacement');
    out.push(disp);
  }
  if (opts.extra) {
    out.push(...opts.extra.map((v) => v & 0xff));
  }
  return out;
}

function encodeInstruction(
  mnemonic: string,
  operands: string[],
  pc: number,
  forSize: boolean,
  evalExpr: (expr: string, pc: number) => number
): number[] {
  const m = mnemonic.toUpperCase();

  const evalByte = (expr: string, atPc = pc): number => {
    if (forSize) {
      return 0;
    }
    return toByte(evalExpr(expr, atPc), '8-bit immediate');
  };

  const evalWord = (expr: string, atPc = pc): number => {
    if (forSize) {
      return 0;
    }
    return toWord(evalExpr(expr, atPc));
  };

  const evalRel = (expr: string, length: number): number => {
    if (forSize) {
      return 0;
    }
    return parseRelative(evalExpr(expr, pc), pc, length);
  };

  const encodeAlu8 = (base: number, immOpcode: number, allowShortA = true): number[] => {
    if (operands.length === 0 || operands.length > 2) {
      throw new AssembleError(`${m} expects 1 or 2 operands`);
    }

    let rhs = '';
    if (operands.length === 1) {
      if (!allowShortA) {
        throw new AssembleError(`${m} requires explicit A as first operand`);
      }
      rhs = operands[0] ?? '';
    } else {
      const lhs = (operands[0] ?? '').trim().toUpperCase();
      if (lhs !== 'A') {
        throw new AssembleError(`${m} first operand must be A`);
      }
      rhs = operands[1] ?? '';
    }

    const reg = parseReg8(rhs);
    if (reg) {
      return emitPrefixed(base + reg.code, {
        prefix: reg.prefix,
        dispExpr: reg.code === 6 ? reg.dispExpr : undefined,
        pc,
        forSize,
        evalExpr
      });
    }

    if (!isPlainExpressionOperand(rhs)) {
      throw new AssembleError(`Invalid ${m} operand: ${rhs}`);
    }

    return [immOpcode, evalByte(rhs)];
  };

  const simpleNoOperand = new Map<string, number[]>([
    ['NOP', [0x00]],
    ['HALT', [0x76]],
    ['DI', [0xf3]],
    ['EI', [0xfb]],
    ['RLCA', [0x07]],
    ['RRCA', [0x0f]],
    ['RLA', [0x17]],
    ['RRA', [0x1f]],
    ['DAA', [0x27]],
    ['CPL', [0x2f]],
    ['SCF', [0x37]],
    ['CCF', [0x3f]],
    ['EXX', [0xd9]],
    ['RETI', [0xed, 0x4d]],
    ['RETN', [0xed, 0x45]],
    ['NEG', [0xed, 0x44]],
    ['RLD', [0xed, 0x6f]],
    ['RRD', [0xed, 0x67]],
    ['LDI', [0xed, 0xa0]],
    ['LDD', [0xed, 0xa8]],
    ['LDIR', [0xed, 0xb0]],
    ['LDDR', [0xed, 0xb8]],
    ['CPI', [0xed, 0xa1]],
    ['CPD', [0xed, 0xa9]],
    ['CPIR', [0xed, 0xb1]],
    ['CPDR', [0xed, 0xb9]],
    ['INI', [0xed, 0xa2]],
    ['IND', [0xed, 0xaa]],
    ['INIR', [0xed, 0xb2]],
    ['INDR', [0xed, 0xba]],
    ['OUTI', [0xed, 0xa3]],
    ['OUTD', [0xed, 0xab]],
    ['OTIR', [0xed, 0xb3]],
    ['OTDR', [0xed, 0xbb]]
  ]);

  const simple = simpleNoOperand.get(m);
  if (simple) {
    expectOperandCount(m, operands, 0);
    return [...simple];
  }

  if (m === 'EX') {
    expectOperandCount(m, operands, 2);
    const a = (operands[0] ?? '').trim().toUpperCase();
    const b = (operands[1] ?? '').trim().toUpperCase();

    if ((a === 'AF' && b === "AF'") || (a === "AF'" && b === 'AF')) {
      return [0x08];
    }

    if ((a === 'DE' && (b === 'HL' || b === 'IX' || b === 'IY')) || (b === 'DE' && (a === 'HL' || a === 'IX' || a === 'IY'))) {
      const target = a === 'DE' ? b : a;
      const prefix = target === 'IX' ? 0xdd : target === 'IY' ? 0xfd : undefined;
      return emitPrefixed(0xeb, {
        prefix,
        pc,
        forSize,
        evalExpr
      });
    }

    if (
      (isIndirectRegister(operands[0] ?? '', 'SP') && (b === 'HL' || b === 'IX' || b === 'IY')) ||
      (isIndirectRegister(operands[1] ?? '', 'SP') && (a === 'HL' || a === 'IX' || a === 'IY'))
    ) {
      const reg = isIndirectRegister(operands[0] ?? '', 'SP') ? b : a;
      const prefix = reg === 'IX' ? 0xdd : reg === 'IY' ? 0xfd : undefined;
      return emitPrefixed(0xe3, {
        prefix,
        pc,
        forSize,
        evalExpr
      });
    }

    throw new AssembleError('Unsupported EX operands');
  }

  if (m === 'IM') {
    expectOperandCount(m, operands, 1);
    const mode = forSize ? 0 : evalExpr(operands[0] ?? '0', pc);
    if (mode === 0) {
      return [0xed, 0x46];
    }
    if (mode === 1) {
      return [0xed, 0x56];
    }
    if (mode === 2) {
      return [0xed, 0x5e];
    }
    throw new AssembleError(`Invalid IM mode: ${mode}`);
  }

  if (m === 'RST') {
    expectOperandCount(m, operands, 1);
    const value = forSize ? 0 : evalExpr(operands[0] ?? '0', pc);
    const allowed = new Map<number, number>([
      [0x00, 0xc7],
      [0x08, 0xcf],
      [0x10, 0xd7],
      [0x18, 0xdf],
      [0x20, 0xe7],
      [0x28, 0xef],
      [0x30, 0xf7],
      [0x38, 0xff]
    ]);
    const opcode = allowed.get(value);
    if (opcode === undefined) {
      throw new AssembleError(`Invalid RST vector: ${value}`);
    }
    return [opcode];
  }

  if (m === 'RET') {
    if (operands.length === 0) {
      return [0xc9];
    }
    expectOperandCount(m, operands, 1);
    const cond = parseCondition(operands[0] ?? '');
    if (cond === undefined) {
      throw new AssembleError(`Invalid RET condition: ${operands[0] ?? ''}`);
    }
    return [0xc0 + cond * 8];
  }

  if (m === 'JP') {
    if (operands.length === 1) {
      const op = operands[0] ?? '';
      if (isIndirectRegister(op, 'HL')) {
        return [0xe9];
      }
      if (isIndirectRegister(op, 'IX')) {
        return [0xdd, 0xe9];
      }
      if (isIndirectRegister(op, 'IY')) {
        return [0xfd, 0xe9];
      }
      const address = evalWord(op);
      return [0xc3, address & 0xff, (address >>> 8) & 0xff];
    }

    expectOperandCount(m, operands, 2);
    const cond = parseCondition(operands[0] ?? '');
    if (cond === undefined) {
      throw new AssembleError(`Invalid JP condition: ${operands[0] ?? ''}`);
    }
    const address = evalWord(operands[1] ?? '0');
    return [0xc2 + cond * 8, address & 0xff, (address >>> 8) & 0xff];
  }

  if (m === 'JR') {
    if (operands.length === 1) {
      return [0x18, evalRel(operands[0] ?? '0', 2)];
    }
    expectOperandCount(m, operands, 2);
    const condText = (operands[0] ?? '').trim().toUpperCase();
    if (!JR_CONDITIONS.has(condText)) {
      throw new AssembleError(`JR supports NZ/Z/NC/C only: ${condText}`);
    }
    const opByCond = new Map<string, number>([
      ['NZ', 0x20],
      ['Z', 0x28],
      ['NC', 0x30],
      ['C', 0x38]
    ]);
    return [opByCond.get(condText) ?? 0x20, evalRel(operands[1] ?? '0', 2)];
  }

  if (m === 'DJNZ') {
    expectOperandCount(m, operands, 1);
    return [0x10, evalRel(operands[0] ?? '0', 2)];
  }

  if (m === 'CALL') {
    if (operands.length === 1) {
      const address = evalWord(operands[0] ?? '0');
      return [0xcd, address & 0xff, (address >>> 8) & 0xff];
    }
    expectOperandCount(m, operands, 2);
    const cond = parseCondition(operands[0] ?? '');
    if (cond === undefined) {
      throw new AssembleError(`Invalid CALL condition: ${operands[0] ?? ''}`);
    }
    const address = evalWord(operands[1] ?? '0');
    return [0xc4 + cond * 8, address & 0xff, (address >>> 8) & 0xff];
  }

  if (m === 'IN') {
    expectOperandCount(m, operands, 2);
    const lhs = (operands[0] ?? '').trim().toUpperCase();
    const rhs = operands[1] ?? '';

    if (lhs === 'A') {
      const mem = parseMemExpr(rhs);
      if (mem === undefined) {
        throw new AssembleError('IN A expects immediate port form: IN A,(n)');
      }
      return [0xdb, evalByte(mem)];
    }

    if (!isIndirectRegister(rhs, 'C')) {
      throw new AssembleError('IN r form requires (C)');
    }

    const reg = REG8_CODE.get(lhs);
    if (reg === undefined || lhs === 'A' || lhs === 'H' || lhs === 'L' || lhs === 'B' || lhs === 'C' || lhs === 'D' || lhs === 'E') {
      const code = REG8_CODE.get(lhs);
      if (code === undefined) {
        throw new AssembleError(`Invalid IN register: ${lhs}`);
      }
      return [0xed, 0x40 + code * 8];
    }

    throw new AssembleError(`Invalid IN register: ${lhs}`);
  }

  if (m === 'OUT') {
    expectOperandCount(m, operands, 2);
    const lhs = operands[0] ?? '';
    const rhs = (operands[1] ?? '').trim().toUpperCase();

    if (isIndirectRegister(lhs, 'C')) {
      const code = REG8_CODE.get(rhs);
      if (code === undefined) {
        throw new AssembleError(`Invalid OUT register: ${rhs}`);
      }
      return [0xed, 0x41 + code * 8];
    }

    const mem = parseMemExpr(lhs);
    if (mem !== undefined && rhs === 'A') {
      return [0xd3, evalByte(mem)];
    }

    throw new AssembleError('Unsupported OUT operands');
  }

  if (m === 'LD') {
    expectOperandCount(m, operands, 2);
    const dstRaw = operands[0] ?? '';
    const srcRaw = operands[1] ?? '';
    const dst = dstRaw.trim().toUpperCase();
    const src = srcRaw.trim().toUpperCase();

    if (dst === 'I' && src === 'A') {
      return [0xed, 0x47];
    }
    if (dst === 'R' && src === 'A') {
      return [0xed, 0x4f];
    }
    if (dst === 'A' && src === 'I') {
      return [0xed, 0x57];
    }
    if (dst === 'A' && src === 'R') {
      return [0xed, 0x5f];
    }

    if (dst === 'SP' && (src === 'HL' || src === 'IX' || src === 'IY')) {
      const prefix = src === 'IX' ? 0xdd : src === 'IY' ? 0xfd : undefined;
      return emitPrefixed(0xf9, {
        prefix,
        pc,
        forSize,
        evalExpr
      });
    }

    if (isIndirectRegister(dstRaw, 'BC') && src === 'A') {
      return [0x02];
    }
    if (isIndirectRegister(dstRaw, 'DE') && src === 'A') {
      return [0x12];
    }
    if (dst === 'A' && isIndirectRegister(srcRaw, 'BC')) {
      return [0x0a];
    }
    if (dst === 'A' && isIndirectRegister(srcRaw, 'DE')) {
      return [0x1a];
    }

    const memDst = parseMemExpr(dstRaw);
    const memSrc = parseMemExpr(srcRaw);

    if (memDst !== undefined && src === 'A') {
      const address = evalWord(memDst);
      return [0x32, address & 0xff, (address >>> 8) & 0xff];
    }
    if (dst === 'A' && memSrc !== undefined) {
      const address = evalWord(memSrc);
      return [0x3a, address & 0xff, (address >>> 8) & 0xff];
    }

    const dst16 = parseReg16(dstRaw);
    const src16 = parseReg16(srcRaw);

    if (dst16 && src16 === undefined && isPlainExpressionOperand(srcRaw)) {
      const immediate = evalWord(srcRaw);
      if (dst16 === 'IX' || dst16 === 'IY') {
        return [dst16 === 'IX' ? 0xdd : 0xfd, 0x21, immediate & 0xff, (immediate >>> 8) & 0xff];
      }
      const rr = new Map<string, number>([
        ['BC', 0],
        ['DE', 1],
        ['HL', 2],
        ['SP', 3]
      ]).get(dst16);
      if (rr === undefined) {
        throw new AssembleError(`Invalid LD target: ${dst16}`);
      }
      return [0x01 + rr * 0x10, immediate & 0xff, (immediate >>> 8) & 0xff];
    }

    if (memDst !== undefined && src16) {
      const address = evalWord(memDst);
      if (src16 === 'IX' || src16 === 'IY') {
        return [src16 === 'IX' ? 0xdd : 0xfd, 0x22, address & 0xff, (address >>> 8) & 0xff];
      }
      if (src16 === 'HL') {
        return [0x22, address & 0xff, (address >>> 8) & 0xff];
      }
      const rr = new Map<string, number>([
        ['BC', 0],
        ['DE', 1],
        ['HL', 2],
        ['SP', 3]
      ]).get(src16);
      if (rr === undefined) {
        throw new AssembleError(`Invalid LD source register pair: ${src16}`);
      }
      return [0xed, 0x43 + rr * 0x10, address & 0xff, (address >>> 8) & 0xff];
    }

    if (dst16 && memSrc !== undefined) {
      const address = evalWord(memSrc);
      if (dst16 === 'IX' || dst16 === 'IY') {
        return [dst16 === 'IX' ? 0xdd : 0xfd, 0x2a, address & 0xff, (address >>> 8) & 0xff];
      }
      if (dst16 === 'HL') {
        return [0x2a, address & 0xff, (address >>> 8) & 0xff];
      }
      const rr = new Map<string, number>([
        ['BC', 0],
        ['DE', 1],
        ['HL', 2],
        ['SP', 3]
      ]).get(dst16);
      if (rr === undefined) {
        throw new AssembleError(`Invalid LD target register pair: ${dst16}`);
      }
      return [0xed, 0x4b + rr * 0x10, address & 0xff, (address >>> 8) & 0xff];
    }

    const dst8 = parseReg8(dstRaw);
    const src8 = parseReg8(srcRaw);

    if (dst8 && src8) {
      const prefix = mergePrefix(dst8.prefix, src8.prefix);
      const opcode = 0x40 + dst8.code * 8 + src8.code;
      if (opcode === 0x76) {
        throw new AssembleError('LD (HL),(HL) style encoding is invalid');
      }
      const dispExpr = dst8.code === 6 ? dst8.dispExpr : src8.code === 6 ? src8.dispExpr : undefined;
      return emitPrefixed(opcode, {
        prefix,
        dispExpr,
        pc,
        forSize,
        evalExpr
      });
    }

    if (dst8 && src8 === undefined && isPlainExpressionOperand(srcRaw)) {
      const prefix = dst8.prefix;
      const opcode = 0x06 + dst8.code * 8;
      return emitPrefixed(opcode, {
        prefix,
        dispExpr: dst8.code === 6 ? dst8.dispExpr : undefined,
        extra: [evalByte(srcRaw)],
        pc,
        forSize,
        evalExpr
      });
    }

    throw new AssembleError('Unsupported LD operands');
  }

  if (m === 'PUSH' || m === 'POP') {
    expectOperandCount(m, operands, 1);
    const reg = parseReg16(operands[0] ?? '');
    if (!reg) {
      throw new AssembleError(`${m} requires register pair`);
    }

    if (reg === 'IX' || reg === 'IY') {
      const prefix = reg === 'IX' ? 0xdd : 0xfd;
      return [prefix, m === 'PUSH' ? 0xe5 : 0xe1];
    }

    const code = new Map<string, number>([
      ['BC', 0],
      ['DE', 1],
      ['HL', 2],
      ['AF', 3]
    ]).get(reg);

    if (code === undefined) {
      throw new AssembleError(`${m} invalid register pair: ${reg}`);
    }

    const base = m === 'PUSH' ? 0xc5 : 0xc1;
    return [base + code * 0x10];
  }

  if (m === 'INC' || m === 'DEC') {
    expectOperandCount(m, operands, 1);
    const op = operands[0] ?? '';
    const reg16 = parseReg16(op);

    if (reg16 && reg16 !== 'AF') {
      if (reg16 === 'IX' || reg16 === 'IY') {
        return [reg16 === 'IX' ? 0xdd : 0xfd, m === 'INC' ? 0x23 : 0x2b];
      }
      const code = new Map<string, number>([
        ['BC', 0],
        ['DE', 1],
        ['HL', 2],
        ['SP', 3]
      ]).get(reg16);
      if (code === undefined) {
        throw new AssembleError(`${m} invalid register pair`);
      }
      return [(m === 'INC' ? 0x03 : 0x0b) + code * 0x10];
    }

    const reg8 = parseReg8(op);
    if (!reg8) {
      throw new AssembleError(`${m} requires 8-bit register, memory or 16-bit register pair`);
    }

    const opcode = (m === 'INC' ? 0x04 : 0x05) + reg8.code * 8;
    return emitPrefixed(opcode, {
      prefix: reg8.prefix,
      dispExpr: reg8.code === 6 ? reg8.dispExpr : undefined,
      pc,
      forSize,
      evalExpr
    });
  }

  if (m === 'ADD') {
    if (operands.length === 2) {
      const lhs = (operands[0] ?? '').trim().toUpperCase();
      const rhs = (operands[1] ?? '').trim().toUpperCase();

      if (lhs === 'HL' || lhs === 'IX' || lhs === 'IY') {
        const validSource = lhs === 'HL' ? new Set(['BC', 'DE', 'HL', 'SP']) : new Set(['BC', 'DE', lhs, 'SP']);
        if (!validSource.has(rhs)) {
          throw new AssembleError(`Invalid ADD ${lhs} source: ${rhs}`);
        }

        const code = new Map<string, number>([
          ['BC', 0],
          ['DE', 1],
          [lhs, 2],
          ['SP', 3]
        ]).get(rhs);
        if (code === undefined) {
          throw new AssembleError(`Invalid ADD register pair: ${rhs}`);
        }

        const prefix = lhs === 'IX' ? 0xdd : lhs === 'IY' ? 0xfd : undefined;
        return emitPrefixed(0x09 + code * 0x10, {
          prefix,
          pc,
          forSize,
          evalExpr
        });
      }
    }

    return encodeAlu8(0x80, 0xc6, false);
  }

  if (m === 'ADC') {
    if (operands.length === 2 && (operands[0] ?? '').trim().toUpperCase() === 'HL') {
      const rhs = (operands[1] ?? '').trim().toUpperCase();
      const code = new Map<string, number>([
        ['BC', 0],
        ['DE', 1],
        ['HL', 2],
        ['SP', 3]
      ]).get(rhs);
      if (code === undefined) {
        throw new AssembleError(`ADC HL invalid source: ${rhs}`);
      }
      return [0xed, 0x4a + code * 0x10];
    }
    return encodeAlu8(0x88, 0xce, false);
  }

  if (m === 'SBC') {
    if (operands.length === 2 && (operands[0] ?? '').trim().toUpperCase() === 'HL') {
      const rhs = (operands[1] ?? '').trim().toUpperCase();
      const code = new Map<string, number>([
        ['BC', 0],
        ['DE', 1],
        ['HL', 2],
        ['SP', 3]
      ]).get(rhs);
      if (code === undefined) {
        throw new AssembleError(`SBC HL invalid source: ${rhs}`);
      }
      return [0xed, 0x42 + code * 0x10];
    }
    return encodeAlu8(0x98, 0xde, false);
  }

  if (m === 'SUB') {
    return encodeAlu8(0x90, 0xd6, true);
  }

  if (m === 'AND') {
    return encodeAlu8(0xa0, 0xe6, true);
  }

  if (m === 'XOR') {
    return encodeAlu8(0xa8, 0xee, true);
  }

  if (m === 'OR') {
    return encodeAlu8(0xb0, 0xf6, true);
  }

  if (m === 'CP') {
    return encodeAlu8(0xb8, 0xfe, true);
  }

  if (m === 'RLC' || m === 'RRC' || m === 'RL' || m === 'RR' || m === 'SLA' || m === 'SRA' || m === 'SLL' || m === 'SRL') {
    expectOperandCount(m, operands, 1);
    const target = parseReg8ForCb(operands[0] ?? '');
    if (!target) {
      throw new AssembleError(`Invalid ${m} operand`);
    }

    const rotBase = new Map<string, number>([
      ['RLC', 0x00],
      ['RRC', 0x08],
      ['RL', 0x10],
      ['RR', 0x18],
      ['SLA', 0x20],
      ['SRA', 0x28],
      ['SLL', 0x30],
      ['SRL', 0x38]
    ]).get(m);

    if (rotBase === undefined) {
      throw new AssembleError(`Unknown rotate op: ${m}`);
    }

    if ('code' in target) {
      return [0xcb, rotBase + target.code];
    }

    const disp = forSize ? 0 : toByte(evalExpr(target.dispExpr, pc), 'displacement');
    return [target.prefix, 0xcb, disp, rotBase + 6];
  }

  if (m === 'BIT' || m === 'RES' || m === 'SET') {
    expectOperandCount(m, operands, 2);
    const bitValue = parseBitIndex(forSize ? 0 : evalExpr(operands[0] ?? '0', pc));
    const target = parseReg8ForCb(operands[1] ?? '');
    if (!target) {
      throw new AssembleError(`Invalid ${m} target`);
    }

    const base = m === 'BIT' ? 0x40 : m === 'RES' ? 0x80 : 0xc0;

    if ('code' in target) {
      return [0xcb, base + bitValue * 8 + target.code];
    }

    const disp = forSize ? 0 : toByte(evalExpr(target.dispExpr, pc), 'displacement');
    return [target.prefix, 0xcb, disp, base + bitValue * 8 + 6];
  }

  throw new AssembleError(`Unsupported mnemonic: ${m}`);
}

function formatDump(binary: Uint8Array, origin: number): string {
  if (binary.length === 0) {
    return '';
  }

  const lines: string[] = [];
  for (let i = 0; i < binary.length; i += 8) {
    const row = binary.slice(i, i + 8);
    const first = Array.from(row.slice(0, 4))
      .map((v) => v.toString(16).toUpperCase().padStart(2, '0'))
      .join('');
    const second = Array.from(row.slice(4, 8))
      .map((v) => v.toString(16).toUpperCase().padStart(2, '0'))
      .join('');
    const addr = ((origin + i) & 0xffff).toString(16).toUpperCase().padStart(4, '0');
    lines.push(`${addr}: ${first.padEnd(8, ' ')} ${second.padEnd(8, ' ')}`.trimEnd());
  }
  return lines.join('\n');
}

function formatListing(records: ListingRecord[]): string {
  if (records.length === 0) {
    return '';
  }

  const lines: string[] = [];
  for (const record of records) {
    if (record.bytes.length === 0) {
      continue;
    }
    for (let i = 0; i < record.bytes.length; i += 8) {
      const chunk = record.bytes.slice(i, i + 8);
      const first = chunk
        .slice(0, 4)
        .map((v) => v.toString(16).toUpperCase().padStart(2, '0'))
        .join('');
      const second = chunk
        .slice(4, 8)
        .map((v) => v.toString(16).toUpperCase().padStart(2, '0'))
        .join('');
      const addr = ((record.address + i) & 0xffff).toString(16).toUpperCase().padStart(4, '0');
      const source = i === 0 ? ` | ${record.source}` : '';
      lines.push(`${addr}: ${first.padEnd(8, ' ')} ${second.padEnd(8, ' ')}${source}`.trimEnd());
    }
  }
  return lines.join('\n');
}

function formatSymbols(symbols: SymbolEntry[]): string {
  if (symbols.length === 0) {
    return '';
  }
  const sorted = [...symbols].sort((a, b) => {
    if (a.value !== b.value) {
      return a.value - b.value;
    }
    return a.name.localeCompare(b.name);
  });
  return sorted
    .map((entry) => `${entry.name.padEnd(24, ' ')} = ${entry.value.toString(16).toUpperCase().padStart(4, '0')} (${entry.kind})`)
    .join('\n');
}

function evaluateOrReport(
  expr: string,
  symbols: Map<string, number>,
  currentAddress: number,
  line: ParsedLine,
  diagnostics: AssemblerDiagnostic[],
  column = 1
): number | undefined {
  const result = evaluateExpression(expr, {
    symbols,
    currentAddress
  });

  if ('value' in result) {
    return result.value;
  }

  addDiagnostic(
    diagnostics,
    line.source.file,
    line.source.line,
    column + result.column - 1,
    `${result.error} in expression: ${expr}`
  );
  return undefined;
}

function ensureAddressInRam(address: number, line: ParsedLine, diagnostics: AssemblerDiagnostic[]): boolean {
  if (address < RAM_START || address > RAM_END) {
    addDiagnostic(
      diagnostics,
      line.source.file,
      line.source.line,
      1,
      `Address out of RAM range 0000-7FFF: ${address.toString(16).toUpperCase()}`
    );
    return false;
  }
  return true;
}

export function assemble(source: string, options: AssembleOptions = {}): AssembleResult {
  const diagnostics: AssemblerDiagnostic[] = [];
  const filename = options.filename ?? '<memory>';

  const expanded = expandSource(source, filename, options, diagnostics);
  const parsed = expanded.map((line) => parseLine(line));

  const symbols = new Map<string, SymbolDef>();
  const state: ParseState = {};

  let currentAddress = 0;
  let ended = false;

  for (const line of parsed) {
    if (ended) {
      break;
    }
    if (!line.mnemonic) {
      if (line.label) {
        const key = normalizeSymbolName(line.label);
        if (symbols.has(key)) {
          addDiagnostic(diagnostics, line.source.file, line.source.line, 1, `Duplicate label: ${line.label}`);
        } else {
          symbols.set(key, {
            name: line.label,
            key,
            kind: 'label',
            value: currentAddress,
            file: line.source.file,
            line: line.source.line,
            column: 1
          });
        }
      }
      continue;
    }

    const mnemonic = line.mnemonic.toUpperCase();

    if (line.label && mnemonic !== 'EQU') {
      const key = normalizeSymbolName(line.label);
      if (symbols.has(key)) {
        addDiagnostic(diagnostics, line.source.file, line.source.line, 1, `Duplicate label: ${line.label}`);
      } else {
        symbols.set(key, {
          name: line.label,
          key,
          kind: 'label',
          value: currentAddress,
          file: line.source.file,
          line: line.source.line,
          column: 1
        });
      }
    }

    if (mnemonic === 'END') {
      ended = true;
      continue;
    }

    if (mnemonic === 'ORG') {
      expectOperandCount(mnemonic, line.operands, 1);
      const evalValue = evaluateOrReport(line.operands[0] ?? '0', new Map(), currentAddress, line, diagnostics);
      if (evalValue === undefined) {
        continue;
      }
      currentAddress = evalValue & 0xffff;
      if (!ensureAddressInRam(currentAddress, line, diagnostics)) {
        continue;
      }
      if (state.firstOrigin === undefined) {
        state.firstOrigin = currentAddress;
      }
      continue;
    }

    if (mnemonic === 'ENTRY') {
      expectOperandCount(mnemonic, line.operands, 1);
      state.entryExpr = {
        expr: line.operands[0] ?? '0',
        file: line.source.file,
        line: line.source.line,
        column: 1
      };
      continue;
    }

    if (mnemonic === 'EQU') {
      if (!line.label) {
        addDiagnostic(diagnostics, line.source.file, line.source.line, 1, 'EQU requires a label');
        continue;
      }
      expectOperandCount(mnemonic, line.operands, 1);
      const key = normalizeSymbolName(line.label);
      if (symbols.has(key)) {
        addDiagnostic(diagnostics, line.source.file, line.source.line, 1, `Duplicate symbol: ${line.label}`);
        continue;
      }
      symbols.set(key, {
        name: line.label,
        key,
        kind: 'equ',
        expr: line.operands[0] ?? '0',
        file: line.source.file,
        line: line.source.line,
        column: 1
      });
      continue;
    }

    if (mnemonic === 'DB') {
      let size = 0;
      for (const item of line.operands) {
        if (isStringLiteral(item)) {
          try {
            size += decodeStringLiteral(item).length;
          } catch (error) {
            addDiagnostic(
              diagnostics,
              line.source.file,
              line.source.line,
              1,
              error instanceof Error ? error.message : 'Invalid DB string'
            );
          }
        } else {
          size += 1;
        }
      }
      currentAddress += size;
      continue;
    }

    if (mnemonic === 'DW') {
      currentAddress += line.operands.length * 2;
      continue;
    }

    if (mnemonic === 'DS') {
      expectOperandCount(mnemonic, line.operands, [1, 2]);
      const count = evaluateOrReport(line.operands[0] ?? '0', new Map(), currentAddress, line, diagnostics);
      if (count === undefined || count < 0) {
        addDiagnostic(diagnostics, line.source.file, line.source.line, 1, 'DS requires non-negative count');
        continue;
      }
      currentAddress += count;
      continue;
    }

    try {
      const bytes = encodeInstruction(mnemonic, line.operands, currentAddress, true, () => 0);
      currentAddress += bytes.length;
    } catch (error) {
      addDiagnostic(
        diagnostics,
        line.source.file,
        line.source.line,
        1,
        error instanceof Error ? error.message : 'Instruction encode error'
      );
    }
  }

  const symbolValues = new Map<string, number>();
  const symbolEntries: SymbolEntry[] = [];
  const equDefs: SymbolDef[] = [];

  for (const def of symbols.values()) {
    if (def.kind === 'label') {
      const value = def.value ?? 0;
      symbolValues.set(def.key, value);
      symbolEntries.push({ name: def.name, value, kind: 'label' });
    } else {
      equDefs.push(def);
    }
  }

  for (let pass = 0; pass < Math.max(2, equDefs.length + 1); pass += 1) {
    let changed = false;
    for (const def of equDefs) {
      if (!def.expr) {
        continue;
      }
      const result = evaluateExpression(def.expr, {
        symbols: symbolValues,
        currentAddress: 0
      });
      if (!('value' in result)) {
        continue;
      }
      const prev = symbolValues.get(def.key);
      if (prev !== result.value) {
        symbolValues.set(def.key, result.value);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }

  for (const def of equDefs) {
    const result = evaluateExpression(def.expr ?? '0', {
      symbols: symbolValues,
      currentAddress: 0
    });
    if (!('value' in result)) {
      addDiagnostic(
        diagnostics,
        def.file,
        def.line,
        def.column,
        `${result.error} in EQU expression: ${def.expr ?? ''}`
      );
      continue;
    }
    const value = result.value;
    symbolValues.set(def.key, value);
    symbolEntries.push({ name: def.name, value, kind: 'equ' });
  }

  currentAddress = 0;
  ended = false;

  const memory = new Map<number, number>();
  const listing: ListingRecord[] = [];

  let minWritten: number | undefined;
  let maxWritten: number | undefined;

  const writeByte = (address: number, byte: number, line: ParsedLine): void => {
    if (!ensureAddressInRam(address, line, diagnostics)) {
      return;
    }
    const normalized = address & 0xffff;
    memory.set(normalized, byte & 0xff);
    if (minWritten === undefined || normalized < minWritten) {
      minWritten = normalized;
    }
    if (maxWritten === undefined || normalized > maxWritten) {
      maxWritten = normalized;
    }
  };

  for (const line of parsed) {
    if (ended) {
      break;
    }

    if (!line.mnemonic) {
      continue;
    }

    const mnemonic = line.mnemonic.toUpperCase();

    if (mnemonic === 'END') {
      ended = true;
      continue;
    }

    if (mnemonic === 'ORG') {
      const value = evaluateOrReport(line.operands[0] ?? '0', symbolValues, currentAddress, line, diagnostics);
      if (value === undefined) {
        continue;
      }
      currentAddress = value & 0xffff;
      ensureAddressInRam(currentAddress, line, diagnostics);
      if (state.firstOrigin === undefined) {
        state.firstOrigin = currentAddress;
      }
      continue;
    }

    if (mnemonic === 'ENTRY' || mnemonic === 'EQU') {
      continue;
    }

    if (mnemonic === 'DB') {
      const emitted: number[] = [];
      for (const item of line.operands) {
        if (isStringLiteral(item)) {
          try {
            const text = decodeStringLiteral(item);
            for (const ch of text) {
              emitted.push(ch.charCodeAt(0) & 0xff);
            }
          } catch (error) {
            addDiagnostic(
              diagnostics,
              line.source.file,
              line.source.line,
              1,
              error instanceof Error ? error.message : 'Invalid DB string'
            );
          }
          continue;
        }

        const value = evaluateOrReport(item, symbolValues, currentAddress, line, diagnostics);
        if (value === undefined) {
          emitted.push(0);
          continue;
        }
        emitted.push(toByte(value, 'DB value'));
      }

      for (const byte of emitted) {
        writeByte(currentAddress, byte, line);
        currentAddress = (currentAddress + 1) & 0xffff;
      }

      listing.push({
        file: line.source.file,
        line: line.source.line,
        address: (currentAddress - emitted.length) & 0xffff,
        bytes: emitted,
        source: line.raw
      });
      continue;
    }

    if (mnemonic === 'DW') {
      const emitted: number[] = [];
      for (const item of line.operands) {
        const value = evaluateOrReport(item, symbolValues, currentAddress, line, diagnostics);
        const word = toWord(value ?? 0);
        emitted.push(word & 0xff, (word >>> 8) & 0xff);
      }
      for (const byte of emitted) {
        writeByte(currentAddress, byte, line);
        currentAddress = (currentAddress + 1) & 0xffff;
      }
      listing.push({
        file: line.source.file,
        line: line.source.line,
        address: (currentAddress - emitted.length) & 0xffff,
        bytes: emitted,
        source: line.raw
      });
      continue;
    }

    if (mnemonic === 'DS') {
      const countValue = evaluateOrReport(line.operands[0] ?? '0', symbolValues, currentAddress, line, diagnostics);
      const fillValue = line.operands.length > 1 ? evaluateOrReport(line.operands[1] ?? '0', symbolValues, currentAddress, line, diagnostics) : 0;
      const count = Math.max(0, countValue ?? 0);
      const fill = toByte(fillValue ?? 0, 'DS fill');
      const emitted: number[] = [];
      for (let i = 0; i < count; i += 1) {
        emitted.push(fill);
      }
      for (const byte of emitted) {
        writeByte(currentAddress, byte, line);
        currentAddress = (currentAddress + 1) & 0xffff;
      }
      listing.push({
        file: line.source.file,
        line: line.source.line,
        address: (currentAddress - emitted.length) & 0xffff,
        bytes: emitted,
        source: line.raw
      });
      continue;
    }

    try {
      const bytes = encodeInstruction(mnemonic, line.operands, currentAddress, false, (expr, addr) => {
        const value = evaluateOrReport(expr, symbolValues, addr, line, diagnostics);
        return value ?? 0;
      });
      const start = currentAddress;
      for (const byte of bytes) {
        writeByte(currentAddress, byte, line);
        currentAddress = (currentAddress + 1) & 0xffff;
      }
      listing.push({
        file: line.source.file,
        line: line.source.line,
        address: start,
        bytes,
        source: line.raw
      });
    } catch (error) {
      addDiagnostic(
        diagnostics,
        line.source.file,
        line.source.line,
        1,
        error instanceof Error ? error.message : 'Instruction encode error'
      );
    }
  }

  const origin = state.firstOrigin ?? minWritten ?? 0;
  const entry = (() => {
    if (state.entryExpr) {
      const result = evaluateExpression(state.entryExpr.expr, {
        symbols: symbolValues,
        currentAddress: 0
      });
      if ('value' in result) {
        return result.value & 0xffff;
      }
      addDiagnostic(
        diagnostics,
        state.entryExpr.file,
        state.entryExpr.line,
        state.entryExpr.column,
        `${result.error} in ENTRY expression: ${state.entryExpr.expr}`
      );
    }
    return origin & 0xffff;
  })();

  let binary: Uint8Array;
  if (minWritten === undefined || maxWritten === undefined || maxWritten < origin) {
    binary = new Uint8Array(0);
  } else {
    const size = maxWritten - origin + 1;
    binary = new Uint8Array(size);
    for (const [address, byte] of memory) {
      if (address < origin || address > maxWritten) {
        continue;
      }
      binary[address - origin] = byte & 0xff;
    }
  }

  const dump = formatDump(binary, origin);
  const lst = formatListing(listing);
  const sym = formatSymbols(symbolEntries);

  const ok = diagnostics.every((diag) => diag.severity !== 'error');

  return {
    ok,
    origin: origin & 0xffff,
    entry,
    binary,
    dump,
    lst,
    sym,
    listing,
    symbols: symbolEntries,
    diagnostics
  };
}
