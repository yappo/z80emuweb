import type { ExpressionNode, PrintStatement } from './ast';
import { BasicRuntimeError } from './errors';
import type { BasicMachineAdapter, ScalarValue } from './types';

export interface ExpressionEvaluationContext {
  vars: Map<string, ScalarValue>;
  machineAdapter?: BasicMachineAdapter;
  readArray?: (name: string, indices: number[]) => ScalarValue;
}

type EvalContextInput = Map<string, ScalarValue> | ExpressionEvaluationContext;

function clampInt(value: number): number {
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    return 0;
  }
  return Math.trunc(value);
}

function normalizeContext(context: EvalContextInput): ExpressionEvaluationContext {
  if (context instanceof Map) {
    return { vars: context };
  }
  return context;
}

function toNumeric(value: ScalarValue): number {
  if (typeof value === 'number') {
    return clampInt(value);
  }
  throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
}

function boolToBasic(value: boolean): number {
  return value ? -1 : 0;
}

function compareValues(left: ScalarValue, right: ScalarValue): number {
  if (typeof left === 'string' || typeof right === 'string') {
    const l = String(left);
    const r = String(right);
    if (l === r) {
      return 0;
    }
    return l < r ? -1 : 1;
  }

  const ln = clampInt(left);
  const rn = clampInt(right);
  if (ln === rn) {
    return 0;
  }
  return ln < rn ? -1 : 1;
}

function evalBuiltinCall(name: string, args: ScalarValue[]): ScalarValue {
  switch (name) {
    case 'ABS':
      return Math.abs(toNumeric(args[0] ?? 0));
    case 'INT':
      return Math.floor(toNumeric(args[0] ?? 0));
    case 'SGN': {
      const value = toNumeric(args[0] ?? 0);
      if (value > 0) {
        return 1;
      }
      if (value < 0) {
        return -1;
      }
      return 0;
    }
    case 'SQR':
      return clampInt(Math.sqrt(Math.max(0, toNumeric(args[0] ?? 0))));
    case 'SIN':
      return clampInt(Math.sin(toNumeric(args[0] ?? 0)));
    case 'COS':
      return clampInt(Math.cos(toNumeric(args[0] ?? 0)));
    case 'TAN':
      return clampInt(Math.tan(toNumeric(args[0] ?? 0)));
    case 'RND':
      return clampInt(Math.random() * (Math.max(1, toNumeric(args[0] ?? 1))));
    case 'LOG':
    case 'LN':
      return clampInt(Math.log(Math.max(1, toNumeric(args[0] ?? 1))));
    case 'EXP':
      return clampInt(Math.exp(toNumeric(args[0] ?? 0)));
    case 'LEN':
      return String(args[0] ?? '').length;
    case 'CHR$':
      return String.fromCharCode(toNumeric(args[0] ?? 0) & 0xff);
    case 'STR$':
      return String(toNumeric(args[0] ?? 0));
    case 'HEX$':
      return (toNumeric(args[0] ?? 0) >>> 0).toString(16).toUpperCase();
    case 'LEFT$': {
      const text = String(args[0] ?? '');
      const len = Math.max(0, toNumeric(args[1] ?? 0));
      return text.slice(0, len);
    }
    case 'RIGHT$': {
      const text = String(args[0] ?? '');
      const len = Math.max(0, toNumeric(args[1] ?? 0));
      return text.slice(Math.max(0, text.length - len));
    }
    case 'MID$': {
      const text = String(args[0] ?? '');
      const start = Math.max(1, toNumeric(args[1] ?? 1));
      const length = args.length >= 3 ? Math.max(0, toNumeric(args[2] ?? 0)) : text.length;
      return text.slice(start - 1, start - 1 + length);
    }
    default:
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
  }
}

