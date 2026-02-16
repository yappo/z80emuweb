import type {
  ArrayElementReference,
  ArrayElementTarget,
  AssignmentTarget,
  BeepStatement,
  BinaryExpression,
  CallStatement,
  ClearStatement,
  CloseStatement,
  ClsStatement,
  ContStatement,
  DataStatement,
  DeleteStatement,
  DimStatement,
  ElseStatement,
  EmptyStatement,
  EndStatement,
  EraseStatement,
  ExpressionNode,
  ForStatement,
  GcursorStatement,
  GosubStatement,
  GotoStatement,
  GprintStatement,
  IfStatement,
  InpCallExpression,
  InputStatement,
  KillStatement,
  LcopyStatement,
  LineReference,
  LineStatement,
  ListStatement,
  LoadStatement,
  LocateStatement,
  LfilesStatement,
  MonStatement,
  NewStatement,
  NextStatement,
  OnStatement,
  OpenStatement,
  OutStatement,
  ParsedLine,
  PeekCallExpression,
  PokeStatement,
  PresetStatement,
  PrintStatement,
  PsetStatement,
  RandomizeStatement,
  ReadStatement,
  RemStatement,
  RenumStatement,
  RestoreStatement,
  ReturnStatement,
  RunStatement,
  SaveStatement,
  ScalarTarget,
  StatementNode,
  StopStatement,
  UsingStatement,
  WaitStatement
} from './ast';
import { BasicRuntimeError } from './errors';
import { isIdentifier, normalizeIdentifier, tokenizeLine, type Token } from './lexer';

function toInt(text: string): number {
  const parsed = Number.parseInt(text, 10);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return parsed;
}

class Parser {
  private readonly tokens: Token[];

  private index = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parseLine(): ParsedLine {
    const label = this.parseOptionalLineLabel();
    const statements = this.parseStatementSequence(false);
    if (statements.length === 0) {
      statements.push({ kind: 'EMPTY' } satisfies EmptyStatement);
    }
    return { label, statements };
  }

  parseStatement(): StatementNode {
    const parsed = this.parseLine();
    return parsed.statements[0] ?? ({ kind: 'EMPTY' } satisfies EmptyStatement);
  }

  private parseOptionalLineLabel(): string | undefined {
    if (this.peek().type !== 'operator' || this.peek().value !== '*') {
      return undefined;
    }

    const identifier = this.tokens[this.index + 1];
    if (identifier?.type !== 'identifier' && identifier?.type !== 'keyword') {
      return undefined;
    }

    if (!isIdentifier(identifier.value)) {
      return undefined;
    }

    this.next();
    this.next();
    const label = `*${normalizeIdentifier(identifier.value)}`;

    if (this.peek().type === 'colon') {
      this.next();
    }

    return label;
  }

