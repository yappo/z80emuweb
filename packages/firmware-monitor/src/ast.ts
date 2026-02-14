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

export interface UnaryExpression {
  kind: 'unary-expression';
  operator: '+' | '-';
  operand: ExpressionNode;
}

export interface BinaryExpression {
  kind: 'binary-expression';
  operator: '+' | '-' | '*' | '/' | '=' | '<>' | '<' | '<=' | '>' | '>=';
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

export interface NewStatement {
  kind: 'NEW';
}

export interface ListStatement {
  kind: 'LIST';
}

export interface RunStatement {
  kind: 'RUN';
}

export interface PrintStatement {
  kind: 'PRINT';
  items: ExpressionNode[];
}

export interface LetStatement {
  kind: 'LET';
  target: AssignmentTarget;
  expression: ExpressionNode;
}

export interface InputStatement {
  kind: 'INPUT';
  variable: string;
}

export interface GotoStatement {
  kind: 'GOTO';
  targetLine: number;
}

export interface GosubStatement {
  kind: 'GOSUB';
  targetLine: number;
}

export interface ReturnStatement {
  kind: 'RETURN';
}

export interface EndStatement {
  kind: 'END';
}

export interface StopStatement {
  kind: 'STOP';
}

export interface IfStatement {
  kind: 'IF';
  condition: ExpressionNode;
  targetLine: number;
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
  declarations: Array<{ name: string; dimensions: ExpressionNode[] }>;
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
  line?: number;
}

export interface PokeStatement {
  kind: 'POKE';
  address: ExpressionNode;
  value: ExpressionNode;
}

export interface OutStatement {
  kind: 'OUT';
  port: ExpressionNode;
  value: ExpressionNode;
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
  x: ExpressionNode;
  y?: ExpressionNode;
  z?: ExpressionNode;
}

export interface EmptyStatement {
  kind: 'EMPTY';
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
  | EmptyStatement;
