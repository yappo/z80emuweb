import type { StatementNode } from './ast';
import { BasicRuntimeError } from './errors';
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

// 実行は runtime.ts 側で行う。互換APIとして関数のみ維持。
export function isRegisteredStatement(_kind: StatementNode['kind']): boolean {
  return false;
}

export function executeRegisteredStatement(
  statement: StatementNode,
  context: CommandExecutionContext
): StatementExecutionResult {
  if (statement.kind === 'INPUT' && context.mode === 'program') {
    throw new BasicRuntimeError('INPUT_IN_RUN', 'INPUT IN RUN');
  }
  throw new BasicRuntimeError('BAD_STMT', `BAD STMT: ${statement.kind}`);
}

// 互換性レポートで使う内蔵コマンド仕様一覧。
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
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['ver0-doc-index'],
    positiveCaseIds: ['for-next-loop'],
    negativeCaseIds: ['next-without-for'],
    notes: 'FOR-NEXT loop with optional STEP.'
  },
  {
    id: 'NEXT',
    keyword: 'NEXT',
    category: 'control',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['ver0-doc-index'],
    positiveCaseIds: ['for-next-loop'],
    negativeCaseIds: ['next-without-for'],
    notes: 'Loop increment and branch.'
  },
  {
    id: 'DIM',
    keyword: 'DIM',
    category: 'data',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['ver0-doc-index'],
    positiveCaseIds: ['dim-array-assignment'],
    negativeCaseIds: ['dim-invalid-size'],
    notes: 'Declares numeric arrays.'
  },
  {
    id: 'DATA',
    keyword: 'DATA',
    category: 'data',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['ver0-doc-index'],
    positiveCaseIds: ['data-read-restore'],
    negativeCaseIds: ['read-data-exhausted'],
    notes: 'Program data stream source.'
  },
  {
    id: 'READ',
    keyword: 'READ',
    category: 'data',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['ver0-doc-index'],
    positiveCaseIds: ['data-read-restore'],
    negativeCaseIds: ['read-data-exhausted'],
    notes: 'Reads values from DATA stream.'
  },
  {
    id: 'RESTORE',
    keyword: 'RESTORE',
    category: 'data',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['ver0-doc-index'],
    positiveCaseIds: ['data-read-restore'],
    negativeCaseIds: ['restore-missing-line'],
    notes: 'Resets DATA pointer.'
  },
  {
    id: 'PEEK',
    keyword: 'PEEK',
    category: 'machine',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['pokecom-basic-samples', 'akiyan-g850-tech'],
    positiveCaseIds: ['peek-poke-roundtrip'],
    negativeCaseIds: ['peek-invalid-args'],
    notes: 'Reads memory value as expression.'
  },
  {
    id: 'POKE',
    keyword: 'POKE',
    category: 'machine',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['pokecom-basic-samples', 'akiyan-g850-tech'],
    positiveCaseIds: ['peek-poke-roundtrip'],
    negativeCaseIds: ['poke-invalid-args'],
    notes: 'Writes memory value.'
  },
  {
    id: 'INP',
    keyword: 'INP',
    category: 'machine',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['akiyan-g850-tech', 'ver0-doc-index'],
    positiveCaseIds: ['inp-out-roundtrip'],
    negativeCaseIds: ['inp-invalid-args'],
    notes: 'Reads I/O port as expression.'
  },
  {
    id: 'OUT',
    keyword: 'OUT',
    category: 'machine',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['pokecom-basic-samples', 'akiyan-g850-tech'],
    positiveCaseIds: ['inp-out-roundtrip'],
    negativeCaseIds: ['out-invalid-args'],
    notes: 'Writes I/O port value.'
  },
  {
    id: 'BEEP',
    keyword: 'BEEP',
    category: 'audio',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['ashitani-g850-general'],
    positiveCaseIds: ['beep-calls-sleep'],
    negativeCaseIds: ['beep-too-many-args'],
    notes: 'Silent implementation with bounded delay.'
  },
  {
    id: 'WAIT',
    keyword: 'WAIT',
    category: 'machine',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['ver0-doc-index'],
    positiveCaseIds: ['wait-calls-sleep'],
    negativeCaseIds: ['wait-invalid-args'],
    notes: 'Waits by 1/64 second ticks or default 1s.'
  },
  {
    id: 'LOCATE',
    keyword: 'LOCATE',
    category: 'display',
    status: 'LOCKED',
    confidence: 'DERIVED',
    implemented: true,
    evidence: ['ver0-doc-index'],
    positiveCaseIds: ['locate-moves-cursor'],
    negativeCaseIds: ['locate-invalid-args'],
    notes: 'Moves text cursor; third argument is accepted but ignored.'
  }
];