  private parseStatementSequence(allowElseTerminator: boolean): StatementNode[] {
    const statements: StatementNode[] = [];

    while (true) {
      if (this.peek().type === 'eof') {
        break;
      }
      if (allowElseTerminator && this.peek().type === 'keyword' && this.peek().value === 'ELSE') {
        break;
      }

      if (this.peek().type === 'colon') {
        this.next();
        continue;
      }

      const statement = this.parseSingleStatement(allowElseTerminator);
      statements.push(statement);

      if (statement.kind === 'REM') {
        // REM は行末までコメントとして扱う。
        this.index = this.tokens.length - 1;
        break;
      }

      if (this.peek().type === 'colon') {
        this.next();
        continue;
      }

      if (this.peek().type === 'eof') {
        break;
      }

      if (allowElseTerminator && this.peek().type === 'keyword' && this.peek().value === 'ELSE') {
        break;
      }

      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    return statements;
  }

  private parseSingleStatement(allowElseTerminator: boolean): StatementNode {
    if (this.peek().type === 'eof' || this.peek().type === 'colon') {
      return { kind: 'EMPTY' } satisfies EmptyStatement;
    }

    const first = this.peek();
    if (first.type === 'keyword') {
      switch (first.value) {
        case 'NEW':
          this.next();
          this.expectStatementTerm(allowElseTerminator);
          return { kind: 'NEW' } satisfies NewStatement;
        case 'LIST':
          return this.parseList(false);
        case 'LLIST':
          return this.parseList(true);
        case 'RUN':
          return this.parseRun();
        case 'PRINT':
          return this.parsePrint(false, allowElseTerminator);
        case 'LPRINT':
          return this.parsePrint(true, allowElseTerminator);
        case 'LET':
          this.next();
          return this.parseLet(allowElseTerminator);
        case 'INPUT':
          this.next();
          return this.parseInput(allowElseTerminator);
        case 'GOTO':
          this.next();
          return this.parseGoto(allowElseTerminator);
        case 'GOSUB':
          this.next();
          return this.parseGosub(allowElseTerminator);
        case 'RETURN':
          this.next();
          return this.parseReturn(allowElseTerminator);
        case 'END':
          this.next();
          this.expectStatementTerm(allowElseTerminator);
          return { kind: 'END' } satisfies EndStatement;
        case 'STOP':
          this.next();
          this.expectStatementTerm(allowElseTerminator);
          return { kind: 'STOP' } satisfies StopStatement;
        case 'CONT':
          this.next();
          this.expectStatementTerm(allowElseTerminator);
          return { kind: 'CONT' } satisfies ContStatement;
        case 'IF':
          this.next();
          return this.parseIf();
        case 'CLS':
          this.next();
          this.expectStatementTerm(allowElseTerminator);
          return { kind: 'CLS' } satisfies ClsStatement;
        case 'REM':
          this.next();
          return this.parseRem();
        case 'FOR':
          this.next();
          return this.parseFor(allowElseTerminator);
        case 'NEXT':
          this.next();
          return this.parseNext(allowElseTerminator);
        case 'DIM':
          this.next();
          return this.parseDim(allowElseTerminator);
        case 'DATA':
          this.next();
          return this.parseData(allowElseTerminator);
        case 'READ':
          this.next();
          return this.parseRead(allowElseTerminator);
        case 'RESTORE':
          this.next();
          return this.parseRestore(allowElseTerminator);
        case 'POKE':
          this.next();
          return this.parsePoke(allowElseTerminator);
        case 'OUT':
          this.next();
          return this.parseOut(allowElseTerminator);
        case 'BEEP':
          this.next();
          return this.parseBeep(allowElseTerminator);
        case 'WAIT':
          this.next();
          return this.parseWait(allowElseTerminator);
        case 'LOCATE':
          this.next();
          return this.parseLocate(allowElseTerminator);
        case 'CLEAR':
          this.next();
          this.expectStatementTerm(allowElseTerminator);
          return { kind: 'CLEAR' } satisfies ClearStatement;
        case 'DELETE':
          this.next();
          return this.parseDelete(allowElseTerminator);
        case 'ERASE':
          this.next();
          return this.parseErase(allowElseTerminator);
        case 'ON':
          this.next();
          return this.parseOn(allowElseTerminator);
        case 'RANDOMIZE':
          this.next();
          this.expectStatementTerm(allowElseTerminator);
          return { kind: 'RANDOMIZE' } satisfies RandomizeStatement;
        case 'RENUM':
          this.next();
          return this.parseRenum(allowElseTerminator);
        case 'USING':
          this.next();
          return this.parseUsing(allowElseTerminator);
        case 'MON':
          this.next();
          this.expectStatementTerm(allowElseTerminator);
          return { kind: 'MON' } satisfies MonStatement;
        case 'OPEN':
          this.next();
          return this.parseOpen(allowElseTerminator);
        case 'CLOSE':
          this.next();
          return this.parseClose(allowElseTerminator);
        case 'LOAD':
          this.next();
          return this.parseLoad(allowElseTerminator);
        case 'SAVE':
          this.next();
          return this.parseSave(allowElseTerminator);
        case 'LFILES':
          this.next();
          this.expectStatementTerm(allowElseTerminator);
          return { kind: 'LFILES' } satisfies LfilesStatement;
        case 'LCOPY':
          this.next();
          return this.parseLcopy(allowElseTerminator);
        case 'KILL':
          this.next();
          return this.parseKill(allowElseTerminator);
        case 'CALL':
          this.next();
          return this.parseCall(allowElseTerminator);
        case 'GCURSOR':
          this.next();
          return this.parseGcursor(allowElseTerminator);
        case 'GPRINT':
          this.next();
          return this.parseGprint(allowElseTerminator);
        case 'LINE':
          this.next();
          return this.parseLineStatement(allowElseTerminator);
        case 'PSET':
          this.next();
          return this.parsePset(allowElseTerminator);
        case 'PRESET':
          this.next();
          return this.parsePreset(allowElseTerminator);
        case 'ELSE':
          this.next();
          this.expectStatementTerm(true);
          return { kind: 'ELSE' } satisfies ElseStatement;
        default:
          throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
      }
    }

    if (first.type === 'identifier') {
      if (!this.isLetShorthandStart()) {
        throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
      }
      return this.parseLet(allowElseTerminator);
    }

    throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
  }

  private parseList(printer: boolean): ListStatement {
    this.next();
    let target: LineReference | undefined;
    if (!this.isStatementTerm(false)) {
      target = this.parseLineReference();
    }
    this.expectStatementTerm(false);
    return { kind: 'LIST', target, printer } satisfies ListStatement;
  }

  private parseRun(): RunStatement {
    this.next();
    let target: LineReference | undefined;
    if (!this.isStatementTerm(false)) {
      target = this.parseLineReference();
    }
    this.expectStatementTerm(false);
    return { kind: 'RUN', target } satisfies RunStatement;
  }

  private parsePrint(printer: boolean, allowElseTerminator: boolean): PrintStatement {
    this.next();

    let channel: ExpressionNode | undefined;
    let usingFormat: string | undefined;

    if (this.peek().type === 'hash') {
      this.next();
      channel = this.parseExpression();
      this.expectComma();
    }

    if (this.peek().type === 'keyword' && this.peek().value === 'USING') {
      this.next();
      const format = this.next();
      if (format.type !== 'string') {
        throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
      }
      usingFormat = format.value;
      this.expectSemicolon();
    }

    const items: PrintStatement['items'] = [];

    while (!this.isStatementTerm(allowElseTerminator)) {
      const expression = this.parseExpression();
      const item: PrintStatement['items'][number] = { expression };
      items.push(item);

      if (this.peek().type === 'comma') {
        this.next();
        item.separator = 'comma';
        if (this.isStatementTerm(allowElseTerminator)) {
          break;
        }
        continue;
      }

      if (this.peek().type === 'semicolon') {
        this.next();
        item.separator = 'semicolon';
        if (this.isStatementTerm(allowElseTerminator)) {
          break;
        }
        continue;
      }

      break;
    }

    this.expectStatementTerm(allowElseTerminator);
    return {
      kind: 'PRINT',
      items,
      channel,
      printer,
      usingFormat
    } satisfies PrintStatement;
  }

  private parseLet(allowElseTerminator: boolean): StatementNode {
    const target = this.parseAssignmentTarget();

    const op = this.next();
    if (op.type !== 'operator' || op.value !== '=') {
      throw new BasicRuntimeError('BAD_LET', 'BAD LET');
    }

    const expression = this.parseExpression();
    this.expectStatementTerm(allowElseTerminator);

    return {
      kind: 'LET',
      target,
      expression
    };
  }

  private parseInput(allowElseTerminator: boolean): InputStatement {
    let channel: ExpressionNode | undefined;
    if (this.peek().type === 'hash') {
      this.next();
      channel = this.parseExpression();
      this.expectComma();
    }

    let prompt: string | undefined;
    if (this.peek().type === 'string') {
      prompt = this.next().value;
      const sep = this.peek();
      if (sep.type === 'comma' || sep.type === 'semicolon') {
        this.next();
      } else {
        throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
      }
    }

    if (this.isStatementTerm(allowElseTerminator)) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    const variables: AssignmentTarget[] = [];
    while (true) {
      variables.push(this.parseAssignmentTarget());
      if (this.peek().type !== 'comma') {
        break;
      }
      this.next();
    }

    this.expectStatementTerm(allowElseTerminator);
    return {
      kind: 'INPUT',
      variables,
      prompt,
      channel
    };
  }

  private parseGoto(allowElseTerminator: boolean): GotoStatement {
    const target = this.parseLineReference();
    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'GOTO', target };
  }

