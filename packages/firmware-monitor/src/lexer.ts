const KEYWORDS = new Set([
  'NEW',
  'LIST',
  'RUN',
  'PRINT',
  'LET',
  'INPUT',
  'GOTO',
  'GOSUB',
  'RETURN',
  'END',
  'STOP',
  'IF',
  'THEN',
  'CLS',
  'REM'
]);

export type TokenType =
  | 'number'
  | 'string'
  | 'identifier'
  | 'keyword'
  | 'operator'
  | 'comma'
  | 'lparen'
  | 'rparen'
  | 'eof';

export interface Token {
  type: TokenType;
  value: string;
}

export function normalizeIdentifier(value: string): string {
  return value.trim().toUpperCase();
}

export function isIdentifier(value: string): boolean {
  return /^[A-Z][A-Z0-9]*$/.test(value);
}

export function tokenizeLine(input: string): Token[] {
  const tokens: Token[] = [];
  const source = input.trim();
  let index = 0;

  while (index < source.length) {
    const ch = source[index];
    if (ch === undefined) {
      break;
    }

    if (ch === ' ' || ch === '\t') {
      index += 1;
      continue;
    }

    if (/[0-9]/.test(ch)) {
      let end = index + 1;
      while (end < source.length && /[0-9]/.test(source[end] ?? '')) {
        end += 1;
      }
      tokens.push({ type: 'number', value: source.slice(index, end) });
      index = end;
      continue;
    }

    if (ch === '"') {
      let end = index + 1;
      while (end < source.length && source[end] !== '"') {
        end += 1;
      }
      if (end >= source.length || source[end] !== '"') {
        throw new Error('Unclosed string literal');
      }
      tokens.push({ type: 'string', value: source.slice(index + 1, end) });
      index = end + 1;
      continue;
    }

    if (/[A-Za-z]/.test(ch)) {
      let end = index + 1;
      while (end < source.length && /[A-Za-z0-9]/.test(source[end] ?? '')) {
        end += 1;
      }
      const raw = source.slice(index, end);
      const upper = raw.toUpperCase();
      tokens.push({
        type: KEYWORDS.has(upper) ? 'keyword' : 'identifier',
        value: upper
      });
      index = end;
      continue;
    }

    const twoChar = source.slice(index, index + 2);
    if (twoChar === '<=' || twoChar === '>=' || twoChar === '<>') {
      tokens.push({ type: 'operator', value: twoChar });
      index += 2;
      continue;
    }

    if ('+-*/=<>'.includes(ch)) {
      tokens.push({ type: 'operator', value: ch });
      index += 1;
      continue;
    }

    if (ch === ',') {
      tokens.push({ type: 'comma', value: ch });
      index += 1;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'lparen', value: ch });
      index += 1;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ch });
      index += 1;
      continue;
    }

    throw new Error(`Invalid token: ${ch}`);
  }

  tokens.push({ type: 'eof', value: '' });
  return tokens;
}
