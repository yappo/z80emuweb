import { describe, expect, it } from 'vitest';

import { parseStatement } from '../src/parser';
import { evaluateNumericExpression } from '../src/semantics';

describe('parser and semantics', () => {
  it('parses LET with precedence and parentheses', () => {
    const statement = parseStatement('LET A=(2+3)*4');
    expect(statement.kind).toBe('LET');
    if (statement.kind !== 'LET') {
      return;
    }
    const value = evaluateNumericExpression(statement.expression, new Map());
    expect(value).toBe(20);
  });

  it('parses IF comparison expressions', () => {
    const statement = parseStatement('IF A>=10 THEN 200');
    expect(statement.kind).toBe('IF');
    if (statement.kind !== 'IF') {
      return;
    }
    const vars = new Map<string, number>([['A', 12]]);
    const cond = evaluateNumericExpression(statement.condition, vars);
    expect(cond).toBe(1);
    expect(statement.targetLine).toBe(200);
  });

  it('rejects malformed IF statements', () => {
    expect(() => parseStatement('IF A THEN X')).toThrowError(/BAD IF/);
  });

  it('rejects empty PRINT payload', () => {
    expect(() => parseStatement('PRINT')).toThrowError(/SYNTAX/);
  });
});
