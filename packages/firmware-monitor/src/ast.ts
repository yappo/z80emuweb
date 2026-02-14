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
  | UnaryExpression
  | BinaryExpression;

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
  variable: string;
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

export interface EmptyStatement {
  kind: 'EMPTY';
}

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
  | EmptyStatement;