// AST の式を評価して number|string を返す。
export function evaluateExpression(node: ExpressionNode, contextInput: EvalContextInput): ScalarValue {
  const context = normalizeContext(contextInput);

  switch (node.kind) {
    case 'number-literal':
      return clampInt(node.value);
    case 'string-literal':
      return node.value;
    case 'variable-reference':
      return context.vars.get(node.name) ?? (node.name.endsWith('$') ? '' : 0);
    case 'array-element-reference': {
      const indices = node.indices.map((index) => evaluateNumericExpression(index, context));
      return context.readArray?.(node.name, indices) ?? (node.name.endsWith('$') ? '' : 0);
    }
    case 'inp-call-expression': {
      const port = evaluateNumericExpression(node.port, context) & 0xff;
      const value = context.machineAdapter?.in8?.(port) ?? 0xff;
      return clampInt(value);
    }
    case 'peek-call-expression': {
      const address = evaluateNumericExpression(node.address, context) & 0xffff;
      if (node.bank) {
        evaluateNumericExpression(node.bank, context);
      }
      const value = context.machineAdapter?.peek8?.(address) ?? 0xff;
      return clampInt(value);
    }
    case 'function-call-expression': {
      const args = node.args.map((arg) => evaluateExpression(arg, context));
      return evalBuiltinCall(node.name, args);
    }
    case 'unary-expression': {
      if (node.operator === 'NOT') {
        return clampInt(~toNumeric(evaluateExpression(node.operand, context)));
      }
      const raw = toNumeric(evaluateExpression(node.operand, context));
      if (node.operator === '-') {
        return clampInt(-raw);
      }
      return clampInt(raw);
    }
    case 'binary-expression': {
      const left = evaluateExpression(node.left, context);
      const right = evaluateExpression(node.right, context);

      switch (node.operator) {
        case '+':
          if (typeof left === 'string' || typeof right === 'string') {
            return `${left}${right}`;
          }
          return clampInt(toNumeric(left) + toNumeric(right));
        case '-':
          return clampInt(toNumeric(left) - toNumeric(right));
        case '*':
          return clampInt(toNumeric(left) * toNumeric(right));
        case '/': {
          const rightNumeric = toNumeric(right);
          return rightNumeric === 0 ? 0 : clampInt(toNumeric(left) / rightNumeric);
        }
        case '\\': {
          const rightNumeric = toNumeric(right);
          if (rightNumeric === 0) {
            return 0;
          }
          return clampInt(toNumeric(left) / rightNumeric);
        }
        case '^':
          return clampInt(Math.pow(toNumeric(left), toNumeric(right)));
        case 'MOD': {
          const rightNumeric = toNumeric(right);
          if (rightNumeric === 0) {
            return 0;
          }
          return clampInt(toNumeric(left) % rightNumeric);
        }
        case '=':
          return boolToBasic(compareValues(left, right) === 0);
        case '<>':
          return boolToBasic(compareValues(left, right) !== 0);
        case '<':
          return boolToBasic(compareValues(left, right) < 0);
        case '<=':
          return boolToBasic(compareValues(left, right) <= 0);
        case '>':
          return boolToBasic(compareValues(left, right) > 0);
        case '>=':
          return boolToBasic(compareValues(left, right) >= 0);
        case 'AND':
          return clampInt(toNumeric(left) & toNumeric(right));
        case 'OR':
          return clampInt(toNumeric(left) | toNumeric(right));
        case 'XOR':
          return clampInt(toNumeric(left) ^ toNumeric(right));
        default:
          return 0;
      }
    }
    default:
      return 0;
  }
}

// 数値として解釈できない式は SYNTAX として扱う。
export function evaluateNumericExpression(node: ExpressionNode, contextInput: EvalContextInput): number {
  return toNumeric(evaluateExpression(node, contextInput));
}

const PRINT_TAB_WIDTH = 8;

function formatWithUsing(value: ScalarValue, usingFormat?: string): string {
  if (!usingFormat) {
    return typeof value === 'string' ? value : String(clampInt(value));
  }

  if (typeof value === 'string') {
    const ampCount = usingFormat.split('').filter((ch) => ch === '&').length;
    if (ampCount === 0) {
      return value;
    }
    return value.slice(0, ampCount).padEnd(ampCount, ' ');
  }

  const digitsBefore = usingFormat.split('').filter((ch) => ch === '#').length;
  const rendered = String(clampInt(value));
  if (digitsBefore <= rendered.length) {
    return rendered;
  }
  return rendered.padStart(digitsBefore, ' ');
}

function evaluatePrintValue(node: ExpressionNode, contextInput: EvalContextInput, usingFormat?: string): string {
  const value = evaluateExpression(node, contextInput);
  return formatWithUsing(value, usingFormat);
}

export function evaluatePrintItems(
  items: PrintStatement['items'],
  contextInput: EvalContextInput,
  usingFormat?: string
): { text: string; suppressNewline: boolean } {
  if (items.length === 0) {
    return { text: '', suppressNewline: false };
  }

  let text = '';
  let column = 0;
  let suppressNewline = false;

  for (const item of items) {
    const part = evaluatePrintValue(item.expression, contextInput, usingFormat);
    text += part;
    column += part.length;

    if (item.separator === 'comma') {
      let spaces = PRINT_TAB_WIDTH - (column % PRINT_TAB_WIDTH);
      if (spaces === 0) {
        spaces = PRINT_TAB_WIDTH;
      }
      text += ' '.repeat(spaces);
      column += spaces;
      suppressNewline = true;
      continue;
    }

    if (item.separator === 'semicolon') {
      suppressNewline = true;
      continue;
    }

    suppressNewline = false;
  }

  return { text, suppressNewline };
}
