import { BUILTIN_COMMAND_SPECS } from './command-registry';
import type {
  AssignmentTarget,
  DataStatement,
  ExpressionNode,
  ForStatement,
  NextStatement,
  StatementNode
} from './ast';
import { asDisplayError, BasicRuntimeError } from './errors';
import { parseStatement } from './parser';
import { evaluateNumericExpression, evaluatePrintItems } from './semantics';
import type {
  BasicCommandSpec,
  CompatibilityReport,
  MonitorRuntimeSnapshot,
  RuntimeOptions
} from './types';

function parseIntSafe(text: string): number {
  const value = Number.parseInt(text, 10);
  return Number.isNaN(value) ? 0 : value;
}

function normalizeProgramLine(statement: string): string {
  return statement.trim();
}

function isDisplayInputByte(value: number): boolean {
  return (value >= 0x20 && value <= 0x7e) || value >= 0x80;
}

function clampInt(value: number): number {
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    return 0;
  }
  return Math.trunc(value);
}

interface ProgramEntry {
  line: number;
  source: string;
  statement: StatementNode;
}

interface BasicArray {
  dimensions: number[];
  data: number[];
}

interface ForFrame {
  variable: string;
  forPc: number;
  endValue: number;
  stepValue: number;
}

interface ExecutionState {
  mode: 'immediate' | 'program';
  entries: ProgramEntry[];
  lineToIndex: Map<number, number>;
  forToNext: Map<number, number>;
  pc: number;
  nextPc: number;
}

interface StatementExecutionResult {
  jumpToIndex?: number;
  stopProgram?: boolean;
}

interface ActiveProgramState {
  entries: ProgramEntry[];
  lineToIndex: Map<number, number>;
  forToNext: Map<number, number>;
  pc: number;
  steps: number;
  maxSteps: number;
  promptOnComplete: boolean;
}

class RuntimeWaitSignal extends Error {
  constructor(readonly delayMs: number) {
    super('RUNTIME_WAIT_SIGNAL');
    this.name = 'RuntimeWaitSignal';
  }
}

function missingLine(targetLine: number): never {
  throw new BasicRuntimeError('NO_LINE', `NO LINE ${targetLine}`);
}

function shouldContinueLoop(current: number, endValue: number, stepValue: number): boolean {
  if (stepValue < 0) {
    return current >= endValue;
  }
  return current <= endValue;
}

function computeBeepDurationMs(j: number, n: number): number {
  const seconds = 0.125 * (n + 1) * j;
  const clamped = Math.max(1, Math.min(3, seconds));
  return Math.trunc(clamped * 1000);
}

// PC-G815 互換の簡易 BASIC ランタイム。
export class PcG815BasicRuntime {
  private readonly outputQueue: number[] = [];

  private readonly variables = new Map<string, number>();

  private readonly arrays = new Map<string, BasicArray>();

  private readonly program = new Map<number, string>();

  private readonly commandSpecs: BasicCommandSpec[];

  private readonly forStack: ForFrame[] = [];

  private readonly gosubStack: number[] = [];

  private readonly dataPool: number[] = [];

  private readonly dataLineToCursor = new Map<number, number>();

  private dataCursor = 0;

  private lineBuffer = '';

  private waitingInputVar: string | null = null;

  private observationProfileId: string;

  private activeProgram: ActiveProgramState | null = null;

  private activeProgramWakeAtMs = 0;

  constructor(private readonly options: RuntimeOptions = {}) {
    this.commandSpecs = [...(options.commandSpecs ?? BUILTIN_COMMAND_SPECS)];
    this.observationProfileId = options.defaultProfileId ?? 'public-observed-v1';
  }

  reset(cold = false): void {
    this.outputQueue.length = 0;
    this.lineBuffer = '';
    this.waitingInputVar = null;
    this.forStack.length = 0;
    this.gosubStack.length = 0;
    this.dataPool.length = 0;
    this.dataCursor = 0;
    this.dataLineToCursor.clear();
    this.activeProgram = null;
    this.activeProgramWakeAtMs = 0;

    if (cold) {
      this.variables.clear();
      this.arrays.clear();
      this.program.clear();
    }
  }

