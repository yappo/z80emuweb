import type {
  BinaryExpression,
  ClsStatement,
  EmptyStatement,
  EndStatement,
  ExpressionNode,
  GosubStatement,
  GotoStatement,
  IfStatement,
  InputStatement,
  LetStatement,
  ListStatement,
  NewStatement,
  PrintStatement,
  RemStatement,
  ReturnStatement,
  RunStatement,
  StatementNode,
  StopStatement
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
        default:
          throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
      }
    }

    if (first.type === 'identifier') {
      const second = this.tokens[this.index + 1];
      if (second?.type === 'operator' && second.value === '=') {
        return this.parseLet();
      }
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
  }

  private parsePrint(): PrintStatement {
    if (this.peek().type === 'eof') {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    const items: ExpressionNode[] = [];
    while (this.peek().type !== 'eof') {
      items.push(this.parseExpression());
      if (this.peek().type === 'comma') {
        this.next();
        continue;
      }
      break;
    }

    this.expectEof();

    if (items.length === 0) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    return {
      kind: 'PRINT',
      items
    };
  }

  private parseLet(): LetStatement {
    const varToken = this.next();
    if (varToken.type !== 'identifier' || !isIdentifier(varToken.value)) {
      throw new BasicRuntimeError('BAD_LET', 'BAD LET');
    }

    const op = this.next();
    if (op.type !== 'operator' || op.value !== '=') {
      throw new BasicRuntimeError('BAD_LET', 'BAD LET');
    }

    const expression = this.parseExpression();
    this.expectEof();

    return {
      kind: 'LET',
      variable: normalizeIdentifier(varToken.value),
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
    return {
      kind: 'GOTO',
      targetLine: toInt(token.value)
    };
  }

  private parseGosub(): GosubStatement {
    const token = this.next();
    if (token.type !== 'number') {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    this.expectEof();
    return {
      kind: 'GOSUB',
      targetLine: toInt(token.value)
    };
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
    return {
      kind: 'IF',
      condition,
      targetLine: toInt(target.value)
    };
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
      return {
        kind: 'number-literal',
        value: toInt(token.value)
      };
    }

    if (token.type === 'string') {
      return {
        kind: 'string-literal',
        value: token.value
      };
    }

    if (token.type === 'identifier') {
      return {
        kind: 'variable-reference',
        name: normalizeIdentifier(token.value)
      };
    }

    if (token.type === 'lparen') {
      const expr = this.parseExpression();
      const close = this.next();
      if (close.type !== 'rparen') {
        throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
      }
      return expr;
    }

    throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
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
    const token = this.peek();
    if (token.type !== 'eof') {
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
