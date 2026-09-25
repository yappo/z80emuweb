import { evaluateExpression } from './expression.js';
import type {
  AssembleAddressRange,
  AssembleOptions,
  AssembleResult,
  AssemblerDiagnostic,
  ListingRecord,
  SymbolEntry
} from './types.js';

interface SourceLine {
  file: string;
  line: number;
  text: string;
}

interface ParsedLine {
  source: SourceLine;
  raw: string;
  column: number;
  label?: string;
  mnemonic?: string;
  operands: string[];
}

interface SymbolDef {
  name: string;
  key: string;
  kind: 'label' | 'equ';
  expr?: string;
  address: number;
  line: ParsedLine;
}

interface LayoutLine {
  line: ParsedLine;
  address: number;
  size: number;
}

interface EncodedReg8 {
  code: number;
  prefix?: 0xdd | 0xfd;
  dispExpr?: string;
}

class AssembleError extends Error {
  constructor(message: string, readonly column?: number) {
    super(message);
  }
}

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

// Apostrophes in identifiers (including AF') are not string delimiters.
// Both comment removal and operand splitting use the same quote/escape rules.
function* unquotedPositions(text: string): Generator<number> {
  let quote: string | undefined;
  let quoteStart = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote !== undefined) {
      if (ch === '\\') {
        i += 1;
      } else if (ch === quote) {
        quote = undefined;
      }
    } else if (ch === '"' || (ch === "'" && !/[A-Za-z0-9_.$?']/.test(text[i - 1] ?? ''))) {
      quote = ch;
      quoteStart = i;
    } else {
      yield i;
    }
  }
  if (quote !== undefined) {
    throw new AssembleError('Unterminated string literal', quoteStart + 1);
  }
}

function stripComment(line: string): string {
  for (const i of unquotedPositions(line)) {
    if (line[i] === ';') {
      return line.slice(0, i);
    }
  }
  return line;
}

