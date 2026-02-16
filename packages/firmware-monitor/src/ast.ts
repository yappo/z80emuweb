// 式ノード: 評価器 (semantics.ts / runtime.ts) が解釈する AST。
export interface NumberLiteral {
  kind: 'number-literal';
  value: number;
}

export interface StringLiteral {
  kind: 'string-literal';
  value: string;
}

export interface VariableReference {
  kind: 'variable-reference';
  name: string;
}

export interface ArrayElementReference {
  kind: 'array-element-reference';
  name: string;
  indices: ExpressionNode[];
}

export interface InpCallExpression {
  kind: 'inp-call-expression';
  port: ExpressionNode;
}

export interface PeekCallExpression {
  kind: 'peek-call-expression';
  address: ExpressionNode;
  bank?: ExpressionNode;
}

export interface FunctionCallExpression {
  kind: 'function-call-expression';
  name: string;
  args: ExpressionNode[];
}

export interface UnaryExpression {
  kind: 'unary-expression';
  operator: '+' | '-' | 'NOT';
  operand: ExpressionNode;
}

export interface BinaryExpression {
  kind: 'binary-expression';
  operator:
    | '+'
    | '-'
    | '*'
    | '/'
    | '\\'
    | '^'
    | '='
    | '<>'
    | '<'
    | '<='
    | '>'
    | '>='
    | 'AND'
    | 'OR'
    | 'XOR'
    | 'MOD';
  left: ExpressionNode;
  right: ExpressionNode;
}

export type ExpressionNode =
  | NumberLiteral
  | StringLiteral
  | VariableReference
  | ArrayElementReference
  | InpCallExpression
  | PeekCallExpression
  | FunctionCallExpression
  | UnaryExpression
  | BinaryExpression;

export interface ScalarTarget {
  kind: 'scalar-target';
  name: string;
}

export interface ArrayElementTarget {
  kind: 'array-element-target';
  name: string;
  indices: ExpressionNode[];
}

export type AssignmentTarget = ScalarTarget | ArrayElementTarget;

export interface LineReferenceNumber {
  kind: 'line-reference-number';
  line: number;
}

export interface LineReferenceLabel {
  kind: 'line-reference-label';
  label: string;
}

export type LineReference = LineReferenceNumber | LineReferenceLabel;

export interface NewStatement {
  kind: 'NEW';
}

export interface ListStatement {
  kind: 'LIST';
  target?: LineReference;
  printer?: boolean;
}

export interface RunStatement {
  kind: 'RUN';
  target?: LineReference;
}

export interface PrintStatement {
  kind: 'PRINT';
  items: Array<{
    expression: ExpressionNode;
    separator?: 'comma' | 'semicolon';
  }>;
  channel?: ExpressionNode;
  printer?: boolean;
  usingFormat?: string;
}

export interface LetStatement {
  kind: 'LET';
  target: AssignmentTarget;
  expression: ExpressionNode;
}

export interface InputStatement {
  kind: 'INPUT';
  variables: AssignmentTarget[];
  prompt?: string;
  channel?: ExpressionNode;
}

export interface GotoStatement {
  kind: 'GOTO';
  target: LineReference;
}

export interface GosubStatement {
  kind: 'GOSUB';
  target: LineReference;
}

export interface ReturnStatement {
  kind: 'RETURN';
  target?: LineReference;
}

export interface EndStatement {
  kind: 'END';
}

export interface StopStatement {
  kind: 'STOP';
}

export interface ContStatement {
  kind: 'CONT';
}

export interface IfStatement {
  kind: 'IF';
  condition: ExpressionNode;
  thenBranch: StatementNode[];
  elseBranch?: StatementNode[];
}

export interface ClsStatement {
  kind: 'CLS';
}

export interface RemStatement {
  kind: 'REM';
  text: string;
}

export interface ForStatement {
  kind: 'FOR';
  variable: string;
  start: ExpressionNode;
  end: ExpressionNode;
  step?: ExpressionNode;
}

export interface NextStatement {
  kind: 'NEXT';
  variable?: string;
}

export interface DimStatement {
  kind: 'DIM';
  declarations: Array<{ name: string; dimensions: ExpressionNode[]; stringLength?: ExpressionNode }>;
}

export interface DataStatement {
  kind: 'DATA';
  items: ExpressionNode[];
}

export interface ReadStatement {
  kind: 'READ';
  targets: AssignmentTarget[];
}

export interface RestoreStatement {
  kind: 'RESTORE';
  target?: LineReference;
}

