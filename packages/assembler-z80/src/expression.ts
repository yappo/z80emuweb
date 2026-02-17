export interface ExpressionContext {
  symbols: Map<string, number>;
  currentAddress: number;
}

interface Token {
  kind: 'number' | 'identifier' | 'operator' | 'lparen' | 'rparen' | 'eof';
  value: string;
  column: number;
}

class ExpressionError extends Error {
  readonly column: number;

  constructor(message: string, column: number) {
    super(message);
    this.column = column;
  }
}

function isIdentifierStart(ch: string): boolean {
  return /[A-Za-z_.$?]/.test(ch);
}

function isIdentifierPart(ch: string): boolean {
  return /[A-Za-z0-9_.$?']/.test(ch);
}

function parseEscapedChar(raw: string, column: number): number {
  if (raw.length === 1) {
    return raw.charCodeAt(0);
  }
  if (!raw.startsWith('\\')) {
    throw new ExpressionError('Invalid character literal', column);
  }
  const code = raw.slice(1);
  switch (code) {
    case 'n':
      return 0x0a;
    case 'r':
      return 0x0d;
    case 't':
      return 0x09;
    case '\\':
      return 0x5c;
    case "'":
      return 0x27;
    case '0':
      return 0x00;
    default:
      throw new ExpressionError(`Unknown escape sequence: \\${code}`, column);
  }
}

function parseNumberLiteral(token: string, column: number): number {
  const upper = token.toUpperCase();
  if (/^0X[0-9A-F]+$/.test(upper)) {
    return Number.parseInt(upper.slice(2), 16);
  }
  if (/^0B[01]+$/.test(upper)) {
    return Number.parseInt(upper.slice(2), 2);
  }
  if (/^0O[0-7]+$/.test(upper)) {
    return Number.parseInt(upper.slice(2), 8);
  }
  if (/^[0-9A-F]+H$/.test(upper) && upper.length > 1) {
    return Number.parseInt(upper.slice(0, -1), 16);
  }
  if (/^[01]+B$/.test(upper) && upper.length > 1) {
    return Number.parseInt(upper.slice(0, -1), 2);
  }
  if (/^[0-9]+$/.test(upper)) {
    return Number.parseInt(upper, 10);
  }
  throw new ExpressionError(`Invalid number literal: ${token}`, column);
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i] ?? '';
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (ch === '(') {
      tokens.push({ kind: 'lparen', value: ch, column: i + 1 });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen', value: ch, column: i + 1 });
      i += 1;
      continue;
    }

    const two = input.slice(i, i + 2);
    if (two === '<<' || two === '>>') {
      tokens.push({ kind: 'operator', value: two, column: i + 1 });
      i += 2;
      continue;
    }

    if ('+-*/%&|^~'.includes(ch)) {
      tokens.push({ kind: 'operator', value: ch, column: i + 1 });
      i += 1;
      continue;
    }

    if (ch === '$') {
      tokens.push({ kind: 'identifier', value: '$', column: i + 1 });
      i += 1;
      continue;
    }

    if (ch === "'") {
      let j = i + 1;
      let raw = '';
      while (j < input.length) {
        const next = input[j] ?? '';
        if (next === "'") {
          break;
        }
        raw += next;
        if (next === '\\') {
          j += 1;
          raw += input[j] ?? '';
        }
        j += 1;
      }
      if (j >= input.length || input[j] !== "'") {
        throw new ExpressionError('Unterminated character literal', i + 1);
      }
      const value = parseEscapedChar(raw, i + 1);
      tokens.push({ kind: 'number', value: String(value), column: i + 1 });
      i = j + 1;
      continue;
    }

    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < input.length && /[0-9A-Za-z]/.test(input[j] ?? '')) {
        j += 1;
      }
      const raw = input.slice(i, j);
      parseNumberLiteral(raw, i + 1);
      tokens.push({ kind: 'number', value: raw, column: i + 1 });
      i = j;
      continue;
    }

    if (isIdentifierStart(ch)) {
      let j = i + 1;
      while (j < input.length && isIdentifierPart(input[j] ?? '')) {
        j += 1;
      }
      const value = input.slice(i, j);
      tokens.push({ kind: 'identifier', value, column: i + 1 });
      i = j;
      continue;
    }

    throw new ExpressionError(`Unexpected character: ${ch}`, i + 1);
  }

  tokens.push({ kind: 'eof', value: '', column: input.length + 1 });
  return tokens;
}