  receiveChar(charCode: number): void {
    const value = charCode & 0xff;

    if (value === 0x00) {
      return;
    }

    if (value === 0x08 || value === 0x7f) {
      if (this.lineBuffer.length > 0) {
        this.lineBuffer = this.lineBuffer.slice(0, -1);
        this.pushText('\b');
      }
      return;
    }

    if (value === 0x0d || value === 0x0a) {
      const line = this.lineBuffer;
      this.lineBuffer = '';
      this.pushText('\r\n');
      this.executeLine(line);
      return;
    }

    if (isDisplayInputByte(value)) {
      this.lineBuffer += String.fromCharCode(value);
      this.pushByte(value);
    }
  }

  executeLine(input: string): void {
    const line = input.trim();

    if (this.waitingInputVar !== null) {
      const parsed = parseIntSafe(line);
      this.variables.set(this.waitingInputVar, parsed);
      this.waitingInputVar = null;
      this.pushPrompt();
      return;
    }

    if (line.length === 0) {
      this.pushPrompt();
      return;
    }

    const lineNumberMatch = line.match(/^(\d+)\s*(.*)$/);
    if (lineNumberMatch) {
      const lineNoText = lineNumberMatch[1];
      const statementText = lineNumberMatch[2] ?? '';
      if (!lineNoText) {
        this.pushText(`ERR ${asDisplayError(new BasicRuntimeError('BAD_LINE'))}\r\n`);
        this.pushPrompt();
        return;
      }

      try {
        const lineNumber = parseIntSafe(lineNoText);
        const normalized = normalizeProgramLine(statementText);
        if (normalized.length === 0) {
          this.program.delete(lineNumber);
        } else {
          parseStatement(normalized);
          this.program.set(lineNumber, normalized);
        }
        this.pushText('OK\r\n');
      } catch (error) {
        this.pushText(`ERR ${asDisplayError(error)}\r\n`);
      }
      this.pushPrompt();
      return;
    }

    try {
      const statement = parseStatement(line);
      this.executeImmediateStatement(statement);
    } catch (error) {
      this.pushText(`ERR ${asDisplayError(error)}\r\n`);
    }

    if (this.waitingInputVar === null && !this.isProgramRunning()) {
      this.pushPrompt();
    }
  }

  runProgram(maxSteps = 10_000, promptOnComplete = false): void {
    if (this.activeProgram !== null) {
      return;
    }

    const entries = this.getSortedProgramEntries();
    const lineToIndex = new Map<number, number>();
    entries.forEach((entry, index) => lineToIndex.set(entry.line, index));
    const forToNext = this.buildForToNextMap(entries);

    this.forStack.length = 0;
    this.gosubStack.length = 0;
    this.buildDataPool(entries);
    this.dataCursor = 0;

    this.activeProgram = {
      entries,
      lineToIndex,
      forToNext,
      pc: 0,
      steps: 0,
      maxSteps,
      promptOnComplete
    };
    this.activeProgramWakeAtMs = 0;
    this.pump(Date.now());
  }

  pump(nowMs = Date.now()): void {
    const active = this.activeProgram;
    if (!active) {
      return;
    }
    if (nowMs < this.activeProgramWakeAtMs) {
      return;
    }

    while (active.pc < active.entries.length) {
      active.steps += 1;
      if (active.steps > active.maxSteps) {
        this.finishProgramWithError(new BasicRuntimeError('RUNAWAY', 'RUNAWAY'));
        return;
      }

      const entry = active.entries[active.pc];
      if (!entry) {
        break;
      }

      try {
        const result = this.executeStatement(entry.statement, {
          mode: 'program',
          entries: active.entries,
          lineToIndex: active.lineToIndex,
          forToNext: active.forToNext,
          pc: active.pc,
          nextPc: active.pc + 1
        });

        if (result.stopProgram) {
          this.finishProgramSuccess();
          return;
        }

        active.pc = result.jumpToIndex ?? active.pc + 1;
      } catch (error) {
        if (error instanceof RuntimeWaitSignal) {
          active.pc += 1;
          this.activeProgramWakeAtMs = nowMs + Math.max(0, error.delayMs);
          return;
        }
        this.finishProgramWithError(error);
        return;
      }
    }

    this.finishProgramSuccess();
  }