export interface PokeStatement {
  kind: 'POKE';
  address: ExpressionNode;
  values: ExpressionNode[];
}

export interface OutStatement {
  kind: 'OUT';
  value: ExpressionNode;
  port?: ExpressionNode;
}

export interface BeepStatement {
  kind: 'BEEP';
  j?: ExpressionNode;
  k?: ExpressionNode;
  n?: ExpressionNode;
}

export interface WaitStatement {
  kind: 'WAIT';
  duration?: ExpressionNode;
}

export interface LocateStatement {
  kind: 'LOCATE';
  x?: ExpressionNode;
  y?: ExpressionNode;
  z?: ExpressionNode;
}

export interface ClearStatement {
  kind: 'CLEAR';
}

export interface DeleteStatement {
  kind: 'DELETE';
  start?: number;
  end?: number;
}

export interface EraseStatement {
  kind: 'ERASE';
  names: string[];
}

export interface OnStatement {
  kind: 'ON';
  selector: ExpressionNode;
  mode: 'GOTO' | 'GOSUB';
  targets: LineReference[];
}

export interface RandomizeStatement {
  kind: 'RANDOMIZE';
}

export interface RenumStatement {
  kind: 'RENUM';
  start?: ExpressionNode;
  from?: ExpressionNode;
  step?: ExpressionNode;
}

export interface UsingStatement {
  kind: 'USING';
  format: string;
}

export interface MonStatement {
  kind: 'MON';
}

export interface OpenStatement {
  kind: 'OPEN';
  path: string;
  mode?: 'INPUT' | 'OUTPUT' | 'APPEND';
  handle?: ExpressionNode;
}

export interface CloseStatement {
  kind: 'CLOSE';
  handles: ExpressionNode[];
}

export interface LoadStatement {
  kind: 'LOAD';
  path: string;
}

export interface SaveStatement {
  kind: 'SAVE';
  path: string;
}

export interface LfilesStatement {
  kind: 'LFILES';
}

export interface LcopyStatement {
  kind: 'LCOPY';
  start: ExpressionNode;
  end: ExpressionNode;
  to: ExpressionNode;
}

export interface KillStatement {
  kind: 'KILL';
  path: string;
}

export interface CallStatement {
  kind: 'CALL';
  address: ExpressionNode;
  args: ExpressionNode[];
}

export interface GcursorStatement {
  kind: 'GCURSOR';
  x: ExpressionNode;
  y: ExpressionNode;
}

export interface GprintStatement {
  kind: 'GPRINT';
  items: Array<{
    expression: ExpressionNode;
    separator?: 'comma' | 'semicolon';
  }>;
}

export interface LineStatement {
  kind: 'LINE';
  x1: ExpressionNode;
  y1: ExpressionNode;
  x2: ExpressionNode;
  y2: ExpressionNode;
  mode?: ExpressionNode;
  pattern?: ExpressionNode;
}

export interface PsetStatement {
  kind: 'PSET';
  x: ExpressionNode;
  y: ExpressionNode;
  mode?: ExpressionNode;
}

export interface PresetStatement {
  kind: 'PRESET';
  x: ExpressionNode;
  y: ExpressionNode;
}

export interface ElseStatement {
  kind: 'ELSE';
}

export interface EmptyStatement {
  kind: 'EMPTY';
}

export interface ParsedLine {
  label?: string;
  statements: StatementNode[];
}

// 文ノード: parser.ts がこの union を返し、runtime.ts が実行する。
export type StatementNode =
  | NewStatement
  | ListStatement
  | RunStatement
  | PrintStatement
  | LetStatement
  | InputStatement
  | GotoStatement
  | GosubStatement
  | ReturnStatement
  | EndStatement
  | StopStatement
  | ContStatement
  | IfStatement
  | ClsStatement
  | RemStatement
  | ForStatement
  | NextStatement
  | DimStatement
  | DataStatement
  | ReadStatement
  | RestoreStatement
  | PokeStatement
  | OutStatement
  | BeepStatement
  | WaitStatement
  | LocateStatement
  | ClearStatement
  | DeleteStatement
  | EraseStatement
  | OnStatement
  | RandomizeStatement
  | RenumStatement
  | UsingStatement
  | MonStatement
  | OpenStatement
  | CloseStatement
  | LoadStatement
  | SaveStatement
  | LfilesStatement
  | LcopyStatement
  | KillStatement
  | CallStatement
  | GcursorStatement
  | GprintStatement
  | LineStatement
  | PsetStatement
  | PresetStatement
  | ElseStatement
  | EmptyStatement;
