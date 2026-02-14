import type { StatementNode } from './ast';
import { BasicRuntimeError } from './errors';
import { evaluateNumericExpression, evaluatePrintItems } from './semantics';
import type { BasicCommandSpec, BasicMachineAdapter } from './types';

export type RuntimeMode = 'immediate' | 'program';

export interface CommandExecutionContext {
  readonly mode: RuntimeMode;
  readonly variables: Map<string, number>;
  readonly program: Map<number, string>;
  readonly machineAdapter?: BasicMachineAdapter;
  readonly lineToIndex: Map<number, number>;
  readonly gosubStack: number[];
  readonly nextPc: number;
  pushText(text: string): void;
  setWaitingInput(variable: string): void;
}

export interface StatementExecutionResult {
  jumpToIndex?: number;
  stopProgram?: boolean;
}

type StatementKind = StatementNode['kind'];
type Handler<T extends StatementNode> = {
  modes: RuntimeMode[];
  run: (statement: T, context: CommandExecutionContext) => StatementExecutionResult;
};

function missingLine(targetLine: number): never {
  throw new BasicRuntimeError('NO_LINE', `NO LINE ${targetLine}`);
}

const registry: Partial<Record<StatementKind, Handler<StatementNode>>> = {
  EMPTY: {
    modes: ['immediate', 'program'],
    run: () => ({})
  },
  NEW: {
    modes: ['immediate'],
    run: (_statement, context) => {
      context.program.clear();
      context.variables.clear();
      context.pushText('OK\r\n');
      return {};
    }
  },
  LIST: {
    modes: ['immediate'],
    run: (_statement, context) => {
      for (const [line, body] of [...context.program.entries()].sort((a, b) => a[0] - b[0])) {
        context.pushText(`${line} ${body}\r\n`);
      }
      return {};
    }
  },
  RUN: {
    modes: ['immediate'],
    run: () => ({})
  },
  PRINT: {
    modes: ['immediate', 'program'],
    run: (statement, context) => {
      if (statement.kind !== 'PRINT') {
        throw new BasicRuntimeError('BAD_STMT', 'BAD STMT');
      }
      context.pushText(`${evaluatePrintItems(statement.items, context.variables)}\r\n`);
      return {};
    }
  },
  LET: {
    modes: ['immediate', 'program'],
    run: (statement, context) => {
      if (statement.kind !== 'LET') {
        throw new BasicRuntimeError('BAD_STMT', 'BAD STMT');
      }
      const value = evaluateNumericExpression(statement.expression, context.variables);
      context.variables.set(statement.variable, value);
      if (context.mode === 'immediate') {
        context.pushText('OK\r\n');
      }
      return {};
    }
  },
  INPUT: {
    modes: ['immediate'],
    run: (statement, context) => {
      if (statement.kind !== 'INPUT') {
        throw new BasicRuntimeError('BAD_STMT', 'BAD STMT');
      }
      context.setWaitingInput(statement.variable);
      context.pushText('? ');
      return {};
    }
  },
  GOTO: {
    modes: ['program'],
    run: (statement, context) => {
      if (statement.kind !== 'GOTO') {
        throw new BasicRuntimeError('BAD_STMT', 'BAD STMT');
      }
      const target = context.lineToIndex.get(statement.targetLine);
      if (target === undefined) {
        missingLine(statement.targetLine);
      }
      return { jumpToIndex: target };
    }
  },
  GOSUB: {
    modes: ['program'],
    run: (statement, context) => {
      if (statement.kind !== 'GOSUB') {
        throw new BasicRuntimeError('BAD_STMT', 'BAD STMT');
      }
      const target = context.lineToIndex.get(statement.targetLine);
      if (target === undefined) {
        missingLine(statement.targetLine);
      }
      context.gosubStack.push(context.nextPc);
      return { jumpToIndex: target };
    }
  },
  RETURN: {
    modes: ['program'],
    run: (_statement, context) => {
      const resume = context.gosubStack.pop();
      if (resume === undefined) {
        throw new BasicRuntimeError('RETURN_WO_GOSUB', 'RETURN W/O GOSUB');
      }
      return { jumpToIndex: resume };
    }
  },
  END: {
    modes: ['program'],
    run: () => ({ stopProgram: true })
  },
  STOP: {
    modes: ['program'],
    run: () => ({ stopProgram: true })
  },
  IF: {
    modes: ['program'],
    run: (statement, context) => {
      if (statement.kind !== 'IF') {
        throw new BasicRuntimeError('BAD_STMT', 'BAD STMT');
      }
      const cond = evaluateNumericExpression(statement.condition, context.variables);
      if (cond === 0) {
        return {};
      }

      const target = context.lineToIndex.get(statement.targetLine);
      if (target === undefined) {
        missingLine(statement.targetLine);
      }
      return { jumpToIndex: target };
    }
  },
  CLS: {
    modes: ['immediate', 'program'],
    run: (_statement, context) => {
      context.machineAdapter?.clearLcd?.();
      if (context.mode === 'immediate') {
        context.pushText('OK\r\n');
      }
      return {};
    }
  },
  REM: {
    modes: ['immediate', 'program'],
    run: () => ({})
  }
};

export function isRegisteredStatement(kind: StatementKind): boolean {
  return registry[kind] !== undefined;
}

