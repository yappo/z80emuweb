// 現在サポートする BASIC キーワード一覧。
const KEYWORDS = new Set([
  'NEW',
  'LIST',
  'LLIST',
  'RUN',
  'PRINT',
  'LPRINT',
  'LET',
  'INPUT',
  'GOTO',
  'GOSUB',
  'RETURN',
  'END',
  'STOP',
  'CONT',
  'IF',
  'THEN',
  'ELSE',
  'CLS',
  'REM',
  'FOR',
  'NEXT',
  'DIM',
  'DATA',
  'READ',
  'RESTORE',
  'PEEK',
  'POKE',
  'INP',
  'OUT',
  'BEEP',
  'WAIT',
  'LOCATE',
  'AUTO',
  'BLOAD',
  'BSAVE',
  'FILES',
  'HDCOPY',
  'PAINT',
  'CIRCLE',
  'PASS',
  'PIOPUT',
  'PIOSET',
  'SPINP',
  'SPOUT',
  'REPEAT',
  'UNTIL',
  'WHILE',
  'WEND',
  'LNINPUT',
  'TO',
  'STEP',
  'AND',
  'OR',
  'XOR',
  'MOD',
  'NOT',
  'CLEAR',
  'DELETE',
  'ERASE',
  'ON',
  'RANDOMIZE',
  'RENUM',
  'USING',
  'MON',
  'OPEN',
  'CLOSE',
  'LOAD',
  'SAVE',
  'LFILES',
  'LCOPY',
  'KILL',
  'CALL',
  'GCURSOR',
  'GPRINT',
  'LINE',
  'PSET',
  'PRESET',
  'ABS',
  'ASC',
  'ATN',
  'CHR$',
  'COS',
  'EXP',
  'HEX$',
  'INKEY$',
  'INT',
  'LEN',
  'LEFT$',
  'LN',
  'LOG',
  'MID$',
  'RND',
  'RIGHT$',
  'SGN',
  'SIN',
  'SQR',
  'STR$',
  'TAN',
  'VAL',
  'INPUT',
  'OUTPUT',
  'APPEND',
  'AS'
]);

export type TokenType =
  | 'number'
  | 'string'
  | 'identifier'
  | 'keyword'
  | 'operator'
  | 'comma'
  | 'semicolon'
  | 'colon'
  | 'hash'
  | 'lparen'
  | 'rparen'
  | 'eof';

export interface Token {
  type: TokenType;
  value: string;
}

// 変数名は大文字に正規化して扱う。
export function normalizeIdentifier(value: string): string {
  return value.trim().toUpperCase();
}

export function isIdentifier(value: string): boolean {
  return /^[A-Z][A-Z0-9]*\$?$/.test(value);
}

function parseNumberToken(text: string): number {
  if (text.startsWith('&H')) {
    const value = Number.parseInt(text.slice(2), 16);
    return Number.isNaN(value) ? 0 : value;
  }

  const asFloat = Number.parseFloat(text);
  if (!Number.isFinite(asFloat) || Number.isNaN(asFloat)) {
    return 0;
  }
  return Math.trunc(asFloat);
}

// 1 行分をトークン列へ分解する。
// 行末には必ず eof トークンを付けて parser の終端判定を単純化する。
export function tokenizeLine(input: string): Token[] {
  const tokens: Token[] = [];
  const source = input.trimEnd();
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

    if (ch === '\'') {
      // 行末コメント。
      break;
    }

    if (/[0-9]/.test(ch)) {
      let end = index + 1;
      while (end < source.length && /[0-9]/.test(source[end] ?? '')) {
        end += 1;
      }
      if (source[end] === '.') {
        end += 1;
        while (end < source.length && /[0-9]/.test(source[end] ?? '')) {
          end += 1;
        }
      }
      const raw = source.slice(index, end).toUpperCase();
      tokens.push({ type: 'number', value: String(parseNumberToken(raw)) });
      index = end;
      continue;
    }

    if (ch === '&' && (source[index + 1] === 'H' || source[index + 1] === 'h')) {
      let end = index + 2;
      while (end < source.length && /[0-9A-Fa-f]/.test(source[end] ?? '')) {
        end += 1;
      }
      const raw = source.slice(index, end).toUpperCase();
      tokens.push({ type: 'number', value: String(parseNumberToken(raw)) });
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
      while (end < source.length && /[A-Za-z0-9$]/.test(source[end] ?? '')) {
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

    if ('+-*/\\^=<>' .includes(ch)) {
      tokens.push({ type: 'operator', value: ch });
      index += 1;
      continue;
    }

    if (ch === ',') {
      tokens.push({ type: 'comma', value: ch });
      index += 1;
      continue;
    }

    if (ch === ';') {
      tokens.push({ type: 'semicolon', value: ch });
      index += 1;
      continue;
    }

    if (ch === ':') {
      tokens.push({ type: 'colon', value: ch });
      index += 1;
      continue;
    }

    if (ch === '#') {
      tokens.push({ type: 'hash', value: ch });
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
