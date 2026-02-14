import type {
  ArrayElementReference,
  ArrayElementTarget,
  AssignmentTarget,
  BeepStatement,
  BinaryExpression,
  ClsStatement,
  DataStatement,
  DimStatement,
  EmptyStatement,
  EndStatement,
  ExpressionNode,
  ForStatement,
  GosubStatement,
  GotoStatement,
  IfStatement,
  InpCallExpression,
  InputStatement,
  LetStatement,
  ListStatement,
  LocateStatement,
  NewStatement,
  NextStatement,
  OutStatement,
  PeekCallExpression,
  PokeStatement,
  PrintStatement,
  ReadStatement,
  RemStatement,
  RestoreStatement,
  ReturnStatement,
  RunStatement,
  ScalarTarget,
  StatementNode,
  StopStatement,
  WaitStatement
} from './ast';
import { BasicRuntimeError } from './errors';
import { isIdentifier, normalizeIdentifier, tokenizeLine, type Token } from './lexer';

function toInt(text: string): number {
  return Number.parseInt(text, 10);
}

class Parser {
  private readonly tokens: Token[];

  private index = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parseStatement(): StatementNode {
    if (this.peek().type === 'eof') {
      return { kind: 'EMPTY' } satisfies EmptyStatement;
    }

    const first = this.peek();
    if (first.type === 'keyword') {
      switch (first.value) {
        case 'NEW':
          this.next();
          this.expectEof();
          return { kind: 'NEW' } satisfies NewStatement;
        case 'LIST':
          this.next();
          this.expectEof();
          return { kind: 'LIST' } satisfies ListStatement;
        case 'RUN':
          this.next();
          this.expectEof();
          return { kind: 'RUN' } satisfies RunStatement;
        case 'PRINT':
          this.next();
          return this.parsePrint();
        case 'LET':
          this.next();
          return this.parseLet();
        case 'INPUT':
          this.next();
          return this.parseInput();
        case 'GOTO':
          this.next();
          return this.parseGoto();
        case 'GOSUB':
          this.next();
          return this.parseGosub();
        case 'RETURN':
          this.next();
          this.expectEof();
          return { kind: 'RETURN' } satisfies ReturnStatement;
        case 'END':
          this.next();
          this.expectEof();
          return { kind: 'END' } satisfies EndStatement;
        case 'STOP':
          this.next();
          this.expectEof();
          return { kind: 'STOP' } satisfies StopStatement;
        case 'IF':
          this.next();
          return this.parseIf();
        case 'CLS':
          this.next();
          this.expectEof();
          return { kind: 'CLS' } satisfies ClsStatement;
        case 'REM': {
          this.next();
          const text = this.collectRemainder();
          return { kind: 'REM', text } satisfies RemStatement;
        }
        case 'FOR':
          this.next();
          return this.parseFor();
        case 'NEXT':
          this.next();
          return this.parseNext();
        case 'DIM':
          this.next();
          return this.parseDim();
        case 'DATA':
          this.next();
          return this.parseData();
        case 'READ':
          this.next();
          return this.parseRead();
        case 'RESTORE':
          this.next();
          return this.parseRestore();
        case 'POKE':
          this.next();
          return this.parsePoke();
        case 'OUT':
          this.next();
          return this.parseOut();
        case 'BEEP':
          this.next();
          return this.parseBeep();
        case 'WAIT':
          this.next();
          return this.parseWait();
        case 'LOCATE':
          this.next();
          return this.parseLocate();
        default:
          throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
      }
    }

    if (first.type === 'identifier') {
      if (!this.isLetShorthandStart()) {
        throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
      }
      return this.parseLet();
    }

    throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
  }

  private parsePrint(): PrintStatement {
    if (this.peek().type === 'eof') {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }
    const items = this.parseCommaSeparated(() => this.parseExpression());
    this.expectEof();
    return { kind: 'PRINT', items };
  }