  isProgramRunning(): boolean {
    return this.activeProgram !== null;
  }

  popOutputChar(): number {
    return this.outputQueue.shift() ?? 0;
  }

  getSnapshot(): MonitorRuntimeSnapshot {
    const arrays: MonitorRuntimeSnapshot['arrays'] = {};
    for (const [name, array] of this.arrays.entries()) {
      arrays[name] = {
        dimensions: [...array.dimensions],
        data: [...array.data]
      };
    }

    return {
      outputQueue: [...this.outputQueue],
      lineBuffer: this.lineBuffer,
      variables: Object.fromEntries(this.variables.entries()),
      arrays,
      program: [...this.program.entries()],
      waitingInputVar: this.waitingInputVar,
      observationProfileId: this.observationProfileId
    };
  }

  loadSnapshot(snapshot: MonitorRuntimeSnapshot): void {
    this.outputQueue.length = 0;
    this.outputQueue.push(...snapshot.outputQueue.map((v) => v & 0xff));

    this.lineBuffer = snapshot.lineBuffer;
    this.forStack.length = 0;
    this.gosubStack.length = 0;
    this.dataPool.length = 0;
    this.dataCursor = 0;
    this.dataLineToCursor.clear();

    this.variables.clear();
    for (const [key, value] of Object.entries(snapshot.variables)) {
      this.variables.set(key, value);
    }

    this.arrays.clear();
    for (const [name, array] of Object.entries(snapshot.arrays ?? {})) {
      this.arrays.set(name, {
        dimensions: [...array.dimensions],
        data: [...array.data]
      });
    }

    this.program.clear();
    for (const [line, statement] of snapshot.program) {
      this.program.set(line, statement);
    }

    this.waitingInputVar = snapshot.waitingInputVar;
    this.observationProfileId = snapshot.observationProfileId ?? 'public-observed-v1';
  }

  loadObservationProfile(profileId: string): void {
    this.observationProfileId = profileId;
  }

  getCompatibilityReport(): CompatibilityReport {
    const locked = this.commandSpecs.filter((entry) => entry.status === 'LOCKED');
    const implemented = this.commandSpecs.filter((entry) => entry.implemented);

    return {
      profileId: this.observationProfileId,
      totalCommands: this.commandSpecs.length,
      lockedCommands: locked.length,
      implementedCommands: implemented.length,
      lockedUnimplemented: locked.filter((entry) => !entry.implemented).map((entry) => entry.keyword),
      tbdCommands: this.commandSpecs.filter((entry) => entry.status === 'TBD').map((entry) => entry.keyword)
    };
  }

  getVariables(): ReadonlyMap<string, number> {
    return this.variables;
  }

  getProgramLines(): ReadonlyMap<number, string> {
    return this.program;
  }

  private executeImmediateStatement(statement: StatementNode): void {
    if (statement.kind === 'RUN') {
      this.runProgram(10_000, true);
      return;
    }

    this.executeStatement(statement, {
      mode: 'immediate',
      entries: [],
      lineToIndex: new Map(),
      forToNext: new Map(),
      pc: -1,
      nextPc: 0
    });
  }