const PRECEDENCE = new Map<string, number>([
  ['|', 1],
  ['^', 2],
  ['&', 3],
  ['<<', 4],
  ['>>', 4],
  ['+', 5],
  ['-', 5],
  ['*', 6],
  ['/', 6],
  ['%', 6]
]);

class Parser {
  private readonly tokens: Token[];

  private readonly ctx: ExpressionContext;

  private index = 0;

  constructor(tokens: Token[], ctx: ExpressionContext) {
    this.tokens = tokens;
    this.ctx = ctx;
  }

  parse(): number {
    const value = this.parseBinary(1);
    const token = this.peek();
    if (token.kind !== 'eof') {
      throw new ExpressionError(`Unexpected token: ${token.value}`, token.column);
    }
    return value;
  }

  private parseBinary(minPrec: number): number {
    let left = this.parseUnary();

    while (true) {
      const token = this.peek();
      if (token.kind !== 'operator') {
        break;
      }
      const prec = PRECEDENCE.get(token.value);
      if (prec === undefined || prec < minPrec) {
        break;
      }
      this.next();
      const right = this.parseBinary(prec + 1);
      left = this.applyBinary(token, left, right);
    }

    return left;
  }

  private parseUnary(): number {
    const token = this.peek();
    if (token.kind === 'operator' && (token.value === '+' || token.value === '-' || token.value === '~')) {
      this.next();
      const value = this.parseUnary();
      if (token.value === '+') {
        return value;
      }
      if (token.value === '-') {
        return -value;
      }
      return ~value;
    }

    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const token = this.next();
    if (token.kind === 'number') {
      return parseNumberLiteral(token.value, token.column);
    }
    if (token.kind === 'identifier') {
      if (token.value === '$') {
        return this.ctx.currentAddress;
      }
      const symbol = this.ctx.symbols.get(token.value.toUpperCase());
      if (symbol === undefined) {
        throw new ExpressionError(`Unknown symbol: ${token.value}`, token.column);
      }
      return symbol;
    }
    if (token.kind === 'lparen') {
      const value = this.parseBinary(1);
      const closer = this.next();
      if (closer.kind !== 'rparen') {
        throw new ExpressionError('Missing closing parenthesis', closer.column);
      }
      return value;
    }
    throw new ExpressionError(`Unexpected token: ${token.value}`, token.column);
  }

  private applyBinary(token: Token, left: number, right: number): number {
    switch (token.value) {
      case '+':
        return left + right;
      case '-':
        return left - right;
      case '*':
        return left * right;
      case '/':
        if (right === 0) {
          throw new ExpressionError('Division by zero', token.column);
        }
        return Math.trunc(left / right);
      case '%':
        if (right === 0) {
          throw new ExpressionError('Modulo by zero', token.column);
        }
        return left % right;
      case '<<':
        return left << right;
      case '>>':
        return left >> right;
      case '&':
        return left & right;
      case '^':
        return left ^ right;
      case '|':
        return left | right;
      default:
        throw new ExpressionError(`Unsupported operator: ${token.value}`, token.column);
    }
  }

  private peek(): Token {
    return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1] ?? { kind: 'eof', value: '', column: 1 };
  }

  private next(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }
}

export function evaluateExpression(text: string, ctx: ExpressionContext): { value: number } | { error: string; column: number } {
  try {
    const tokens = tokenize(text);
    const parser = new Parser(tokens, ctx);
    return { value: parser.parse() };
  } catch (error) {
    if (error instanceof ExpressionError) {
      return { error: error.message, column: error.column };
    }
    return { error: error instanceof Error ? error.message : 'unknown expression error', column: 1 };
  }
}
