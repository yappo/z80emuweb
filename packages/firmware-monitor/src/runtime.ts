import { BUILTIN_COMMAND_SPECS } from './command-registry';
import type {
  CircleStatement,
  AssignmentTarget,
  DataStatement,
  DeleteStatement,
  DimStatement,
  ExpressionNode,
  ForStatement,
  GcursorStatement,
  GprintStatement,
  LninputStatement,
  IfStatement,
  InputStatement,
  LineReference,
  ListStatement,
  NextStatement,
  OnStatement,
  PaintStatement,
  ParsedLine,
  PrintStatement,
  RenumStatement,
  SpinpStatement,
  StatementNode
} from './ast';
import { asDisplayError, BasicRuntimeError } from './errors';
import { parseStatements } from './parser';
import { evaluateExpression, evaluateNumericExpression, evaluatePrintItems } from './semantics';
import type {
  BasicCommandSpec,
  CompatibilityReport,
  MonitorRuntimeSnapshot,
  RuntimeOptions,
  ScalarValue,
  SnapshotArray
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

function isStringName(name: string): boolean {
  return name.endsWith('$');
}

function quoteStringIfNeeded(value: string): string {
  if (/[,\s:]/.test(value)) {
    return `"${value}"`;
  }
  return value;
}

interface ProgramEntry {
  line: number;
  source: string;
  parsed: ParsedLine;
}

interface ProgramInstruction {
  line: number;
  statementIndex: number;
  statement: StatementNode;
}

interface NumberArray {
  kind: 'number-array';
  dimensions: number[];
  data: number[];
}

interface StringArray {
  kind: 'string-array';
  dimensions: number[];
  length: number;
  data: string[];
}

type BasicArray = NumberArray | StringArray;

interface ForFrame {
  variable: string;
  forPc: number;
  endValue: number;
  stepValue: number;
}

interface RepeatFrame {
  repeatPc: number;
}

interface WhileFrame {
  whilePc: number;
}

interface ExecutionState {
  mode: 'immediate' | 'program';
  instructions: ProgramInstruction[];
  lineToPc: Map<number, number>;
  labelToPc: Map<string, number>;
  pc: number;
  nextPc: number;
}

interface StatementExecutionResult {
  jumpToPc?: number;
  stopProgram?: boolean;
  suspendProgram?: 'stop' | 'input';
}

interface ActiveProgramState {
  instructions: ProgramInstruction[];
  lineToPc: Map<number, number>;
  labelToPc: Map<string, number>;
  pc: number;
  steps: number;
  maxSteps: number;
  promptOnComplete: boolean;
}

interface PendingInput {
  variables: AssignmentTarget[];
  prompt: string;
  mode: 'immediate' | 'program';
  channel?: number;
  rawLine?: boolean;
}

interface SuspendedProgramState {
  reason: 'stop' | 'input';
  state: ActiveProgramState;
}

class RuntimeWaitSignal extends Error {
  constructor(readonly delayMs: number) {
    super('RUNTIME_WAIT_SIGNAL');
    this.name = 'RuntimeWaitSignal';
  }
}

function missingLine(reference: LineReference): never {
  if (reference.kind === 'line-reference-number') {
    throw new BasicRuntimeError('NO_LINE', `NO LINE ${reference.line}`);
  }
  throw new BasicRuntimeError('NO_LINE', `NO LINE ${reference.label}`);
}

function splitInputValues(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inString = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i] ?? '';
    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (!inString && ch === ',') {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  values.push(current.trim());
  return values;
}

function updateNumericReferences(source: string, mapping: Map<number, number>): string {
  if (mapping.size === 0) {
    return source;
  }

  let updated = source;

  updated = updated.replace(
    /\b(RUN|LIST|GOTO|GOSUB|THEN|ELSE|RESTORE|RETURN)\s+(\d+)\b/gi,
    (_full, keyword: string, lineText: string) => {
      const line = parseIntSafe(lineText);
      const mapped = mapping.get(line);
      if (mapped === undefined) {
        return `${keyword} ${lineText}`;
      }
      return `${keyword} ${mapped}`;
    }
  );

  updated = updated.replace(/\bON\s+([^:]*?)\b(GOTO|GOSUB)\s+([^:]+)/gi, (full, prefix, mode, listText: string) => {
    const rewritten = listText
      .split(',')
      .map((item) => {
        const trimmed = item.trim();
        if (!/^\d+$/.test(trimmed)) {
          return item;
        }
        const mapped = mapping.get(parseIntSafe(trimmed));
        if (mapped === undefined) {
          return item;
        }
        return item.replace(trimmed, String(mapped));
      })
      .join(',');
    return `ON ${prefix}${mode} ${rewritten}`;
  });

  return updated;
}

// PC-G815 互換の BASIC ランタイム。
export class PcG815BasicRuntime {
  private readonly outputQueue: number[] = [];

  private readonly variables = new Map<string, ScalarValue>();

  private readonly arrays = new Map<string, BasicArray>();

  private readonly program = new Map<number, string>();

  private readonly commandSpecs: BasicCommandSpec[];

  private readonly forStack: ForFrame[] = [];

  private readonly repeatStack: RepeatFrame[] = [];

  private readonly whileStack: WhileFrame[] = [];

  private readonly gosubStack: number[] = [];

  private readonly dataPool: ScalarValue[] = [];

  private readonly dataLineToCursor = new Map<number, number>();

  private readonly openFileHandles = new Map<number, number>();

  private readonly virtualBinaryFiles = new Map<string, number[]>();

  private dataCursor = 0;

  private lineBuffer = '';

  private pendingInput: PendingInput | null = null;

  private observationProfileId: string;

  private activeProgram: ActiveProgramState | null = null;

  private suspendedProgram: SuspendedProgramState | null = null;

  private activeProgramWakeAtMs = 0;

  private printWaitTicks = 0;

  private printPauseMode = false;

  private currentUsingFormat: string | undefined;

  private graphicCursorX = 0;

  private graphicCursorY = 0;

  private autoLineNext: number | null = null;

  private autoLineStep = 10;

  constructor(private readonly options: RuntimeOptions = {}) {
    this.commandSpecs = [...(options.commandSpecs ?? BUILTIN_COMMAND_SPECS)];
    this.observationProfileId = options.defaultProfileId ?? 'public-observed-v1';
  }

  reset(cold = false): void {
    this.outputQueue.length = 0;
    this.lineBuffer = '';
    this.pendingInput = null;
    this.forStack.length = 0;
    this.repeatStack.length = 0;
    this.whileStack.length = 0;
    this.gosubStack.length = 0;
    this.dataPool.length = 0;
    this.dataCursor = 0;
    this.dataLineToCursor.clear();
    this.activeProgram = null;
    this.suspendedProgram = null;
    this.activeProgramWakeAtMs = 0;
    this.openFileHandles.clear();
    this.virtualBinaryFiles.clear();
    this.printWaitTicks = 0;
    this.printPauseMode = false;
    this.currentUsingFormat = undefined;
    this.graphicCursorX = 0;
    this.graphicCursorY = 0;
    this.autoLineNext = null;
    this.autoLineStep = 10;

    if (cold) {
      this.variables.clear();
      this.arrays.clear();
      this.program.clear();
      this.virtualBinaryFiles.clear();
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

    if (this.pendingInput !== null) {
      this.consumePendingInput(this.pendingInput.rawLine ? input : line);
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
          parseStatements(normalized);
          this.program.set(lineNumber, normalized);
        }
        this.pushText('OK\r\n');
      } catch (error) {
        this.pushText(`ERR ${asDisplayError(error)}\r\n`);
      }
      this.pushPrompt();
      return;
    }

    if (this.autoLineNext !== null) {
      if (line === '.') {
        this.autoLineNext = null;
        this.pushText('OK\r\n');
        this.pushPrompt();
        return;
      }

      try {
        parseStatements(line);
        this.program.set(this.autoLineNext, line);
        this.autoLineNext += Math.max(1, this.autoLineStep);
        this.pushText('OK\r\n');
      } catch (error) {
        this.pushText(`ERR ${asDisplayError(error)}\r\n`);
      }
      this.pushPrompt();
      return;
    }

    try {
      const parsed = parseStatements(line);
      this.executeImmediateLine(parsed);
    } catch (error) {
      this.pushText(`ERR ${asDisplayError(error)}\r\n`);
    }

    if (this.pendingInput === null && !this.isProgramRunning()) {
      this.pushPrompt();
    }
  }

  runProgram(maxSteps = 10_000, promptOnComplete = false, target?: LineReference): void {
    if (this.activeProgram !== null) {
      return;
    }

    const entries = this.getSortedProgramEntries();
    const instructions: ProgramInstruction[] = [];
    const lineToPc = new Map<number, number>();
    const labelToPc = new Map<string, number>();

    for (const entry of entries) {
      if (!lineToPc.has(entry.line)) {
        lineToPc.set(entry.line, instructions.length);
      }

      if (entry.parsed.label && !labelToPc.has(entry.parsed.label)) {
        labelToPc.set(entry.parsed.label, instructions.length);
      }

      if (entry.parsed.statements.length === 0) {
        instructions.push({
          line: entry.line,
          statementIndex: 0,
          statement: { kind: 'EMPTY' }
        });
        continue;
      }

      entry.parsed.statements.forEach((statement, statementIndex) => {
        instructions.push({
          line: entry.line,
          statementIndex,
          statement
        });
      });
    }

    this.variables.clear();
    this.arrays.clear();
    this.forStack.length = 0;
    this.repeatStack.length = 0;
    this.whileStack.length = 0;
    this.gosubStack.length = 0;
    this.currentUsingFormat = undefined;
    this.printWaitTicks = 0;
    this.printPauseMode = false;
    this.buildDataPool(entries);
    this.dataCursor = 0;

    let startPc = 0;
    if (target) {
      startPc = this.resolveReferencePc(target, { lineToPc, labelToPc });
    }

    this.activeProgram = {
      instructions,
      lineToPc,
      labelToPc,
      pc: startPc,
      steps: 0,
      maxSteps,
      promptOnComplete
    };
    this.suspendedProgram = null;
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

    while (active.pc < active.instructions.length) {
      active.steps += 1;
      if (active.steps > active.maxSteps) {
        this.finishProgramWithError(new BasicRuntimeError('RUNAWAY', 'RUNAWAY'));
        return;
      }

      const instruction = active.instructions[active.pc];
      if (!instruction) {
        break;
      }

      try {
        const result = this.executeStatement(instruction.statement, {
          mode: 'program',
          instructions: active.instructions,
          lineToPc: active.lineToPc,
          labelToPc: active.labelToPc,
          pc: active.pc,
          nextPc: active.pc + 1
        });

        if (result.suspendProgram) {
          this.suspendedProgram = {
            reason: result.suspendProgram,
            state: {
              ...active,
              pc: result.jumpToPc ?? active.pc + 1
            }
          };
          this.activeProgram = null;
          this.activeProgramWakeAtMs = 0;
          if (result.suspendProgram === 'stop') {
            this.pushText('BREAK\r\n');
          }
          return;
        }

        if (result.stopProgram) {
          this.finishProgramSuccess();
          return;
        }

        active.pc = result.jumpToPc ?? active.pc + 1;
      } catch (error) {
        if (error instanceof RuntimeWaitSignal) {
          // WAITで協調的に制御を返したプログラムは、RUNAWAYカウンタをリセットする。
          // これにより WAIT を含む常駐ループが時間経過だけで E07 にならない。
          active.steps = 0;
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
      if (array.kind === 'number-array') {
        arrays[name] = {
          kind: 'number-array',
          dimensions: [...array.dimensions],
          data: [...array.data]
        };
      } else {
        arrays[name] = {
          kind: 'string-array',
          dimensions: [...array.dimensions],
          length: array.length,
          data: [...array.data]
        };
      }
    }

    const variables: MonitorRuntimeSnapshot['variables'] = {};
    for (const [name, value] of this.variables.entries()) {
      if (typeof value === 'string') {
        variables[name] = { type: 'string', value };
      } else {
        variables[name] = { type: 'number', value: clampInt(value) };
      }
    }

    return {
      outputQueue: [...this.outputQueue],
      lineBuffer: this.lineBuffer,
      variables,
      arrays,
      program: [...this.program.entries()],
      waitingInput:
        this.pendingInput === null
          ? null
          : {
              variables: this.pendingInput.variables.map((target) =>
                target.kind === 'scalar-target' ? target.name : target.name
              ),
              prompt: this.pendingInput.prompt,
              channel: this.pendingInput.channel
            },
      observationProfileId: this.observationProfileId
    };
  }

  loadSnapshot(snapshot: MonitorRuntimeSnapshot): void {
    this.outputQueue.length = 0;
    this.outputQueue.push(...snapshot.outputQueue.map((v) => v & 0xff));

    this.lineBuffer = snapshot.lineBuffer;
    this.forStack.length = 0;
    this.repeatStack.length = 0;
    this.whileStack.length = 0;
    this.gosubStack.length = 0;
    this.dataPool.length = 0;
    this.dataCursor = 0;
    this.dataLineToCursor.clear();
    this.activeProgram = null;
    this.suspendedProgram = null;
    this.pendingInput = null;

    this.variables.clear();
    for (const [key, value] of Object.entries(snapshot.variables)) {
      if (typeof value === 'number') {
        // 旧フォーマット互換。
        this.variables.set(key, clampInt(value));
      } else if (value.type === 'string') {
        this.variables.set(key, value.value);
      } else {
        this.variables.set(key, clampInt(value.value));
      }
    }

    this.arrays.clear();
    for (const [name, array] of Object.entries(snapshot.arrays ?? {})) {
      if (!array) {
        continue;
      }
      const typed = array as SnapshotArray;
      if (typed.kind === 'string-array') {
        this.arrays.set(name, {
          kind: 'string-array',
          dimensions: [...typed.dimensions],
          length: typed.length,
          data: [...typed.data]
        });
      } else {
        this.arrays.set(name, {
          kind: 'number-array',
          dimensions: [...typed.dimensions],
          data: [...typed.data]
        });
      }
    }

    this.program.clear();
    for (const [line, statement] of snapshot.program) {
      this.program.set(line, statement);
    }

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

  getVariables(): ReadonlyMap<string, ScalarValue> {
    return this.variables;
  }

  getProgramLines(): ReadonlyMap<number, string> {
    return this.program;
  }

  private executeImmediateLine(parsed: ParsedLine): void {
    const state: ExecutionState = {
      mode: 'immediate',
      instructions: [],
      lineToPc: new Map(),
      labelToPc: new Map(),
      pc: -1,
      nextPc: 0
    };

    for (const statement of parsed.statements) {
      if (statement.kind === 'RUN') {
        this.runProgram(10_000, true, statement.target);
        return;
      }

      if (statement.kind === 'CONT') {
        if (!this.resumeStoppedProgram()) {
          throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
        }
        return;
      }

      const result = this.executeStatement(statement, state);
      if (result.stopProgram || result.suspendProgram) {
        return;
      }
    }
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
        this.repeatStack.length = 0;
        this.whileStack.length = 0;
        this.gosubStack.length = 0;
        this.dataPool.length = 0;
        this.dataCursor = 0;
        this.dataLineToCursor.clear();
        this.currentUsingFormat = undefined;
        this.autoLineNext = null;
        this.pushText('OK\r\n');
        return {};
      case 'LIST':
        this.assertMode(state, ['immediate']);
        this.executeList(statement);
        return {};
      case 'RUN':
        this.assertMode(state, ['immediate']);
        this.runProgram(10_000, true, statement.target);
        return { stopProgram: true };
      case 'PRINT':
        this.executePrint(statement, state.mode);
        return {};
      case 'LET': {
        const value = evaluateExpression(statement.expression, this.getEvalContext());
        this.assignTarget(statement.target, value);
        if (state.mode === 'immediate') {
          this.pushText('OK\r\n');
        }
        return {};
      }
      case 'INPUT':
        return this.executeInput(statement, state);
      case 'GOTO': {
        this.assertMode(state, ['program']);
        const targetPc = this.resolveReferencePc(statement.target, state);
        return { jumpToPc: targetPc };
      }
      case 'GOSUB': {
        this.assertMode(state, ['program']);
        const targetPc = this.resolveReferencePc(statement.target, state);
        this.gosubStack.push(state.nextPc);
        return { jumpToPc: targetPc };
      }
      case 'RETURN': {
        this.assertMode(state, ['program']);
        if (statement.target) {
          const targetPc = this.resolveReferencePc(statement.target, state);
          return { jumpToPc: targetPc };
        }

        const resume = this.gosubStack.pop();
        if (resume === undefined) {
          throw new BasicRuntimeError('RETURN_WO_GOSUB', 'RETURN W/O GOSUB');
        }
        return { jumpToPc: resume };
      }
      case 'END':
        this.assertMode(state, ['program']);
        return { stopProgram: true };
      case 'STOP':
        this.assertMode(state, ['program']);
        return { suspendProgram: 'stop', jumpToPc: state.nextPc };
      case 'CONT':
        this.assertMode(state, ['immediate']);
        if (!this.resumeStoppedProgram()) {
          throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
        }
        return { stopProgram: true };
      case 'IF':
        return this.executeIf(statement, state);
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
        this.executeDim(statement);
        return {};
      case 'READ':
        this.executeRead(statement);
        return {};
      case 'RESTORE':
        if (statement.target === undefined) {
          this.dataCursor = 0;
          return {};
        }
        this.dataCursor = this.resolveRestoreCursor(statement.target, state);
        return {};
      case 'POKE': {
        const address = this.evaluateNumeric(statement.address) & 0xffff;
        statement.values.forEach((valueExpr, index) => {
          const value = this.evaluateNumeric(valueExpr) & 0xff;
          this.options.machineAdapter?.poke8?.((address + index) & 0xffff, value);
        });
        return {};
      }
      case 'OUT': {
        const port = statement.port ? this.evaluateNumeric(statement.port) & 0xff : 0x18;
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
        const seconds = 0.125 * (n + 1) * j;
        const sleepMs = Math.trunc(Math.max(1, Math.min(3, seconds)) * 1000);
        this.waitMilliseconds(sleepMs, state.mode);
        return {};
      }
      case 'WAIT': {
        if (!statement.duration) {
          this.printPauseMode = true;
          this.printWaitTicks = 0;
          this.options.machineAdapter?.setPrintWait?.(0, true);
          return {};
        }
        const ticks = this.evaluateNumeric(statement.duration);
        if (ticks < 0 || ticks > 0xffff) {
          throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
        }
        this.printPauseMode = false;
        this.printWaitTicks = ticks;
        this.options.machineAdapter?.setPrintWait?.(ticks, false);
        return {};
      }
      case 'LOCATE': {
        const x = statement.x ? this.evaluateNumeric(statement.x) : 0;
        const y = statement.y ? this.evaluateNumeric(statement.y) : 0;
        if (statement.z) {
          this.evaluateNumeric(statement.z);
        }
        if (x < 0 || x >= 24 || y < 0 || y >= 4) {
          throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
        }
        this.options.machineAdapter?.setTextCursor?.(x, y);
        return {};
      }
      case 'AUTO':
        this.assertMode(state, ['immediate']);
        this.executeAuto(statement);
        return {};
      case 'BLOAD':
        this.executeBload(statement.path, statement.address);
        return {};
      case 'BSAVE':
        this.executeBsave(statement.path, statement.start, statement.end);
        return {};
      case 'FILES': {
        const files = this.options.machineAdapter?.listFiles?.() ?? [];
        const virtualFiles = [...this.virtualBinaryFiles.keys()].map((name) => (name.startsWith('E:') ? name : `E:${name}`));
        const merged = [...files, ...virtualFiles];
        merged.sort((a, b) => a.localeCompare(b));
        for (const file of merged) {
          this.pushText(`${file}\r\n`);
        }
        return {};
      }
      case 'HDCOPY':
        this.executeHdcopy();
        return {};
      case 'PAINT':
        this.executePaint(statement);
        return {};
      case 'CIRCLE':
        this.executeCircle(statement);
        return {};
      case 'PASS': {
        const value = evaluateExpression(statement.value, this.getEvalContext());
        const asText = String(value);
        this.variables.set('PASS$', asText);
        return {};
      }
      case 'PIOSET': {
        const value = this.evaluateNumeric(statement.value) & 0xff;
        this.variables.set('PIOSET', value);
        this.options.machineAdapter?.out8?.(0x30, value);
        return {};
      }
      case 'PIOPUT': {
        const value = this.evaluateNumeric(statement.value) & 0xff;
        this.variables.set('PIOPUT', value);
        this.options.machineAdapter?.out8?.(0x31, value);
        return {};
      }
      case 'SPOUT': {
        const value = this.evaluateNumeric(statement.value) & 0xff;
        this.variables.set('SPOUT', value);
        this.options.machineAdapter?.out8?.(0x32, value);
        return {};
      }
      case 'SPINP':
        this.executeSpinp(statement);
        return {};
      case 'REPEAT':
        this.assertMode(state, ['program']);
        this.repeatStack.push({ repeatPc: state.nextPc });
        return {};
      case 'UNTIL': {
        this.assertMode(state, ['program']);
        if (this.repeatStack.length === 0) {
          throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
        }
        const condition = this.evaluateNumeric(statement.condition);
        if (condition === 0) {
          const frame = this.repeatStack[this.repeatStack.length - 1];
          if (!frame) {
            throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
          }
          return { jumpToPc: frame.repeatPc };
        }
        this.repeatStack.pop();
        return {};
      }
      case 'WHILE':
        this.assertMode(state, ['program']);
        return this.executeWhile(statement, state);
      case 'WEND': {
        this.assertMode(state, ['program']);
        if (this.whileStack.length === 0) {
          throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
        }
        const frame = this.whileStack.pop();
        if (!frame) {
          throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
        }
        return { jumpToPc: frame.whilePc };
      }
      case 'LNINPUT':
        return this.executeLninput(statement, state);
      case 'CLEAR':
        this.variables.clear();
        this.arrays.clear();
        this.dataCursor = 0;
        this.forStack.length = 0;
        this.repeatStack.length = 0;
        this.whileStack.length = 0;
        this.gosubStack.length = 0;
        this.currentUsingFormat = undefined;
        return {};
      case 'DELETE':
        this.executeDelete(statement);
        return {};
      case 'ERASE':
        for (const name of statement.names) {
          this.arrays.delete(name);
        }
        return {};
      case 'ON':
        return this.executeOn(statement, state);
      case 'RANDOMIZE':
        this.variables.set('RANDOM_SEED', Date.now() & 0xffff_ffff);
        return {};
      case 'RENUM':
        this.assertMode(state, ['immediate']);
        this.executeRenum(statement);
        return {};
      case 'USING':
        this.currentUsingFormat = statement.format;
        return {};
      case 'MON':
        return { stopProgram: state.mode === 'program' };
      case 'OPEN':
        this.executeOpen(statement);
        return {};
      case 'CLOSE':
        this.executeClose(statement);
        return {};
      case 'LOAD':
        this.executeLoad(statement.path);
        return {};
      case 'SAVE':
        this.executeSave(statement.path);
        return {};
      case 'LFILES': {
        const files = this.options.machineAdapter?.listFiles?.() ?? [];
        for (const file of files) {
          this.pushText(`${file}\r\n`);
        }
        return {};
      }
      case 'LCOPY': {
        const start = this.evaluateNumeric(statement.start);
        const end = this.evaluateNumeric(statement.end);
        this.evaluateNumeric(statement.to);
        const sorted = [...this.program.entries()].sort((a, b) => a[0] - b[0]);
        for (const [line, body] of sorted) {
          if (line >= start && line <= end) {
            this.options.machineAdapter?.printDeviceWrite?.(`${line} ${body}\r\n`);
          }
        }
        return {};
      }
      case 'KILL': {
        const deleted = this.options.machineAdapter?.deleteFile?.(statement.path);
        if (deleted === false) {
          throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
        }
        return {};
      }
      case 'CALL': {
        const address = this.evaluateNumeric(statement.address) & 0xffff;
        const args = statement.args.map((arg) => this.evaluateNumeric(arg));
        this.options.machineAdapter?.callMachine?.(address, args);
        return {};
      }
      case 'GCURSOR':
        return this.executeGcursor(statement);
      case 'GPRINT':
        return this.executeGprint(statement, state.mode);
      case 'LINE': {
        const x1 = this.evaluateNumeric(statement.x1);
        const y1 = this.evaluateNumeric(statement.y1);
        const x2 = this.evaluateNumeric(statement.x2);
        const y2 = this.evaluateNumeric(statement.y2);
        const mode = statement.mode ? this.evaluateNumeric(statement.mode) : 1;
        const pattern = statement.pattern ? this.evaluateNumeric(statement.pattern) : undefined;
        this.options.machineAdapter?.drawLine?.(x1, y1, x2, y2, mode, pattern);
        return {};
      }
      case 'PSET': {
        const x = this.evaluateNumeric(statement.x);
        const y = this.evaluateNumeric(statement.y);
        const mode = statement.mode ? this.evaluateNumeric(statement.mode) : 1;
        this.options.machineAdapter?.drawPoint?.(x, y, mode);
        return {};
      }
      case 'PRESET': {
        const x = this.evaluateNumeric(statement.x);
        const y = this.evaluateNumeric(statement.y);
        this.options.machineAdapter?.drawPoint?.(x, y, 0);
        return {};
      }
      case 'ELSE':
        return {};
      default:
        throw new BasicRuntimeError('BAD_STMT', `BAD STMT: ${(statement as StatementNode).kind}`);
    }
  }

  private executeGcursor(statement: GcursorStatement): StatementExecutionResult {
    const x = this.evaluateNumeric(statement.x);
    const y = this.evaluateNumeric(statement.y);
    this.graphicCursorX = x;
    this.graphicCursorY = y;
    this.options.machineAdapter?.setGraphicCursor?.(x, y);
    return {};
  }

  private executeGprint(statement: GprintStatement, mode: 'immediate' | 'program'): StatementExecutionResult {
    const payload = evaluatePrintItems(statement.items as PrintStatement['items'], this.getEvalContext());
    this.options.machineAdapter?.printGraphicText?.(payload.text);
    if (!payload.suppressNewline) {
      this.graphicCursorY += 8;
      this.options.machineAdapter?.setGraphicCursor?.(this.graphicCursorX, this.graphicCursorY);
    }
    this.applyPrintWait(mode);
    return {};
  }

  private executeAuto(statement: { start?: ExpressionNode; step?: ExpressionNode }): void {
    const start = statement.start ? this.evaluateNumeric(statement.start) : 10;
    const step = statement.step ? this.evaluateNumeric(statement.step) : 10;
    if (start <= 0 || step <= 0) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }
    this.autoLineNext = start;
    this.autoLineStep = step;
  }

  private executeBload(path: string, addressExpr?: ExpressionNode): void {
    const openFile = this.options.machineAdapter?.openFile;
    const readFileValue = this.options.machineAdapter?.readFileValue;
    const closeFile = this.options.machineAdapter?.closeFile;
    let address = addressExpr ? this.evaluateNumeric(addressExpr) & 0xffff : 0;

    if (!openFile || !readFileValue) {
      const virtual = this.virtualBinaryFiles.get(path) ?? this.virtualBinaryFiles.get(path.startsWith('E:') ? path.slice(2) : path);
      if (!virtual) {
        throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
      }
      for (const byte of virtual) {
        this.options.machineAdapter?.poke8?.(address & 0xffff, byte & 0xff);
        address += 1;
      }
      return;
    }

    const handle = openFile(path, 'INPUT');
    try {
      while (true) {
        const value = readFileValue(handle);
        if (value === null) {
          break;
        }
        const byte = typeof value === 'number' ? value : parseIntSafe(String(value));
        this.options.machineAdapter?.poke8?.(address & 0xffff, byte & 0xff);
        address += 1;
      }
    } finally {
      closeFile?.(handle);
    }
  }

  private executeBsave(path: string, startExpr: ExpressionNode, endExpr: ExpressionNode): void {
    const openFile = this.options.machineAdapter?.openFile;
    const writeFileValue = this.options.machineAdapter?.writeFileValue;
    const closeFile = this.options.machineAdapter?.closeFile;

    const start = this.evaluateNumeric(startExpr) & 0xffff;
    const end = this.evaluateNumeric(endExpr) & 0xffff;
    if (start > end) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    if (!openFile || !writeFileValue) {
      const bytes: number[] = [];
      for (let addr = start; addr <= end; addr += 1) {
        const value = this.options.machineAdapter?.peek8?.(addr) ?? 0xff;
        bytes.push(value & 0xff);
      }
      this.virtualBinaryFiles.set(path.startsWith('E:') ? path.slice(2) : path, bytes);
      return;
    }

    const handle = openFile(path, 'OUTPUT');
    try {
      for (let addr = start; addr <= end; addr += 1) {
        const value = this.options.machineAdapter?.peek8?.(addr) ?? 0xff;
        writeFileValue(handle, value & 0xff);
      }
    } finally {
      closeFile?.(handle);
    }
  }

  private executeHdcopy(): void {
    this.options.machineAdapter?.printDeviceWrite?.('[HDCOPY]\r\n');
  }

  private executePaint(statement: PaintStatement): void {
    const x = this.evaluateNumeric(statement.x);
    const y = this.evaluateNumeric(statement.y);
    const pattern = this.evaluateNumeric(statement.pattern);
    this.options.machineAdapter?.paintArea?.(x, y, pattern);
    if (!this.options.machineAdapter?.paintArea) {
      this.options.machineAdapter?.drawPoint?.(x, y, pattern === 0 ? 0 : 1);
    }
  }

  private executeCircle(statement: CircleStatement): void {
    const cx = this.evaluateNumeric(statement.x);
    const cy = this.evaluateNumeric(statement.y);
    const radius = this.evaluateNumeric(statement.radius);
    const mode = statement.mode ? this.evaluateNumeric(statement.mode) : 1;
    const pattern = statement.pattern ? this.evaluateNumeric(statement.pattern) : 6;

    if (radius <= 0) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    const shouldPlot = (index: number): boolean => {
      if (pattern <= 1 || pattern >= 6) {
        return true;
      }
      return index % pattern === 0;
    };

    let x = radius;
    let y = 0;
    let err = 1 - radius;
    let pointIndex = 0;

    while (x >= y) {
      const candidates: Array<[number, number]> = [
        [cx + x, cy + y],
        [cx + y, cy + x],
        [cx - y, cy + x],
        [cx - x, cy + y],
        [cx - x, cy - y],
        [cx - y, cy - x],
        [cx + y, cy - x],
        [cx + x, cy - y]
      ];

      for (const [px, py] of candidates) {
        if (shouldPlot(pointIndex)) {
          this.options.machineAdapter?.drawPoint?.(px, py, mode);
        }
        pointIndex += 1;
      }

      y += 1;
      if (err < 0) {
        err += 2 * y + 1;
      } else {
        x -= 1;
        err += 2 * (y - x) + 1;
      }
    }
  }

  private executeSpinp(statement: SpinpStatement): void {
    const value = (this.options.machineAdapter?.in8?.(0x32) ?? 0xff) & 0xff;
    if (statement.target) {
      this.assignTarget(statement.target, value);
      return;
    }
    this.variables.set('SPINP', value);
  }

  private executeWhile(
    statement: { condition: ExpressionNode },
    state: Pick<ExecutionState, 'instructions' | 'pc'>
  ): StatementExecutionResult {
    const condition = this.evaluateNumeric(statement.condition);
    if (condition !== 0) {
      this.whileStack.push({ whilePc: state.pc });
      return {};
    }

    const wendPc = this.findMatchingWend(state.instructions, state.pc + 1);
    return { jumpToPc: wendPc + 1 };
  }

  private findMatchingWend(instructions: ProgramInstruction[], startPc: number): number {
    let depth = 0;
    for (let index = startPc; index < instructions.length; index += 1) {
      const instruction = instructions[index];
      if (!instruction) {
        break;
      }

      if (instruction.statement.kind === 'WHILE') {
        depth += 1;
        continue;
      }

      if (instruction.statement.kind === 'WEND') {
        if (depth === 0) {
          return index;
        }
        depth -= 1;
      }
    }

    throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
  }

  private executeLninput(statement: LninputStatement, state: ExecutionState): StatementExecutionResult {
    if (statement.channel) {
      const basicHandle = this.evaluateNumeric(statement.channel);
      const adapterHandle = this.openFileHandles.get(basicHandle) ?? basicHandle;
      const value = this.options.machineAdapter?.readFileValue?.(adapterHandle);
      if (value === null || value === undefined) {
        this.assignTarget(statement.variable, '');
      } else {
        this.assignTarget(statement.variable, String(value));
      }
      return {};
    }

    this.pendingInput = {
      variables: [statement.variable],
      prompt: statement.prompt ?? '?',
      mode: state.mode,
      rawLine: true
    };
    this.pushText(`${this.pendingInput.prompt} `);

    if (state.mode === 'program') {
      return {
        suspendProgram: 'input',
        jumpToPc: state.nextPc
      };
    }

    return {};
  }

  private executeIf(statement: IfStatement, state: ExecutionState): StatementExecutionResult {
    const cond = this.evaluateNumeric(statement.condition);
    const branch = cond !== 0 ? statement.thenBranch : statement.elseBranch;
    if (!branch || branch.length === 0) {
      return {};
    }

    for (const child of branch) {
      const result = this.executeStatement(child, state);
      if (result.jumpToPc !== undefined || result.stopProgram || result.suspendProgram) {
        return result;
      }
    }

    return {};
  }

  private executeFor(statement: ForStatement, state: ExecutionState): StatementExecutionResult {
    const startValue = this.evaluateNumeric(statement.start);
    const endValue = this.evaluateNumeric(statement.end);
    const stepValue = statement.step ? this.evaluateNumeric(statement.step) : 1;

    this.variables.set(statement.variable, startValue);
    this.forStack.push({
      variable: statement.variable,
      forPc: state.pc,
      endValue,
      stepValue
    });

    return {};
  }

  private executeNext(statement: NextStatement): StatementExecutionResult {
    if (this.forStack.length === 0) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    let frameIndex = this.forStack.length - 1;
    if (statement.variable) {
      while (frameIndex >= 0) {
        const frame = this.forStack[frameIndex];
        if (frame?.variable === statement.variable) {
          break;
        }
        frameIndex -= 1;
      }

      if (frameIndex < 0) {
        throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
      }

      this.forStack.splice(frameIndex + 1);
    }

    const frame = this.forStack[frameIndex];
    if (!frame) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    const currentRaw = this.variables.get(frame.variable);
    const current = typeof currentRaw === 'number' ? currentRaw : 0;
    const nextValue = clampInt(current + frame.stepValue);
    this.variables.set(frame.variable, nextValue);

    const shouldContinue =
      frame.stepValue > 0
        ? nextValue <= frame.endValue
        : frame.stepValue < 0
          ? nextValue >= frame.endValue
          : nextValue === frame.endValue;

    if (shouldContinue) {
      return { jumpToPc: frame.forPc + 1 };
    }

    this.forStack.splice(frameIndex, 1);
    return {};
  }

  private executeDim(statement: DimStatement): void {
    for (const decl of statement.declarations) {
      const dimensions = decl.dimensions.map((expr) => this.evaluateNumeric(expr));
      const stringLength = decl.stringLength ? this.evaluateNumeric(decl.stringLength) : undefined;
      this.defineArray(decl.name, dimensions, stringLength);
    }
  }

  private executeRead(statement: { targets: AssignmentTarget[] }): void {
    for (const target of statement.targets) {
      if (this.dataCursor >= this.dataPool.length) {
        throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
      }
      const value = this.dataPool[this.dataCursor] ?? 0;
      this.dataCursor += 1;
      this.assignTarget(target, value);
    }
  }

  private executeDelete(statement: DeleteStatement): void {
    const start = statement.start ?? 1;
    const end = statement.end ?? (statement.start ?? 0xff00);
    if (start > end) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    for (const line of [...this.program.keys()]) {
      if (line >= start && line <= end) {
        this.program.delete(line);
      }
    }
  }

  private executeOn(statement: OnStatement, state: ExecutionState): StatementExecutionResult {
    const selector = this.evaluateNumeric(statement.selector);
    if (selector <= 0 || selector > statement.targets.length) {
      return {};
    }

    const target = statement.targets[selector - 1];
    if (!target) {
      return {};
    }

    const jumpToPc = this.resolveReferencePc(target, state);
    if (statement.mode === 'GOSUB') {
      this.gosubStack.push(state.nextPc);
    }

    return { jumpToPc };
  }

  private executeRenum(statement: RenumStatement): void {
    const newStart = statement.start ? this.evaluateNumeric(statement.start) : 10;
    const from = statement.from ? this.evaluateNumeric(statement.from) : 0;
    const step = statement.step ? this.evaluateNumeric(statement.step) : 10;

    if (step <= 0) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    const sorted = [...this.program.entries()].sort((a, b) => a[0] - b[0]);
    const mapping = new Map<number, number>();

    let nextLine = newStart;
    for (const [line] of sorted) {
      if (line < from) {
        continue;
      }
      mapping.set(line, nextLine);
      nextLine += step;
    }

    const rewritten = new Map<number, string>();
    for (const [line, source] of sorted) {
      const mappedLine = mapping.get(line) ?? line;
      rewritten.set(mappedLine, updateNumericReferences(source, mapping));
    }

    this.program.clear();
    for (const [line, source] of rewritten.entries()) {
      this.program.set(line, source);
    }
  }

  private executeOpen(statement: {
    path: string;
    mode?: 'INPUT' | 'OUTPUT' | 'APPEND';
    handle?: ExpressionNode;
  }): void {
    const basicHandle = statement.handle ? this.evaluateNumeric(statement.handle) : 1;
    const mode = statement.mode ?? 'INPUT';
    const adapterHandle = this.options.machineAdapter?.openFile?.(statement.path, mode);
    if (adapterHandle === undefined) {
      this.openFileHandles.set(basicHandle, basicHandle);
      return;
    }
    this.openFileHandles.set(basicHandle, adapterHandle);
  }

  private executeClose(statement: { handles: ExpressionNode[] }): void {
    for (const handleExpr of statement.handles) {
      const basicHandle = this.evaluateNumeric(handleExpr);
      const adapterHandle = this.openFileHandles.get(basicHandle) ?? basicHandle;
      this.options.machineAdapter?.closeFile?.(adapterHandle);
      this.openFileHandles.delete(basicHandle);
    }
  }

  private executeLoad(path: string): void {
    const openFile = this.options.machineAdapter?.openFile;
    const readFileValue = this.options.machineAdapter?.readFileValue;
    const closeFile = this.options.machineAdapter?.closeFile;

    if (!openFile || !readFileValue) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    const handle = openFile(path, 'INPUT');
    try {
      this.program.clear();

      while (true) {
        const value = readFileValue(handle);
        if (value === null) {
          break;
        }
        const line = String(value);
        const match = line.match(/^(\d+)\s*(.*)$/);
        if (!match) {
          continue;
        }
        const lineNumber = parseIntSafe(match[1] ?? '0');
        const source = normalizeProgramLine(match[2] ?? '');
        if (source.length > 0) {
          parseStatements(source);
          this.program.set(lineNumber, source);
        }
      }
    } finally {
      closeFile?.(handle);
    }
  }

  private executeSave(path: string): void {
    const openFile = this.options.machineAdapter?.openFile;
    const writeFileValue = this.options.machineAdapter?.writeFileValue;
    const closeFile = this.options.machineAdapter?.closeFile;

    if (!openFile || !writeFileValue) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    const handle = openFile(path, 'OUTPUT');
    try {
      for (const [line, source] of [...this.program.entries()].sort((a, b) => a[0] - b[0])) {
        writeFileValue(handle, `${line} ${source}`);
      }
    } finally {
      closeFile?.(handle);
    }
  }

  private executePrint(statement: PrintStatement, mode: 'immediate' | 'program'): void {
    const payload = evaluatePrintItems(statement.items, this.getEvalContext(), statement.usingFormat ?? this.currentUsingFormat);
    const text = payload.text;

    if (statement.channel) {
      const handle = this.evaluateNumeric(statement.channel);
      const adapterHandle = this.openFileHandles.get(handle) ?? handle;
      this.options.machineAdapter?.writeFileValue?.(adapterHandle, payload.suppressNewline ? text : `${text}\n`);
    } else if (statement.printer) {
      this.options.machineAdapter?.printDeviceWrite?.(payload.suppressNewline ? text : `${text}\r\n`);
    } else {
      this.pushText(text);
      if (!payload.suppressNewline) {
        this.pushText('\r\n');
      }
    }

    this.applyPrintWait(mode);
  }

  private applyPrintWait(mode: 'immediate' | 'program'): void {
    if (this.printPauseMode) {
      this.options.machineAdapter?.waitForEnterKey?.();
      return;
    }

    if (this.printWaitTicks > 0) {
      const delayMs = Math.max(1, Math.trunc((this.printWaitTicks * 1000) / 64));
      this.waitMilliseconds(delayMs, mode);
    }
  }

  private executeInput(statement: InputStatement, state: ExecutionState): StatementExecutionResult {
    if (statement.channel) {
      const basicHandle = this.evaluateNumeric(statement.channel);
      const adapterHandle = this.openFileHandles.get(basicHandle) ?? basicHandle;
      for (const variable of statement.variables) {
        const value = this.options.machineAdapter?.readFileValue?.(adapterHandle);
        if (value === null || value === undefined) {
          this.assignTarget(variable, variable.kind === 'scalar-target' && isStringName(variable.name) ? '' : 0);
        } else {
          this.assignTarget(variable, value);
        }
      }
      return {};
    }

    const prompt = statement.prompt ? `${statement.prompt}` : '?';
    this.pendingInput = {
      variables: statement.variables,
      prompt,
      mode: state.mode
    };
    this.pushText(`${prompt} `);

    if (state.mode === 'program') {
      return {
        suspendProgram: 'input',
        jumpToPc: state.nextPc
      };
    }

    return {};
  }

  private consumePendingInput(line: string): void {
    const pending = this.pendingInput;
    if (!pending) {
      return;
    }

    const values = pending.rawLine ? [line] : splitInputValues(line);

    pending.variables.forEach((target, index) => {
      const raw = values[index] ?? '';

      if (target.kind === 'scalar-target' && isStringName(target.name)) {
        this.assignTarget(target, raw);
        return;
      }

      if (target.kind === 'array-element-target' && isStringName(target.name)) {
        this.assignTarget(target, raw);
        return;
      }

      this.assignTarget(target, parseIntSafe(raw));
    });

    this.pendingInput = null;

    if (this.suspendedProgram?.reason === 'input') {
      this.activeProgram = this.suspendedProgram.state;
      this.suspendedProgram = null;
      this.pump(Date.now());
      return;
    }

    this.pushPrompt();
  }

  private resolveReferencePc(
    target: LineReference,
    state: Pick<ExecutionState, 'lineToPc' | 'labelToPc'>
  ): number {
    if (target.kind === 'line-reference-number') {
      const pc = state.lineToPc.get(target.line);
      if (pc === undefined) {
        missingLine(target);
      }
      return pc;
    }

    const pc = state.labelToPc.get(target.label);
    if (pc === undefined) {
      missingLine(target);
    }
    return pc;
  }

  private executeList(statement: ListStatement): void {
    const entries = this.getSortedProgramEntries();
    let startLine: number | undefined;

    if (statement.target) {
      if (statement.target.kind === 'line-reference-number') {
        startLine = statement.target.line;
      } else {
        const targetLabel = statement.target.label;
        const found = entries.find((entry) => entry.parsed.label === targetLabel);
        if (!found) {
          missingLine(statement.target);
        }
        startLine = found.line;
      }
    }

    for (const entry of entries) {
      if (startLine !== undefined && entry.line < startLine) {
        continue;
      }
      const row = `${entry.line} ${entry.source}\r\n`;
      if (statement.printer) {
        this.options.machineAdapter?.printDeviceWrite?.(row);
      } else {
        this.pushText(row);
      }
    }
  }

  private resumeStoppedProgram(): boolean {
    if (!this.suspendedProgram || this.suspendedProgram.reason !== 'stop') {
      return false;
    }

    this.activeProgram = this.suspendedProgram.state;
    this.suspendedProgram = null;
    this.activeProgramWakeAtMs = 0;
    this.pump(Date.now());
    return true;
  }

  private getSortedProgramEntries(): ProgramEntry[] {
    return [...this.program.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([line, source]) => ({ line, source, parsed: parseStatements(source) }));
  }

  private buildDataPool(entries: ProgramEntry[]): void {
    this.dataPool.length = 0;
    this.dataLineToCursor.clear();

    for (const entry of entries) {
      for (const statement of entry.parsed.statements) {
        if (statement.kind !== 'DATA') {
          continue;
        }
        this.collectData(entry.line, statement);
      }
    }
  }

  private collectData(line: number, statement: DataStatement): void {
    if (!this.dataLineToCursor.has(line)) {
      this.dataLineToCursor.set(line, this.dataPool.length);
    }

    for (const item of statement.items) {
      this.dataPool.push(evaluateExpression(item, this.getEvalContext()));
    }
  }

  private resolveRestoreCursor(target: LineReference, state: ExecutionState): number {
    let targetLine: number;

    if (target.kind === 'line-reference-number') {
      targetLine = target.line;
      if (state.mode === 'program') {
        if (!state.lineToPc.has(targetLine)) {
          missingLine(target);
        }
      } else if (!this.program.has(targetLine)) {
        missingLine(target);
      }
    } else {
      const entries = this.getSortedProgramEntries();
      const found = entries.find((entry) => entry.parsed.label === target.label);
      if (!found) {
        missingLine(target);
      }
      targetLine = found.line;
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

  private defineArray(name: string, dimensions: number[], stringLength?: number): void {
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

    if (isStringName(name)) {
      const length = Math.max(0, clampInt(stringLength ?? 16));
      this.arrays.set(name, {
        kind: 'string-array',
        dimensions: normalized,
        length,
        data: new Array(size).fill('')
      });
      return;
    }

    this.arrays.set(name, {
      kind: 'number-array',
      dimensions: normalized,
      data: new Array(size).fill(0)
    });
  }

  private assignTarget(target: AssignmentTarget, value: ScalarValue): void {
    if (target.kind === 'scalar-target') {
      if (isStringName(target.name)) {
        this.variables.set(target.name, String(value));
        return;
      }
      if (typeof value === 'string') {
        throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
      }
      this.variables.set(target.name, clampInt(value));
      return;
    }

    const array = this.arrays.get(target.name);
    if (!array) {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    const indices = target.indices.map((index) => this.evaluateNumeric(index));
    const offset = this.toArrayOffset(array, indices);

    if (array.kind === 'string-array') {
      const raw = String(value);
      array.data[offset] = raw.slice(0, array.length);
      return;
    }

    if (typeof value === 'string') {
      throw new BasicRuntimeError('SYNTAX', 'SYNTAX');
    }

    array.data[offset] = clampInt(value);
  }

  private readArray(name: string, indices: number[]): ScalarValue {
    const array = this.arrays.get(name);
    if (!array) {
      return isStringName(name) ? '' : 0;
    }

    const offset = this.toArrayOffset(array, indices);
    if (array.kind === 'string-array') {
      return array.data[offset] ?? '';
    }
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
    this.suspendedProgram = null;
    this.activeProgramWakeAtMs = 0;
    this.pushText('OK\r\n');
    if (promptOnComplete) {
      this.pushPrompt();
    }
  }

  private finishProgramWithError(error: unknown): void {
    const promptOnComplete = this.activeProgram?.promptOnComplete ?? false;
    this.activeProgram = null;
    this.suspendedProgram = null;
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