  private executeStatement(statement: StatementNode, state: ExecutionState): StatementExecutionResult {
    switch (statement.kind) {
      case 'EMPTY':
      case 'REM':
      case 'DATA':
        return {};
      case 'NEW':
        this.assertMode(state, ['immediate']);
        this.program.clear();
        this.variables.clear();
        this.arrays.clear();
        this.forStack.length = 0;
        this.gosubStack.length = 0;
        this.dataPool.length = 0;
        this.dataCursor = 0;
        this.dataLineToCursor.clear();
        this.pushText('OK\r\n');
        return {};
      case 'LIST':
        this.assertMode(state, ['immediate']);
        for (const [line, body] of [...this.program.entries()].sort((a, b) => a[0] - b[0])) {
          this.pushText(`${line} ${body}\r\n`);
        }
        return {};
      case 'PRINT':
        this.pushText(`${evaluatePrintItems(statement.items, this.getEvalContext())}\r\n`);
        return {};
      case 'LET': {
        const value = this.evaluateNumeric(statement.expression);
        this.assignTarget(statement.target, value);
        if (state.mode === 'immediate') {
          this.pushText('OK\r\n');
        }
        return {};
      }
      case 'INPUT':
        this.assertMode(state, ['immediate']);
        this.waitingInputVar = statement.variable;
        this.pushText('? ');
        return {};
      case 'GOTO': {
        this.assertMode(state, ['program']);
        const target = state.lineToIndex.get(statement.targetLine);
        if (target === undefined) {
          missingLine(statement.targetLine);
        }
        return { jumpToIndex: target };
      }
      case 'GOSUB': {
        this.assertMode(state, ['program']);
        const target = state.lineToIndex.get(statement.targetLine);
        if (target === undefined) {
          missingLine(statement.targetLine);
        }
        this.gosubStack.push(state.nextPc);
        return { jumpToIndex: target };
      }
      case 'RETURN': {
        this.assertMode(state, ['program']);
        const resume = this.gosubStack.pop();
        if (resume === undefined) {
          throw new BasicRuntimeError('RETURN_WO_GOSUB', 'RETURN W/O GOSUB');
        }
        return { jumpToIndex: resume };
      }
      case 'END':
      case 'STOP':
        this.assertMode(state, ['program']);
        return { stopProgram: true };
      case 'IF': {
        this.assertMode(state, ['program']);
        const cond = this.evaluateNumeric(statement.condition);
        if (cond === 0) {
          return {};
        }
        const target = state.lineToIndex.get(statement.targetLine);
        if (target === undefined) {
          missingLine(statement.targetLine);
        }
        return { jumpToIndex: target };
      }
      case 'CLS':
        this.options.machineAdapter?.clearLcd?.();
        if (state.mode === 'immediate') {
          this.pushText('OK\r\n');
        }
        return {};
      case 'FOR':
        this.assertMode(state, ['program']);
        return this.executeFor(statement, state);
      case 'NEXT':
        this.assertMode(state, ['program']);
        return this.executeNext(statement);
      case 'DIM':
        for (const decl of statement.declarations) {
          const dimensions = decl.dimensions.map((expr) => this.evaluateNumeric(expr));
          this.defineArray(decl.name, dimensions);
        }
        return {};
      case 'READ':
        for (const target of statement.targets) {
          if (this.dataCursor >= this.dataPool.length) {
            throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
          }
          const value = this.dataPool[this.dataCursor] ?? 0;
          this.dataCursor += 1;
          this.assignTarget(target, value);
        }
        return {};
      case 'RESTORE':
        if (statement.line === undefined) {
          this.dataCursor = 0;
          return {};
        }
        this.dataCursor = this.resolveRestoreCursor(statement.line, state);
        return {};
      case 'POKE': {
        const address = this.evaluateNumeric(statement.address) & 0xffff;
        const value = this.evaluateNumeric(statement.value) & 0xff;
        this.options.machineAdapter?.poke8?.(address, value);
        return {};
      }
      case 'OUT': {
        const port = this.evaluateNumeric(statement.port) & 0xff;
        const value = this.evaluateNumeric(statement.value) & 0xff;
        this.options.machineAdapter?.out8?.(port, value);
        return {};
      }
      case 'BEEP': {
        const j = statement.j ? this.evaluateNumeric(statement.j) : 8;
        if (statement.k) {
          this.evaluateNumeric(statement.k);
        }
        const n = statement.n ? this.evaluateNumeric(statement.n) : 0;
        const sleepMs = computeBeepDurationMs(j, n);
        this.waitMilliseconds(sleepMs, state.mode);
        return {};
      }
      case 'WAIT': {
        if (!statement.duration) {
          this.waitMilliseconds(1000, state.mode);
          return {};
        }
        const ticks = this.evaluateNumeric(statement.duration);
        if (ticks <= 0) {
          return {};
        }
        const sleepMs = Math.max(1, Math.trunc((ticks * 1000) / 64));
        this.waitMilliseconds(sleepMs, state.mode);
        return {};
      }
      case 'LOCATE': {
        const x = this.evaluateNumeric(statement.x);
        const y = statement.y ? this.evaluateNumeric(statement.y) : 0;
        if (statement.z) {
          this.evaluateNumeric(statement.z);
        }
        this.options.machineAdapter?.setTextCursor?.(Math.max(0, x), Math.max(0, y));
        return {};
      }
      default:
        throw new BasicRuntimeError('BAD_STMT', `BAD STMT: ${statement.kind}`);
    }
  }

