import type { ExpressionNode } from './ast';
import { BasicRuntimeError } from './errors';

function clampInt(value: number): number {
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    return 0;
  }
  return Math.trunc(value);
}

export function evaluateExpression(node: ExpressionNode, vars: Map<string, number>): number | string {
  switch (node.kind) {
    case 'number-literal':
      return clampInt(node.value);
    case 'string-literal':
      return node.value;
    case 'variable-reference':
      return clampInt(vars.get(node.name) ?? 0);
    case 'unary-expression': {
      const raw = evaluateNumericExpression(node.operand, vars);
      if (node.operator === '-') {
        return clampInt(-raw);
      }
      return clampInt(raw);
    }
    case 'binary-expression': {
      const left = evaluateNumericExpression(node.left, vars);
      const right = evaluateNumericExpression(node.right, vars);

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

export function evaluateNumericExpression(node: ExpressionNode, vars: Map<string, number>): number {
  const value = evaluateExpression(node, vars);
  if (typeof value === 'string') {
    throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
  }
  return clampInt(value);
}

export function evaluatePrintItems(items: ExpressionNode[], vars: Map<string, number>): string {
  return items
    .map((item) => {
      const value = evaluateExpression(item, vars);
      return typeof value === 'string' ? value : String(value);
    })
    .join(' ');
}
