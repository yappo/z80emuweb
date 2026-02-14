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

  it('parses FOR/NEXT syntax with optional STEP', () => {
    const forStmt = parseStatement('FOR I=1 TO 10 STEP 2');
    expect(forStmt.kind).toBe('FOR');
    if (forStmt.kind !== 'FOR') {
      return;
    }
    expect(forStmt.variable).toBe('I');

    const nextStmt = parseStatement('NEXT I');
    expect(nextStmt.kind).toBe('NEXT');
  });

  it('parses array targets and INP/PEEK expressions', () => {
    const dimStmt = parseStatement('DIM A(3,2)');
    expect(dimStmt.kind).toBe('DIM');

    const letStmt = parseStatement('A(1,2)=PEEK(49152)+INP(16)');
    expect(letStmt.kind).toBe('LET');
    if (letStmt.kind !== 'LET') {
      return;
    }
    expect(letStmt.target.kind).toBe('array-element-target');
  });

  it('rejects malformed function argument counts', () => {
    expect(() => parseStatement('LET A=INP(1,2)')).toThrowError(/SYNTAX/);
    expect(() => parseStatement('LET A=PEEK()')).toThrowError(/SYNTAX/);
  });
});