  private executeFor(statement: ForStatement, state: ExecutionState): StatementExecutionResult {
    const startValue = this.evaluateNumeric(statement.start);
    const endValue = this.evaluateNumeric(statement.end);
    const stepValue = statement.step ? this.evaluateNumeric(statement.step) : 1;
    const normalizedStep = stepValue === 0 ? 1 : stepValue;

    this.variables.set(statement.variable, startValue);
    const shouldEnter = shouldContinueLoop(startValue, endValue, normalizedStep);

    const nextIndex = state.forToNext.get(state.pc);
    if (nextIndex === undefined) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    if (!shouldEnter) {
      return { jumpToIndex: nextIndex + 1 };
    }

    this.forStack.push({
      variable: statement.variable,
      forPc: state.pc,
      endValue,
      stepValue: normalizedStep
    });
    return {};
  }

  private executeNext(statement: NextStatement): StatementExecutionResult {
    if (this.forStack.length === 0) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    const frame = this.forStack[this.forStack.length - 1];
    if (!frame) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    if (statement.variable && statement.variable !== frame.variable) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    const current = this.variables.get(frame.variable) ?? 0;
    const nextValue = current + frame.stepValue;
    this.variables.set(frame.variable, clampInt(nextValue));

    if (shouldContinueLoop(nextValue, frame.endValue, frame.stepValue)) {
      return { jumpToIndex: frame.forPc + 1 };
    }

    this.forStack.pop();
    return {};
  }

  private getSortedProgramEntries(): ProgramEntry[] {
    return [...this.program.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([line, source]) => ({ line, source, statement: parseStatement(source) }));
  }

  private buildForToNextMap(entries: ProgramEntry[]): Map<number, number> {
    const result = new Map<number, number>();
    const stack: number[] = [];

    for (let index = 0; index < entries.length; index += 1) {
      const statement = entries[index]?.statement;
      if (!statement) {
        continue;
      }

      if (statement.kind === 'FOR') {
        stack.push(index);
        continue;
      }

      if (statement.kind === 'NEXT') {
        const forIndex = stack.pop();
        if (forIndex !== undefined) {
          result.set(forIndex, index);
        }
      }
    }

    return result;
  }

  private buildDataPool(entries: ProgramEntry[]): void {
    this.dataPool.length = 0;
    this.dataLineToCursor.clear();

    for (const entry of entries) {
      if (entry.statement.kind !== 'DATA') {
        continue;
      }
      this.collectData(entry.line, entry.statement);
    }
  }

  private collectData(line: number, statement: DataStatement): void {
    if (!this.dataLineToCursor.has(line)) {
      this.dataLineToCursor.set(line, this.dataPool.length);
    }

    for (const item of statement.items) {
      this.dataPool.push(this.evaluateNumeric(item));
    }
  }

  private resolveRestoreCursor(targetLine: number, state: ExecutionState): number {
    if (state.mode === 'program') {
      if (!state.lineToIndex.has(targetLine)) {
        missingLine(targetLine);
      }
    } else if (!this.program.has(targetLine)) {
      missingLine(targetLine);
    }

    let selected: number | undefined;
    for (const [line, cursor] of this.dataLineToCursor.entries()) {
      if (line >= targetLine && (selected === undefined || line < selected)) {
        selected = line;
        if (line === targetLine) {
          break;
        }
      }
    }

    if (selected === undefined) {
      return this.dataPool.length;
    }
    return this.dataLineToCursor.get(selected) ?? 0;
  }