  private parseLet(): LetStatement {
    const target = this.parseAssignmentTarget();

    const op = this.next();
    if (op.type !== 'operator' || op.value !== '=') {
      throw new BasicRuntimeError('BAD_LET', 'BAD LET');
    }

    const expression = this.parseExpression();
    this.expectEof();

    return {
      kind: 'LET',
      target,
      expression
    };
  }

  private parseInput(): InputStatement {
    const token = this.next();
    if (token.type !== 'identifier' || !isIdentifier(token.value)) {
      throw new BasicRuntimeError('BAD_VAR', 'BAD VAR');
    }

    this.expectEof();
    return {
      kind: 'INPUT',
      variable: normalizeIdentifier(token.value)
    };
  }

  private parseGoto(): GotoStatement {
    const token = this.next();
    if (token.type !== 'number') {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }
    this.expectEof();
    return { kind: 'GOTO', targetLine: toInt(token.value) };
  }

  private parseGosub(): GosubStatement {
    const token = this.next();
    if (token.type !== 'number') {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }
    this.expectEof();
    return { kind: 'GOSUB', targetLine: toInt(token.value) };
  }

  private parseIf(): IfStatement {
    const condition = this.parseExpressionUntilThen();

    const thenToken = this.next();
    if (thenToken.type !== 'keyword' || thenToken.value !== 'THEN') {
      throw new BasicRuntimeError('BAD_IF', 'BAD IF');
    }

    const target = this.next();
    if (target.type !== 'number') {
      throw new BasicRuntimeError('BAD_IF', 'BAD IF');
    }

    this.expectEof();
    return { kind: 'IF', condition, targetLine: toInt(target.value) };
  }

  private parseFor(): ForStatement {
    const variableToken = this.next();
    if (variableToken.type !== 'identifier' || !isIdentifier(variableToken.value)) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    const assign = this.next();
    if (assign.type !== 'operator' || assign.value !== '=') {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    const start = this.parseExpression();
    const toKeyword = this.next();
    if (toKeyword.type !== 'keyword' || toKeyword.value !== 'TO') {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    const end = this.parseExpression();
    let step: ExpressionNode | undefined;

    if (this.peek().type === 'keyword' && this.peek().value === 'STEP') {
      this.next();
      step = this.parseExpression();
    }

    this.expectEof();
    return {
      kind: 'FOR',
      variable: normalizeIdentifier(variableToken.value),
      start,
      end,
      step
    };
  }

  private parseNext(): NextStatement {
    if (this.peek().type === 'eof') {
      return { kind: 'NEXT' };
    }

    const variable = this.next();
    if (variable.type !== 'identifier' || !isIdentifier(variable.value)) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }
    this.expectEof();
    return { kind: 'NEXT', variable: normalizeIdentifier(variable.value) };
  }

  private parseDim(): DimStatement {
    const declarations = this.parseCommaSeparated(() => {
      const token = this.next();
      if (token.type !== 'identifier' || !isIdentifier(token.value)) {
        throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
      }
      const dimensions = this.parseRequiredArgumentList();
      return {
        name: normalizeIdentifier(token.value),
        dimensions
      };
    });
    this.expectEof();
    return { kind: 'DIM', declarations };
  }

  private parseData(): DataStatement {
    const items = this.parseCommaSeparated(() => this.parseExpression());
    this.expectEof();
    return { kind: 'DATA', items };
  }

  private parseRead(): ReadStatement {
    const targets = this.parseCommaSeparated(() => this.parseAssignmentTarget());
    this.expectEof();
    return { kind: 'READ', targets };
  }

  private parseRestore(): RestoreStatement {
    if (this.peek().type === 'eof') {
      return { kind: 'RESTORE' };
    }

    const target = this.next();
    if (target.type !== 'number') {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }
    this.expectEof();
    return { kind: 'RESTORE', line: toInt(target.value) };
  }

  private parsePoke(): PokeStatement {
    const address = this.parseExpression();
    this.expectComma();
    const value = this.parseExpression();
    this.expectEof();
    return { kind: 'POKE', address, value };
  }

  private parseOut(): OutStatement {
    const port = this.parseExpression();
    this.expectComma();
    const value = this.parseExpression();
    this.expectEof();
    return { kind: 'OUT', port, value };
  }

  private parseBeep(): BeepStatement {
    if (this.peek().type === 'eof') {
      return { kind: 'BEEP' };
    }

    const args = this.parseCommaSeparated(() => this.parseExpression());
    if (args.length > 3) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }
    this.expectEof();
    return {
      kind: 'BEEP',
      j: args[0],
      k: args[1],
      n: args[2]
    };
  }

