import { describe, expect, it } from 'vitest';

import { parseStatement, parseStatements } from '../src/parser';
import { evaluateExpression, evaluateNumericExpression } from '../src/semantics';

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

  it('parses IF comparison expressions with true=-1', () => {
    const statement = parseStatement('IF A>=10 THEN 200');
    expect(statement.kind).toBe('IF');
    if (statement.kind !== 'IF') {
      return;
    }

    const vars = new Map<string, number>([['A', 12]]);
    const cond = evaluateNumericExpression(statement.condition, vars);
    expect(cond).toBe(-1);
    expect(statement.thenBranch).toHaveLength(1);
    expect(statement.thenBranch[0]?.kind).toBe('GOTO');
  });

  it('parses inline IF/ELSE statement branches', () => {
    const statement = parseStatement('IF A THEN PRINT 1 ELSE PRINT 2');
    expect(statement.kind).toBe('IF');
    if (statement.kind !== 'IF') {
      return;
    }

    expect(statement.thenBranch[0]?.kind).toBe('PRINT');
    expect(statement.elseBranch?.[0]?.kind).toBe('PRINT');
  });

  it('rejects malformed IF statements', () => {
    expect(() => parseStatement('IF A THEN X')).toThrowError(/BAD IF/);
  });

  it('parses line label, multi statement, and apostrophe comments', () => {
    const parsed = parseStatements('*LOOP:PRINT 1:PRINT 2\'tail');
    expect(parsed.label).toBe('*LOOP');
    expect(parsed.statements).toHaveLength(2);
    expect(parsed.statements[0]?.kind).toBe('PRINT');
    expect(parsed.statements[1]?.kind).toBe('PRINT');
  });

  it('parses DIM string arrays and machine I/O command variants', () => {
    const dimStmt = parseStatement('DIM A$(2)*8');
    expect(dimStmt.kind).toBe('DIM');
    if (dimStmt.kind !== 'DIM') {
      return;
    }
    expect(dimStmt.declarations[0]?.name).toBe('A$');
    expect(dimStmt.declarations[0]?.stringLength?.kind).toBe('number-literal');

    const pokeStmt = parseStatement('POKE 100,1,2,3');
    expect(pokeStmt.kind).toBe('POKE');
    if (pokeStmt.kind !== 'POKE') {
      return;
    }
    expect(pokeStmt.values).toHaveLength(3);

    const outStmt = parseStatement('OUT 16');
    expect(outStmt.kind).toBe('OUT');
    if (outStmt.kind !== 'OUT') {
      return;
    }
    expect(outStmt.port).toBeUndefined();
  });

  it('parses builtin numeric and string function calls', () => {
    const numeric = parseStatement('LET A=ABS(-2)+INT(3.9)+SGN(-5)+VAL("12")');
    expect(numeric.kind).toBe('LET');
    if (numeric.kind !== 'LET') {
      return;
    }
    expect(evaluateNumericExpression(numeric.expression, new Map())).toBe(16);

    const stringStmt = parseStatement('LET S$=LEFT$("ABCDE",2)+MID$("ABCDE",2,2)+RIGHT$("ABCDE",1)');
    expect(stringStmt.kind).toBe('LET');
    if (stringStmt.kind !== 'LET') {
      return;
    }
    expect(evaluateExpression(stringStmt.expression, new Map())).toBe('ABBCE');
  });

  it('parses low-priority control and machine statements', () => {
    expect(parseStatement('AUTO 100,20').kind).toBe('AUTO');
    expect(parseStatement('BLOAD "E:BIN.DAT",4096').kind).toBe('BLOAD');
    expect(parseStatement('BSAVE "E:BIN.DAT",4096,4100').kind).toBe('BSAVE');
    expect(parseStatement('PAINT (1,2),6').kind).toBe('PAINT');
    expect(parseStatement('CIRCLE (10,10),5,1,6').kind).toBe('CIRCLE');
    expect(parseStatement('REPEAT').kind).toBe('REPEAT');
    expect(parseStatement('UNTIL A=1').kind).toBe('UNTIL');
    expect(parseStatement('WHILE A<5').kind).toBe('WHILE');
    expect(parseStatement('WEND').kind).toBe('WEND');
    expect(parseStatement('LNINPUT A$').kind).toBe('LNINPUT');
  });

  it('rejects malformed function argument counts', () => {
    expect(() => parseStatement('LET A=INP(1,2)')).toThrowError(/SYNTAX/);
    expect(() => parseStatement('LET A=PEEK()')).toThrowError(/SYNTAX/);
    expect(() => parseStatement('LET A=ABS()')).toThrowError(/SYNTAX/);
  });
});