  private defineArray(name: string, dimensions: number[]): void {
    if (dimensions.length === 0) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    let size = 1;
    const normalized: number[] = [];
    for (const dim of dimensions) {
      const value = clampInt(dim);
      if (value < 0) {
        throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
      }
      normalized.push(value);
      size *= value + 1;
    }

    this.arrays.set(name, {
      dimensions: normalized,
      data: new Array(size).fill(0)
    });
  }

  private assignTarget(target: AssignmentTarget, value: number): void {
    if (target.kind === 'scalar-target') {
      this.variables.set(target.name, clampInt(value));
      return;
    }

    const array = this.arrays.get(target.name);
    if (!array) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    const indices = target.indices.map((index) => this.evaluateNumeric(index));
    const offset = this.toArrayOffset(array, indices);
    array.data[offset] = clampInt(value);
  }

  private readArray(name: string, indices: number[]): number {
    const array = this.arrays.get(name);
    if (!array) {
      return 0;
    }
    const offset = this.toArrayOffset(array, indices);
    return array.data[offset] ?? 0;
  }

  private toArrayOffset(array: BasicArray, indices: number[]): number {
    if (indices.length !== array.dimensions.length) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    let offset = 0;
    for (let i = 0; i < array.dimensions.length; i += 1) {
      const upper = array.dimensions[i] ?? 0;
      const index = clampInt(indices[i] ?? 0);
      if (index < 0 || index > upper) {
        throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
      }
      offset = offset * (upper + 1) + index;
    }
    return offset;
  }

  private assertMode(state: ExecutionState, allowed: Array<'immediate' | 'program'>): void {
    if (allowed.includes(state.mode)) {
      return;
    }

    if (state.mode === 'program' && state.pc >= 0) {
      const entry = state.entries[state.pc];
      if (entry?.statement.kind === 'INPUT') {
        throw new BasicRuntimeError('INPUT_IN_RUN', 'INPUT IN RUN');
      }
    }

    throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
  }

  private getEvalContext() {
    return {
      vars: this.variables,
      machineAdapter: this.options.machineAdapter,
      readArray: (name: string, indices: number[]) => this.readArray(name, indices)
    };
  }

  private evaluateNumeric(expression: ExpressionNode): number {
    return evaluateNumericExpression(expression, this.getEvalContext());
  }

  private sleepMilliseconds(ms: number): void {
    const clamped = Math.max(0, Math.trunc(ms));
    if (clamped <= 0) {
      return;
    }

    if (this.options.machineAdapter?.sleepMs) {
      this.options.machineAdapter.sleepMs(clamped);
      return;
    }
    // NOTE: デフォルト実装は非ブロッキング。時間待ちはアダプタ側へ委譲する。
  }

  private waitMilliseconds(ms: number, mode: 'immediate' | 'program'): void {
    const clamped = Math.max(0, Math.trunc(ms));
    if (clamped <= 0) {
      return;
    }
    if (mode === 'program') {
      throw new RuntimeWaitSignal(clamped);
    }
    this.sleepMilliseconds(clamped);
  }

  private finishProgramSuccess(): void {
    const promptOnComplete = this.activeProgram?.promptOnComplete ?? false;
    this.activeProgram = null;
    this.activeProgramWakeAtMs = 0;
    this.pushText('OK\r\n');
    if (promptOnComplete) {
      this.pushPrompt();
    }
  }

  private finishProgramWithError(error: unknown): void {
    const promptOnComplete = this.activeProgram?.promptOnComplete ?? false;
    this.activeProgram = null;
    this.activeProgramWakeAtMs = 0;
    this.pushText(`ERR ${asDisplayError(error)}\r\n`);
    if (promptOnComplete) {
      this.pushPrompt();
    }
  }

  private pushPrompt(): void {
    this.pushText('> ');
  }

  private pushText(text: string): void {
    for (const ch of text) {
      this.outputQueue.push(ch.charCodeAt(0) & 0xff);
    }
  }

  private pushByte(byte: number): void {
    this.outputQueue.push(byte & 0xff);
  }
}

export class MonitorRuntime extends PcG815BasicRuntime {}

export type { MonitorRuntimeSnapshot };