  private parseWait(): WaitStatement {
    if (this.peek().type === 'eof') {
      return { kind: 'WAIT' };
    }

    const duration = this.parseExpression();
    this.expectEof();
    return { kind: 'WAIT', duration };
  }

  private parseLocate(): LocateStatement {
    const args = this.parseCommaSeparated(() => this.parseExpression());
    if (args.length < 1 || args.length > 3) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }
    this.expectEof();
    return {
      kind: 'LOCATE',
      x: args[0] as ExpressionNode,
      y: args[1],
      z: args[2]
    };
  }

  private parseAssignmentTarget(): AssignmentTarget {
    const varToken = this.next();
    if (varToken.type !== 'identifier' || !isIdentifier(varToken.value)) {
      throw new BasicRuntimeError('BAD_LET', 'BAD LET');
    }

    const name = normalizeIdentifier(varToken.value);
    if (this.peek().type !== 'lparen') {
      return { kind: 'scalar-target', name } satisfies ScalarTarget;
    }

    const indices = this.parseRequiredArgumentList();
    return { kind: 'array-element-target', name, indices } satisfies ArrayElementTarget;
  }

  private parseRequiredArgumentList(): ExpressionNode[] {
    this.expectLparen();
    if (this.peek().type === 'rparen') {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    const args: ExpressionNode[] = [];
    while (true) {
      args.push(this.parseExpression());
      if (this.peek().type === 'comma') {
        this.next();
        continue;
      }
      break;
    }

    this.expectRparen();
    return args;
  }

  private parseExpressionUntilThen(): ExpressionNode {
    const startIndex = this.index;
    let depth = 0;
    let cursor = this.index;

    while (cursor < this.tokens.length) {
      const token = this.tokens[cursor];
      if (!token) {
        break;
      }

      if (token.type === 'lparen') {
        depth += 1;
      } else if (token.type === 'rparen') {
        depth -= 1;
      }

      if (depth === 0 && token.type === 'keyword' && token.value === 'THEN') {
        break;
      }

      if (token.type === 'eof') {
        break;
      }
      cursor += 1;
    }

    const expressionTokens = [...this.tokens.slice(startIndex, cursor), { type: 'eof', value: '' } as Token];
    if (expressionTokens.length <= 1) {
      throw new BasicRuntimeError('BAD_IF', 'BAD IF');
    }

    const expressionParser = new Parser(expressionTokens);
    let expression: ExpressionNode;
    try {
      expression = expressionParser.parseExpression();
    } catch {
      throw new BasicRuntimeError('BAD_IF', 'BAD IF');
    }

    this.index = cursor;
    return expression;
  }

  parseExpression(): ExpressionNode {
    return this.parseComparison();
  }

  private parseComparison(): ExpressionNode {
    let node = this.parseAddSub();

    while (true) {
      const token = this.peek();
      if (token.type !== 'operator' || !['=', '<>', '<', '<=', '>', '>='].includes(token.value)) {
        break;
      }
      this.next();
      const right = this.parseAddSub();
      node = {
        kind: 'binary-expression',
        operator: token.value as BinaryExpression['operator'],
        left: node,
        right
      };
    }

    return node;
  }

  private parseAddSub(): ExpressionNode {
    let node = this.parseMulDiv();

    while (true) {
      const token = this.peek();
      if (token.type !== 'operator' || (token.value !== '+' && token.value !== '-')) {
        break;
      }
      this.next();
      const right = this.parseMulDiv();
      node = {
        kind: 'binary-expression',
        operator: token.value as BinaryExpression['operator'],
        left: node,
        right
      };
    }

    return node;
  }

  private parseMulDiv(): ExpressionNode {
    let node = this.parseUnary();

    while (true) {
      const token = this.peek();
      if (token.type !== 'operator' || (token.value !== '*' && token.value !== '/')) {
        break;
      }
      this.next();
      const right = this.parseUnary();
      node = {
        kind: 'binary-expression',
        operator: token.value as BinaryExpression['operator'],
        left: node,
        right
      };
    }

    return node;
  }

  private parseUnary(): ExpressionNode {
    const token = this.peek();
    if (token.type === 'operator' && (token.value === '+' || token.value === '-')) {
      this.next();
      return {
        kind: 'unary-expression',
        operator: token.value,
        operand: this.parseUnary()
      };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExpressionNode {
    const token = this.next();

    if (token.type === 'number') {
      return { kind: 'number-literal', value: toInt(token.value) };
    }

    if (token.type === 'string') {
      return { kind: 'string-literal', value: token.value };
    }

    if (token.type === 'identifier') {
      const name = normalizeIdentifier(token.value);
      if (this.peek().type !== 'lparen') {
        return { kind: 'variable-reference', name };
      }

      const indices = this.parseRequiredArgumentList();
      return {
        kind: 'array-element-reference',
        name,
        indices
      } satisfies ArrayElementReference;
    }

    if (token.type === 'keyword' && (token.value === 'INP' || token.value === 'PEEK')) {
      const args = this.parseRequiredArgumentList();
      if (token.value === 'INP') {
        if (args.length !== 1) {
          throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
        }
        return {
          kind: 'inp-call-expression',
          port: args[0] as ExpressionNode
        } satisfies InpCallExpression;
      }

      if (args.length !== 1 && args.length !== 2) {
        throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
      }
      return {
        kind: 'peek-call-expression',
        address: args[0] as ExpressionNode,
        bank: args[1]
      } satisfies PeekCallExpression;
    }

    if (token.type === 'lparen') {
      const expr = this.parseExpression();
      this.expectRparen();
      return expr;
    }

    throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
  }

  private parseCommaSeparated<T>(parseItem: () => T): T[] {
    const items: T[] = [parseItem()];
    while (this.peek().type === 'comma') {
      this.next();
      items.push(parseItem());
    }
    return items;
  }

  private isLetShorthandStart(): boolean {
    const second = this.tokens[this.index + 1];
    if (!second) {
      return false;
    }

    if (second.type === 'operator' && second.value === '=') {
      return true;
    }

    if (second.type !== 'lparen') {
      return false;
    }

    let cursor = this.index + 1;
    let depth = 0;
    while (cursor < this.tokens.length) {
      const token = this.tokens[cursor];
      if (!token) {
        return false;
      }
      if (token.type === 'lparen') {
        depth += 1;
      } else if (token.type === 'rparen') {
        depth -= 1;
        if (depth === 0) {
          const nextToken = this.tokens[cursor + 1];
          return nextToken?.type === 'operator' && nextToken.value === '=';
        }
      } else if (token.type === 'eof') {
        return false;
      }
      cursor += 1;
    }

    return false;
  }

  private collectRemainder(): string {
    const values: string[] = [];
    while (true) {
      const token = this.peek();
      if (token.type === 'eof') {
        break;
      }
      values.push(token.value);
      this.next();
    }
    return values.join(' ');
  }

  private expectEof(): void {
    if (this.peek().type !== 'eof') {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }
  }

  private expectComma(): void {
    const token = this.next();
    if (token.type !== 'comma') {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }
  }

  private expectLparen(): void {
    const token = this.next();
    if (token.type !== 'lparen') {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }
  }

  private expectRparen(): void {
    const token = this.next();
    if (token.type !== 'rparen') {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }
  }

  private peek(): Token {
    return this.tokens[this.index] ?? { type: 'eof', value: '' };
  }

  private next(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }
}

export function parseStatement(input: string): StatementNode {
  const parser = new Parser(tokenizeLine(input));
  return parser.parseStatement();
}