export function executeRegisteredStatement(
  statement: StatementNode,
  context: CommandExecutionContext
): StatementExecutionResult {
  const handler = registry[statement.kind];
  if (!handler) {
    throw new BasicRuntimeError('BAD_STMT', `BAD STMT: ${statement.kind}`);
  }

  if (!handler.modes.includes(context.mode)) {
    if (statement.kind === 'INPUT' && context.mode === 'program') {
      throw new BasicRuntimeError('INPUT_IN_RUN', 'INPUT IN RUN');
    }
    throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
  }

  return handler.run(statement, context);
}

export const BUILTIN_COMMAND_SPECS: BasicCommandSpec[] = [
  {
    id: 'NEW',
    keyword: 'NEW',
    category: 'program',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['ver0-doc-index', 'ver0-js'],
    positiveCaseIds: ['new-clears-program'],
    negativeCaseIds: ['new-rejects-arguments'],
    notes: 'Clears program and variables.'
  },
  {
    id: 'LIST',
    keyword: 'LIST',
    category: 'program',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['ver0-doc-index', 'ver0-js'],
    positiveCaseIds: ['list-prints-lines'],
    negativeCaseIds: ['list-rejects-arguments'],
    notes: 'Lists stored program lines.'
  },
  {
    id: 'RUN',
    keyword: 'RUN',
    category: 'program',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['ver0-doc-index', 'ver0-js'],
    positiveCaseIds: ['run-simple-program'],
    negativeCaseIds: ['run-detects-runaway'],
    notes: 'Runs stored program.'
  },
  {
    id: 'PRINT',
    keyword: 'PRINT',
    category: 'io',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['ver0-doc-index', 'pokecom-basic-samples'],
    positiveCaseIds: ['print-expression'],
    negativeCaseIds: ['print-rejects-empty-expression'],
    notes: 'String and numeric output.'
  },
  {
    id: 'LET',
    keyword: 'LET',
    category: 'expression',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['ver0-doc-index', 'ver0-js'],
    positiveCaseIds: ['let-assignment'],
    negativeCaseIds: ['let-rejects-invalid-var'],
    notes: 'Variable assignment.'
  },
  {
    id: 'INPUT',
    keyword: 'INPUT',
    category: 'io',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['ver0-doc-index', 'ver0-js'],
    positiveCaseIds: ['input-immediate'],
    negativeCaseIds: ['input-rejected-in-run'],
    notes: 'Immediate numeric input.'
  },
  {
    id: 'GOTO',
    keyword: 'GOTO',
    category: 'control',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['ver0-doc-index', 'ver0-js'],
    positiveCaseIds: ['goto-jump'],
    negativeCaseIds: ['goto-missing-line'],
    notes: 'Branch to target line.'
  },
  {
    id: 'GOSUB',
    keyword: 'GOSUB',
    category: 'control',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['ver0-doc-index', 'ver0-js'],
    positiveCaseIds: ['gosub-return'],
    negativeCaseIds: ['gosub-missing-line'],
    notes: 'Call subroutine.'
  },
  {
    id: 'RETURN',
    keyword: 'RETURN',
    category: 'control',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['ver0-doc-index', 'ver0-js'],
    positiveCaseIds: ['gosub-return'],
    negativeCaseIds: ['return-without-gosub'],
    notes: 'Return from subroutine.'
  },
  {
    id: 'IF',
    keyword: 'IF',
    category: 'control',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['ver0-doc-index', 'ver0-js'],
    positiveCaseIds: ['if-then-jump'],
    negativeCaseIds: ['if-rejects-malformed'],
    notes: 'Conditional branch to line.'
  },
  {
    id: 'END',
    keyword: 'END',
    category: 'control',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['ver0-doc-index', 'ver0-js'],
    positiveCaseIds: ['end-stops-program'],
    negativeCaseIds: ['end-rejects-arguments'],
    notes: 'Terminate RUN.'
  },
  {
    id: 'STOP',
    keyword: 'STOP',
    category: 'control',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['ver0-doc-index', 'ver0-js'],
    positiveCaseIds: ['stop-stops-program'],
    negativeCaseIds: ['stop-rejects-arguments'],
    notes: 'Stop RUN.'
  },
  {
    id: 'CLS',
    keyword: 'CLS',
    category: 'display',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['pokecom-basic-samples', 'ver0-js'],
    positiveCaseIds: ['cls-clears-display'],
    negativeCaseIds: ['cls-rejects-arguments'],
    notes: 'Clear display via machine adapter.'
  },
  {
    id: 'REM',
    keyword: 'REM',
    category: 'program',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['ver0-doc-index', 'ver0-js'],
    positiveCaseIds: ['rem-ignored'],
    negativeCaseIds: ['unknown-command'],
    notes: 'Comment statement.'
  },
  {
    id: 'FOR',
    keyword: 'FOR',
    category: 'control',
    status: 'TBD',
    confidence: 'HYPOTHESIS',
    implemented: false,
    evidence: ['ver0-doc-index'],
    positiveCaseIds: [],
    negativeCaseIds: [],
    notes: 'Not implemented yet.'
  },
  {
    id: 'NEXT',
    keyword: 'NEXT',
    category: 'control',
    status: 'TBD',
    confidence: 'HYPOTHESIS',
    implemented: false,
    evidence: ['ver0-doc-index'],
    positiveCaseIds: [],
    negativeCaseIds: [],
    notes: 'Not implemented yet.'
  },
  {
    id: 'POKE',
    keyword: 'POKE',
    category: 'machine',
    status: 'TBD',
    confidence: 'DERIVED',
    implemented: false,
    evidence: ['pokecom-basic-samples', 'akiyan-g850-tech'],
    positiveCaseIds: [],
    negativeCaseIds: [],
    notes: 'Not implemented yet.'
  }
];