  private parseGosub(allowElseTerminator: boolean): GosubStatement {
    const target = this.parseLineReference();
    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'GOSUB', target };
  }

  private parseReturn(allowElseTerminator: boolean): ReturnStatement {
    let target: LineReference | undefined;
    if (!this.isStatementTerm(allowElseTerminator)) {
      target = this.parseLineReference();
    }
    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'RETURN', target };
  }

  private parseIf(): IfStatement {
    try {
      const condition = this.parseExpression();
      if (this.peek().type === 'keyword' && this.peek().value === 'THEN') {
        this.next();
      }

      if (this.peek().type === 'eof' || this.peek().type === 'colon') {
        throw new BasicRuntimeError('BAD_IF', 'BAD IF');
      }

      const thenBranch = this.parseIfBranch();
      let elseBranch: StatementNode[] | undefined;

      if (this.peek().type === 'keyword' && this.peek().value === 'ELSE') {
        this.next();
        elseBranch = this.parseIfBranch();
      }

      this.expectStatementTerm(false);
      return {
        kind: 'IF',
        condition,
        thenBranch,
        elseBranch
      };
    } catch (error) {
      if (error instanceof BasicRuntimeError && error.code === 'BAD_IF') {
        throw error;
      }
      throw new BasicRuntimeError('BAD_IF', 'BAD IF');
    }
  }

  private parseIfBranch(): StatementNode[] {
    const statements: StatementNode[] = [];

    while (true) {
      if (this.peek().type === 'eof') {
        break;
      }
      if (this.peek().type === 'keyword' && this.peek().value === 'ELSE') {
        break;
      }
      if (this.peek().type === 'colon') {
        this.next();
        continue;
      }

      if (this.isLineReferenceStart()) {
        const target = this.parseLineReference();
        statements.push({ kind: 'GOTO', target } satisfies GotoStatement);
      } else {
        statements.push(this.parseSingleStatement(true));
      }

      if (this.peek().type === 'colon') {
        this.next();
        continue;
      }
      if (this.peek().type === 'eof') {
        break;
      }
      if (this.peek().type === 'keyword' && this.peek().value === 'ELSE') {
        break;
      }
    }

    if (statements.length === 0) {
      throw new BasicRuntimeError('BAD_IF', 'BAD IF');
    }

    return statements;
  }

  private parseRem(): RemStatement {
    const values: string[] = [];
    while (this.peek().type !== 'eof') {
      values.push(this.next().value);
    }
    return { kind: 'REM', text: values.join(' ') };
  }

  private parseFor(allowElseTerminator: boolean): ForStatement {
    const variableToken = this.next();
    if ((variableToken.type !== 'identifier' && variableToken.type !== 'keyword') || !isIdentifier(variableToken.value)) {
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

    this.expectStatementTerm(allowElseTerminator);
    return {
      kind: 'FOR',
      variable: normalizeIdentifier(variableToken.value),
      start,
      end,
      step
    };
  }

  private parseNext(allowElseTerminator: boolean): NextStatement {
    if (this.isStatementTerm(allowElseTerminator)) {
      return { kind: 'NEXT' };
    }

    const variable = this.next();
    if ((variable.type !== 'identifier' && variable.type !== 'keyword') || !isIdentifier(variable.value)) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }
    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'NEXT', variable: normalizeIdentifier(variable.value) };
  }

  private parseDim(allowElseTerminator: boolean): DimStatement {
    const declarations = this.parseCommaSeparated(() => {
      const token = this.next();
      if ((token.type !== 'identifier' && token.type !== 'keyword') || !isIdentifier(token.value)) {
        throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
      }
      const dimensions = this.parseRequiredArgumentList();
      let stringLength: ExpressionNode | undefined;
      if (this.peek().type === 'operator' && this.peek().value === '*') {
        this.next();
        stringLength = this.parseExpression();
      }
      return {
        name: normalizeIdentifier(token.value),
        dimensions,
        stringLength
      };
    });
    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'DIM', declarations };
  }

  private parseData(allowElseTerminator: boolean): DataStatement {
    const items: ExpressionNode[] = [];
    while (!this.isStatementTerm(allowElseTerminator)) {
      items.push(this.parseExpression());
      if (this.peek().type !== 'comma') {
        break;
      }
      this.next();
    }

    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'DATA', items };
  }

  private parseRead(allowElseTerminator: boolean): ReadStatement {
    const targets = this.parseCommaSeparated(() => this.parseAssignmentTarget());
    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'READ', targets };
  }

  private parseRestore(allowElseTerminator: boolean): RestoreStatement {
    let target: LineReference | undefined;
    if (!this.isStatementTerm(allowElseTerminator)) {
      target = this.parseLineReference();
    }
    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'RESTORE', target };
  }

  private parsePoke(allowElseTerminator: boolean): PokeStatement {
    const address = this.parseExpression();
    this.expectComma();
    const values = this.parseCommaSeparated(() => this.parseExpression());
    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'POKE', address, values };
  }

  private parseOut(allowElseTerminator: boolean): OutStatement {
    const first = this.parseExpression();
    let port: ExpressionNode | undefined;
    let value = first;

    if (this.peek().type === 'comma') {
      this.next();
      port = first;
      value = this.parseExpression();
    }

    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'OUT', port, value };
  }

  private parseBeep(allowElseTerminator: boolean): BeepStatement {
    if (this.isStatementTerm(allowElseTerminator)) {
      return { kind: 'BEEP' };
    }

    const args = this.parseCommaSeparated(() => this.parseExpression());
    if (args.length > 3) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    this.expectStatementTerm(allowElseTerminator);
    return {
      kind: 'BEEP',
      j: args[0],
      k: args[1],
      n: args[2]
    };
  }

  private parseWait(allowElseTerminator: boolean): WaitStatement {
    if (this.isStatementTerm(allowElseTerminator)) {
      return { kind: 'WAIT' };
    }

    const duration = this.parseExpression();
    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'WAIT', duration };
  }

  private parseLocate(allowElseTerminator: boolean): LocateStatement {
    const args: Array<ExpressionNode | undefined> = [];

    if (!this.isStatementTerm(allowElseTerminator)) {
      if (this.peek().type === 'comma') {
        args.push(undefined);
      } else {
        args.push(this.parseExpression());
      }

      while (this.peek().type === 'comma') {
        this.next();
        if (this.peek().type === 'comma' || this.isStatementTerm(allowElseTerminator)) {
          args.push(undefined);
        } else {
          args.push(this.parseExpression());
        }
      }
    }

    if (args.length === 0 || args.length > 3) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    this.expectStatementTerm(allowElseTerminator);
    return {
      kind: 'LOCATE',
      x: args[0],
      y: args[1],
      z: args[2]
    };
  }

  private parseDelete(allowElseTerminator: boolean): DeleteStatement {
    if (this.isStatementTerm(allowElseTerminator)) {
      return { kind: 'DELETE' };
    }

    const start = this.parseLineNumber();
    let end: number | undefined;
    if (this.peek().type === 'operator' && this.peek().value === '-') {
      this.next();
      if (this.peek().type === 'number') {
        end = this.parseLineNumber();
      }
    }

    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'DELETE', start, end };
  }

  private parseErase(allowElseTerminator: boolean): EraseStatement {
    const names = this.parseCommaSeparated(() => {
      const token = this.next();
      if ((token.type !== 'identifier' && token.type !== 'keyword') || !isIdentifier(token.value)) {
        throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
      }
      return normalizeIdentifier(token.value);
    });
    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'ERASE', names };
  }

  private parseOn(allowElseTerminator: boolean): OnStatement {
    const selector = this.parseExpression();

    let mode: 'GOTO' | 'GOSUB';
    const keyword = this.next();
    if (keyword.type !== 'keyword' || (keyword.value !== 'GOTO' && keyword.value !== 'GOSUB')) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }
    mode = keyword.value;

    const targets = this.parseCommaSeparated(() => this.parseLineReference());
    this.expectStatementTerm(allowElseTerminator);

    return {
      kind: 'ON',
      selector,
      mode,
      targets
    };
  }

  private parseRenum(allowElseTerminator: boolean): RenumStatement {
    const args: ExpressionNode[] = [];
    while (!this.isStatementTerm(allowElseTerminator)) {
      args.push(this.parseExpression());
      if (this.peek().type !== 'comma') {
        break;
      }
      this.next();
    }

    if (args.length > 3) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    this.expectStatementTerm(allowElseTerminator);
    return {
      kind: 'RENUM',
      start: args[0],
      from: args[1],
      step: args[2]
    };
  }

  private parseUsing(allowElseTerminator: boolean): UsingStatement {
    const format = this.next();
    if (format.type !== 'string') {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }
    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'USING', format: format.value };
  }

  private parseOpen(allowElseTerminator: boolean): OpenStatement {
    const file = this.next();
    if (file.type !== 'string') {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    let mode: OpenStatement['mode'];
    let handle: ExpressionNode | undefined;

    if (this.peek().type === 'keyword' && this.peek().value === 'FOR') {
      this.next();
      const modeToken = this.next();
      if (modeToken.type !== 'keyword' || !['INPUT', 'OUTPUT', 'APPEND'].includes(modeToken.value)) {
        throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
      }
      mode = modeToken.value as OpenStatement['mode'];

      const asToken = this.next();
      if (asToken.type !== 'keyword' || asToken.value !== 'AS') {
        throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
      }

      if (this.peek().type !== 'hash') {
        throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
      }
      this.next();
      handle = this.parseExpression();
    }

    this.expectStatementTerm(allowElseTerminator);
    return {
      kind: 'OPEN',
      path: file.value,
      mode,
      handle
    };
  }

  private parseClose(allowElseTerminator: boolean): CloseStatement {
    const handles: ExpressionNode[] = [];

    while (!this.isStatementTerm(allowElseTerminator)) {
      if (this.peek().type !== 'hash') {
        throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
      }
      this.next();
      handles.push(this.parseExpression());
      if (this.peek().type !== 'comma') {
        break;
      }
      this.next();
    }

    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'CLOSE', handles };
  }

  private parseLoad(allowElseTerminator: boolean): LoadStatement {
    const file = this.next();
    if (file.type !== 'string') {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }
    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'LOAD', path: file.value };
  }

  private parseSave(allowElseTerminator: boolean): SaveStatement {
    const file = this.next();
    if (file.type !== 'string') {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }
    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'SAVE', path: file.value };
  }

  private parseLcopy(allowElseTerminator: boolean): LcopyStatement {
    const start = this.parseExpression();
    this.expectComma();
    const end = this.parseExpression();
    this.expectComma();
    const to = this.parseExpression();
    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'LCOPY', start, end, to };
  }

  private parseKill(allowElseTerminator: boolean): KillStatement {
    const file = this.next();
    if (file.type !== 'string') {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }
    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'KILL', path: file.value };
  }

  private parseCall(allowElseTerminator: boolean): CallStatement {
    const address = this.parseExpression();
    const args: ExpressionNode[] = [];
    while (this.peek().type === 'comma') {
      this.next();
      args.push(this.parseExpression());
    }
    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'CALL', address, args };
  }

  private parseGcursor(allowElseTerminator: boolean): GcursorStatement {
    let x: ExpressionNode;
    let y: ExpressionNode;

    if (this.peek().type === 'lparen') {
      this.next();
      x = this.parseExpression();
      this.expectComma();
      y = this.parseExpression();
      this.expectRparen();
    } else {
      x = this.parseExpression();
      this.expectComma();
      y = this.parseExpression();
    }

    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'GCURSOR', x, y };
  }

  private parseGprint(allowElseTerminator: boolean): GprintStatement {
    const items: GprintStatement['items'] = [];

    while (!this.isStatementTerm(allowElseTerminator)) {
      const expression = this.parseExpression();
      const item: GprintStatement['items'][number] = { expression };
      items.push(item);

      if (this.peek().type === 'comma') {
        this.next();
        item.separator = 'comma';
        if (this.isStatementTerm(allowElseTerminator)) {
          break;
        }
        continue;
      }

      if (this.peek().type === 'semicolon') {
        this.next();
        item.separator = 'semicolon';
        if (this.isStatementTerm(allowElseTerminator)) {
          break;
        }
        continue;
      }

      break;
    }

    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'GPRINT', items };
  }

  private parseLineStatement(allowElseTerminator: boolean): LineStatement {
    this.expectLparen();
    const x1 = this.parseExpression();
    this.expectComma();
    const y1 = this.parseExpression();
    this.expectRparen();

    const dash = this.next();
    if (dash.type !== 'operator' || dash.value !== '-') {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    this.expectLparen();
    const x2 = this.parseExpression();
    this.expectComma();
    const y2 = this.parseExpression();
    this.expectRparen();

    let mode: ExpressionNode | undefined;
    let pattern: ExpressionNode | undefined;

    if (this.peek().type === 'comma') {
      this.next();
      mode = this.parseExpression();
      if (this.peek().type === 'comma') {
        this.next();
        pattern = this.parseExpression();
      }
    }

    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'LINE', x1, y1, x2, y2, mode, pattern };
  }

  private parsePset(allowElseTerminator: boolean): PsetStatement {
    this.expectLparen();
    const x = this.parseExpression();
    this.expectComma();
    const y = this.parseExpression();
    this.expectRparen();

    let mode: ExpressionNode | undefined;
    if (this.peek().type === 'comma') {
      this.next();
      mode = this.parseExpression();
    }

    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'PSET', x, y, mode };
  }

  private parsePreset(allowElseTerminator: boolean): PresetStatement {
    this.expectLparen();
    const x = this.parseExpression();
    this.expectComma();
    const y = this.parseExpression();
    this.expectRparen();
    this.expectStatementTerm(allowElseTerminator);
    return { kind: 'PRESET', x, y };
  }

  private parseLineReference(): LineReference {
    const first = this.peek();
    if (first.type === 'number') {
      this.next();
      return { kind: 'line-reference-number', line: toInt(first.value) };
    }

    if (first.type === 'operator' && first.value === '*') {
      this.next();
      const identifier = this.next();
      if ((identifier.type !== 'identifier' && identifier.type !== 'keyword') || !isIdentifier(identifier.value)) {
        throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
      }
      return {
        kind: 'line-reference-label',
        label: `*${normalizeIdentifier(identifier.value)}`
      };
    }

    if (first.type === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(first.value)) {
      this.next();
      return {
        kind: 'line-reference-label',
        label: `*${normalizeIdentifier(first.value)}`
      };
    }

    throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
  }

  private parseAssignmentTarget(): AssignmentTarget {
    const varToken = this.next();
    if ((varToken.type !== 'identifier' && varToken.type !== 'keyword') || !isIdentifier(varToken.value)) {
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

  parseExpression(): ExpressionNode {
    return this.parseOr();
  }

  private parseOr(): ExpressionNode {
    let node = this.parseXor();
    while (this.peek().type === 'keyword' && this.peek().value === 'OR') {
      this.next();
      const right = this.parseXor();
      node = {
        kind: 'binary-expression',
        operator: 'OR',
        left: node,
        right
      } satisfies BinaryExpression;
    }
    return node;
  }

  private parseXor(): ExpressionNode {
    let node = this.parseAnd();
    while (this.peek().type === 'keyword' && this.peek().value === 'XOR') {
      this.next();
      const right = this.parseAnd();
      node = {
        kind: 'binary-expression',
        operator: 'XOR',
        left: node,
        right
      } satisfies BinaryExpression;
    }
    return node;
  }

  private parseAnd(): ExpressionNode {
    let node = this.parseComparison();
    while (this.peek().type === 'keyword' && this.peek().value === 'AND') {
      this.next();
      const right = this.parseComparison();
      node = {
        kind: 'binary-expression',
        operator: 'AND',
        left: node,
        right
      } satisfies BinaryExpression;
    }
    return node;
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
    let node = this.parsePower();

    while (true) {
      const token = this.peek();
      if (token.type === 'operator' && (token.value === '*' || token.value === '/' || token.value === '\\')) {
        this.next();
        const right = this.parsePower();
        node = {
          kind: 'binary-expression',
          operator: token.value as BinaryExpression['operator'],
          left: node,
          right
        };
        continue;
      }

      if (token.type === 'keyword' && token.value === 'MOD') {
        this.next();
        const right = this.parsePower();
        node = {
          kind: 'binary-expression',
          operator: 'MOD',
          left: node,
          right
        };
        continue;
      }

      break;
    }

    return node;
  }

  private parsePower(): ExpressionNode {
    const left = this.parseUnary();
    if (this.peek().type === 'operator' && this.peek().value === '^') {
      this.next();
      const right = this.parsePower();
      return {
        kind: 'binary-expression',
        operator: '^',
        left,
        right
      };
    }
    return left;
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

    if (token.type === 'keyword' && token.value === 'NOT') {
      this.next();
      return {
        kind: 'unary-expression',
        operator: 'NOT',
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

    if (token.type === 'identifier' || token.type === 'keyword') {
      const name = normalizeIdentifier(token.value);

      if ((token.type === 'keyword' || token.type === 'identifier') && (name === 'INP' || name === 'PEEK')) {
        return this.parsePeekOrInp(name);
      }

      if (this.peek().type === 'lparen') {
        const args = this.parseRequiredArgumentList();
        if (token.type === 'identifier') {
          return {
            kind: 'array-element-reference',
            name,
            indices: args
          } satisfies ArrayElementReference;
        }

        return {
          kind: 'function-call-expression',
          name,
          args
        };
      }

      return { kind: 'variable-reference', name };
    }

    if (token.type === 'lparen') {
      const expr = this.parseExpression();
      this.expectRparen();
      return expr;
    }

    throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
  }

  private parsePeekOrInp(name: 'INP' | 'PEEK'): InpCallExpression | PeekCallExpression {
    let args: ExpressionNode[];

    if (this.peek().type === 'lparen') {
      args = this.parseRequiredArgumentList();
    } else {
      args = [this.parseUnary()];
    }

    if (name === 'INP') {
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

  private parseCommaSeparated<T>(parseItem: () => T): T[] {
    const items: T[] = [parseItem()];
    while (this.peek().type === 'comma') {
      this.next();
      items.push(parseItem());
    }
    return items;
  }

  private parseLineNumber(): number {
    const token = this.next();
    if (token.type !== 'number') {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }
    return toInt(token.value);
  }

  private isLineReferenceStart(): boolean {
    const token = this.peek();
    if (token.type === 'number') {
      return true;
    }
    if (token.type === 'operator' && token.value === '*') {
      const nextToken = this.tokens[this.index + 1];
      return (nextToken?.type === 'identifier' || nextToken?.type === 'keyword') && isIdentifier(nextToken.value);
    }
    if (token.type === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(token.value)) {
      return true;
    }
    return false;
  }

  private isStatementTerm(allowElseTerminator: boolean): boolean {
    const token = this.peek();
    if (token.type === 'eof' || token.type === 'colon') {
      return true;
    }
    if (allowElseTerminator && token.type === 'keyword' && token.value === 'ELSE') {
      return true;
    }
    return false;
  }

  private expectStatementTerm(allowElseTerminator: boolean): void {
    if (!this.isStatementTerm(allowElseTerminator)) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }
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

  private expectComma(): void {
    const token = this.next();
    if (token.type !== 'comma') {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }
  }

  private expectSemicolon(): void {
    const token = this.next();
    if (token.type !== 'semicolon') {
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

export function parseStatements(input: string): ParsedLine {
  const parser = new Parser(tokenizeLine(input));
  return parser.parseLine();
}

export function parseStatement(input: string): StatementNode {
  const parsed = parseStatements(input);
  return parsed.statements[0] ?? ({ kind: 'EMPTY' } satisfies EmptyStatement);
}