function splitOperands(raw: string): string[] {
  const out: string[] = [];
  let start = 0;
  let depth = 0;
  for (const i of unquotedPositions(raw)) {
    if (raw[i] === '(') {
      depth += 1;
    } else if (raw[i] === ')') {
      depth -= 1;
      if (depth < 0) {
        throw new AssembleError('Unmatched closing parenthesis');
      }
    } else if (raw[i] === ',' && depth === 0) {
      out.push(raw.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (depth !== 0) {
    throw new AssembleError('Unclosed parenthesis');
  }
  out.push(raw.slice(start).trim());
  return out;
}

function parseLine(line: SourceLine): ParsedLine {
  const body = stripComment(line.text).trim();
  const column = line.text.length - line.text.trimStart().length + 1;
  if (body.length === 0) {
    return { source: line, raw: '', column, operands: [] };
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
      column,
      label,
      operands: []
    };
  }

  const mnemonicMatch = rest.match(/^([^\s]+)\s*(.*)$/);
  if (!mnemonicMatch) {
    return {
      source: line,
      raw: body,
      column,
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
    column: column + body.length - rest.length,
    label,
    mnemonic,
    operands
  };
}

function parseIncludePath(line: string): string | undefined {
  if (!/^\s*INCLUDE\b/i.test(line)) return undefined;
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
    let includePath: string | undefined;
    try {
      includePath = parseIncludePath(text);
    } catch (error) {
      if (!(error instanceof AssembleError)) throw error;
      addDiagnostic(diagnostics, filename, idx + 1, error.column ?? 1, error.message);
      continue;
    }
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
  for (let i = 1; i < trimmed.length; i += 1) {
    if (trimmed[i] === '\\') {
      i += 1;
    } else if (trimmed[i] === q) {
      return i === trimmed.length - 1;
    }
  }
  return false;
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
      const isIndexHalf = (r: EncodedReg8): boolean => r.prefix !== undefined && r.code !== 6;
      const incompatibleWithHalf = (r: EncodedReg8): boolean =>
        r.code === 6 || (r.prefix === undefined && (r.code === 4 || r.code === 5));
      if ((isIndexHalf(dst8) && incompatibleWithHalf(src8)) ||
          (isIndexHalf(src8) && incompatibleWithHalf(dst8))) {
        throw new AssembleError('LD index halves cannot be combined with H, L or memory');
      }
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

function evaluateAt(expr: string, symbols: Map<string, number>, address: number, line: ParsedLine): number {
  const result = evaluateExpression(expr, { symbols, currentAddress: address });
  if ('value' in result) return result.value;
  const start = line.source.text.indexOf(expr, line.column - 1);
  throw new AssembleError(
    `${result.error} in expression: ${expr}`,
    (start < 0 ? line.column : start + 1) + result.column - 1
  );
}

function normalizeAddressRange(range?: AssembleAddressRange): AssembleAddressRange {
  const start = range?.start ?? RAM_START;
  const end = range?.end ?? RAM_END;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 0xffff || start > end) {
    throw new AssembleError('addressRange must satisfy 0 <= start <= end <= 65535 with integer bounds');
  }
  return { start, end };
}

function requireAddress(address: number, range: AssembleAddressRange): void {
  if (!Number.isSafeInteger(address) || address < range.start || address > range.end) {
    const rangeLabel = `${range.start.toString(16).toUpperCase().padStart(4, '0')}-${range.end.toString(16).toUpperCase().padStart(4, '0')}`;
    const prefix = range.start === RAM_START && range.end === RAM_END ? 'Address out of RAM range' : 'Address out of range';
    throw new AssembleError(`${prefix} ${rangeLabel}: ${address.toString(16).toUpperCase()}`);
  }
}

export function assemble(source: string, options: AssembleOptions = {}): AssembleResult {
  const diagnostics: AssemblerDiagnostic[] = [];
  const filename = options.filename ?? '<memory>';
  const report = (error: unknown, line: SourceLine, column = 1): void => {
    // Only source errors become diagnostics; implementation/integration errors stay visible.
    if (!(error instanceof AssembleError)) throw error;
    addDiagnostic(diagnostics, line.file, line.line, error.column ?? column, error.message);
  };
  let addressRange: AssembleAddressRange = { start: RAM_START, end: RAM_END };
  try {
    addressRange = normalizeAddressRange(options.addressRange);
  } catch (error) {
    report(error, { file: filename, line: 1, text: '' });
  }
  const expanded = expandSource(source, filename, options, diagnostics);
  const symbols = new Map<string, SymbolDef>();
  const symbolValues = new Map<string, number>();
  const pendingEqus = new Map<string, SymbolDef>();
  const layout: LayoutLine[] = [];
  const occupied = new Uint8Array(0x10000);
  let currentAddress = 0;
  let firstOrigin: number | undefined;
  let entryDefinition: { line: ParsedLine; address: number } | undefined;

  const resolveKnownEqus = (): void => {
    let changed: boolean;
    do {
      changed = false;
      for (const [key, def] of pendingEqus) {
        const result = evaluateExpression(def.expr!, { symbols: symbolValues, currentAddress: def.address });
        if ('value' in result) {
          symbolValues.set(key, result.value);
          pendingEqus.delete(key);
          changed = true;
        }
      }
    } while (changed);
  };

  // Determine each statement's address and size once. ORG and DS count expressions
  // must be resolvable here; forward references in fixed-size output can wait.
  for (const sourceLine of expanded) {
    let line: ParsedLine | undefined;
    try {
      line = parseLine(sourceLine);
      const { mnemonic, operands, label } = line;
      if (label) {
        const key = normalizeSymbolName(label);
        if (symbols.has(key)) throw new AssembleError(`Duplicate symbol: ${label}`);
        const kind = mnemonic === 'EQU' ? 'equ' : 'label';
        if (kind === 'equ') expectOperandCount('EQU', operands, 1);
        const def: SymbolDef = { name: label, key, kind, address: currentAddress, line, expr: operands[0] };
        symbols.set(key, def);
        if (kind === 'equ') pendingEqus.set(key, def);
        else symbolValues.set(key, currentAddress);
      }
      if (!mnemonic) continue;
      if (operands.some(operand => operand.length === 0)) {
        throw new AssembleError(`${mnemonic} has an empty operand`);
      }
      if (mnemonic === 'END') {
        expectOperandCount(mnemonic, operands, 0);
        break;
      }
      if (mnemonic === 'EQU') {
        if (!label) throw new AssembleError('EQU requires a label');
        continue;
      }
      if (mnemonic === 'ENTRY') {
        expectOperandCount(mnemonic, operands, 1);
        entryDefinition = { line, address: currentAddress };
        continue;
      }
      if (mnemonic === 'ORG') {
        expectOperandCount(mnemonic, operands, 1);
        resolveKnownEqus();
        const address = evaluateAt(operands[0]!, symbolValues, currentAddress, line);
        requireAddress(address, addressRange);
        currentAddress = address;
        firstOrigin ??= address;
        continue;
      }
      let size: number;
      if (mnemonic === 'DB' || mnemonic === 'DW') {
        if (operands.length === 0) throw new AssembleError(`${mnemonic} expects at least one operand`);
        size = mnemonic === 'DW' ? operands.length * 2 : operands.reduce(
          (sum, operand) => sum + (isStringLiteral(operand) ? decodeStringLiteral(operand).length : 1), 0
        );
      } else if (mnemonic === 'DS') {
        expectOperandCount(mnemonic, operands, [1, 2]);
        resolveKnownEqus();
        size = evaluateAt(operands[0]!, symbolValues, currentAddress, line);
        if (!Number.isSafeInteger(size) || size < 0) throw new AssembleError('DS requires a non-negative integer count');
      } else {
        size = encodeInstruction(mnemonic, operands, currentAddress, true, () => 0).length;
      }
      // Validate the entire span before allocating output or changing ownership.
      // The location counter may reach 65536, but emission never wraps to zero.
      if (size > 0) {
        requireAddress(currentAddress, addressRange);
        requireAddress(currentAddress + size - 1, addressRange);
        for (let address = currentAddress; address < currentAddress + size; address += 1) {
          if (occupied[address]) throw new AssembleError(`Overlapping output at address ${address.toString(16).toUpperCase().padStart(4, '0')}`);
        }
        occupied.fill(1, currentAddress, currentAddress + size);
      }
      layout.push({ line, address: currentAddress, size });
      currentAddress += size;
    } catch (error) {
      report(error, sourceLine, line?.column);
    }
  }

  resolveKnownEqus();
  for (const def of pendingEqus.values()) {
    try {
      evaluateAt(def.expr!, symbolValues, def.address, def.line);
    } catch (error) {
      report(error, def.line.source, def.line.column);
    }
  }
  const symbolEntries: SymbolEntry[] = [];
  for (const def of symbols.values()) {
    const value = symbolValues.get(def.key);
    if (value !== undefined) symbolEntries.push({ name: def.name, kind: def.kind, value });
  }

  const listing: ListingRecord[] = [];
  let minWritten: number | undefined;
  let maxWritten: number | undefined;
  for (const { line, address, size } of layout) {
    try {
      const { mnemonic, operands } = line;
      const evaluate = (expr: string, at = address): number => evaluateAt(expr, symbolValues, at, line);
      let bytes: number[];
      if (mnemonic === 'DB') {
        bytes = [];
        for (const item of operands) {
          if (isStringLiteral(item)) {
            const text = decodeStringLiteral(item);
            for (let i = 0; i < text.length; i += 1) bytes.push(text.charCodeAt(i) & 0xff);
          } else {
            bytes.push(toByte(evaluate(item), 'DB value'));
          }
        }
      } else if (mnemonic === 'DW') {
        bytes = [];
        for (const item of operands) {
          const word = toWord(evaluate(item));
          bytes.push(word & 0xff, (word >>> 8) & 0xff);
        }
      } else if (mnemonic === 'DS') {
        const fill = toByte(operands.length === 2 ? evaluate(operands[1]!) : 0, 'DS fill');
        bytes = new Array<number>(size).fill(fill);
      } else {
        bytes = encodeInstruction(mnemonic!, operands, address, false, evaluate);
      }
      if (bytes.length !== size) throw new Error('Internal error: encoded size differs from layout');
      listing.push({ file: line.source.file, line: line.source.line, address, bytes, source: line.raw });
      if (size > 0) {
        minWritten = Math.min(minWritten ?? address, address);
        maxWritten = Math.max(maxWritten ?? address, address + size - 1);
      }
    } catch (error) {
      report(error, line.source, line.column);
    }
  }

  const origin = Math.min(firstOrigin ?? minWritten ?? 0, minWritten ?? firstOrigin ?? 0);
  let entry = firstOrigin ?? minWritten ?? 0;
  if (entryDefinition) {
    const { line, address } = entryDefinition;
    try {
      const value = evaluateAt(line.operands[0]!, symbolValues, address, line);
      requireAddress(value, { start: 0, end: 0xffff });
      entry = value;
    } catch (error) {
      report(error, line.source, line.column);
    }
  }
  const ok = diagnostics.every(diag => diag.severity !== 'error');
  const binary = new Uint8Array(ok && maxWritten !== undefined ? maxWritten - origin + 1 : 0);
  if (ok) {
    for (const record of listing) {
      if (record.bytes.length > 0) binary.set(record.bytes, record.address - origin);
    }
  } else {
    listing.length = 0;
  }
  return {
    ok, origin, entry, binary,
    dump: formatDump(binary, origin),
    lst: formatListing(listing),
    sym: formatSymbols(symbolEntries),
    listing, symbols: symbolEntries, diagnostics
  };
}
