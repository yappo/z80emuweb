import type { ExpressionNode } from './ast';
import { BasicRuntimeError } from './errors';
import type { BasicMachineAdapter } from './types';

export interface ExpressionEvaluationContext {
  vars: Map<string, number>;
  machineAdapter?: BasicMachineAdapter;
  readArray?: (name: string, indices: number[]) => number;
}

type EvalContextInput = Map<string, number> | ExpressionEvaluationContext;

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

// AST の式を評価して number|string を返す。
export function evaluateExpression(node: ExpressionNode, contextInput: EvalContextInput): number | string {
  const context = normalizeContext(contextInput);

  switch (node.kind) {
    case 'number-literal':
      return clampInt(node.value);
    case 'string-literal':
      return node.value;
    case 'variable-reference':
      return clampInt(context.vars.get(node.name) ?? 0);
    case 'array-element-reference': {
      const indices = node.indices.map((index) => evaluateNumericExpression(index, context));
      return clampInt(context.readArray?.(node.name, indices) ?? 0);
    }
    case 'inp-call-expression': {
      const port = evaluateNumericExpression(node.port, context) & 0xff;
      const value = context.machineAdapter?.in8?.(port) ?? 0xff;
      return clampInt(value);
    }
    case 'peek-call-expression': {
      const address = evaluateNumericExpression(node.address, context) & 0xffff;
      if (node.bank) {
        // 現在は bank を受理のみし、動作は単一アドレス空間として扱う。
        evaluateNumericExpression(node.bank, context);
      }
      const value = context.machineAdapter?.peek8?.(address) ?? 0xff;
      return clampInt(value);
    }
    case 'unary-expression': {
      const raw = evaluateNumericExpression(node.operand, context);
      if (node.operator === '-') {
        return clampInt(-raw);
      }
      return clampInt(raw);
    }
    case 'binary-expression': {
      const left = evaluateNumericExpression(node.left, context);
      const right = evaluateNumericExpression(node.right, context);

      switch (node.operator) {
        case '+':
          return clampInt(left + right);
        case '-':
          return clampInt(left - right);
        case '*':
          return clampInt(left * right);
        case '/':
          return right === 0 ? 0 : clampInt(left / right);
        case '=':
          return left === right ? 1 : 0;
        case '<>':
          return left !== right ? 1 : 0;
        case '<':
          return left < right ? 1 : 0;
        case '<=':
          return left <= right ? 1 : 0;
        case '>':
          return left > right ? 1 : 0;
        case '>=':
          return left >= right ? 1 : 0;
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
  const value = evaluateExpression(node, contextInput);
  if (typeof value === 'string') {
    throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
  }
  return clampInt(value);
}

// PRINT は各項目を空白区切りで連結する。
export function evaluatePrintItems(items: ExpressionNode[], contextInput: EvalContextInput): string {
  return items
    .map((item) => {
      const value = evaluateExpression(item, contextInput);
      return typeof value === 'string' ? value : String(value);
    })
    .join(' ');
}
