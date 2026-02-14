import { BUILTIN_COMMAND_SPECS, executeRegisteredStatement } from './command-registry';
import type { StatementNode } from './ast';
import { asDisplayError, BasicRuntimeError } from './errors';
import { parseStatement } from './parser';
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

export class PcG815BasicRuntime {
  private readonly outputQueue: number[] = [];

  private readonly variables = new Map<string, number>();

  private readonly program = new Map<number, string>();

  private readonly commandSpecs: BasicCommandSpec[];

  private lineBuffer = '';

  private waitingInputVar: string | null = null;

  private observationProfileId: string;

  constructor(private readonly options: RuntimeOptions = {}) {
    this.commandSpecs = [...(options.commandSpecs ?? BUILTIN_COMMAND_SPECS)];
    this.observationProfileId = options.defaultProfileId ?? 'public-observed-v1';
  }

  reset(cold = false): void {
    this.outputQueue.length = 0;
    this.lineBuffer = '';
    this.waitingInputVar = null;
    if (cold) {
      this.variables.clear();
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
    const rawLine = input;
    const line = rawLine.trim();

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
        this.pushText('ERR BAD LINE\r\n');
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

    if (this.waitingInputVar === null) {
      this.pushPrompt();
    }
  }

  runProgram(maxSteps = 10_000): void {
    const lines = [...this.program.entries()].sort((a, b) => a[0] - b[0]);
    const lineToIndex = new Map<number, number>();
    lines.forEach(([line], index) => lineToIndex.set(line, index));

    const gosubStack: number[] = [];
    let pc = 0;
    let steps = 0;

    while (pc < lines.length) {
      steps += 1;
      if (steps > maxSteps) {
        throw new BasicRuntimeError('RUNAWAY', 'RUNAWAY');
      }

      const entry = lines[pc];
      if (!entry) {
        break;
      }

      const [, source] = entry;
      const statement = parseStatement(source);
      const result = executeRegisteredStatement(statement, {
        mode: 'program',
        variables: this.variables,
        program: this.program,
        machineAdapter: this.options.machineAdapter,
        lineToIndex,
        gosubStack,
        nextPc: pc + 1,
        pushText: (text: string) => this.pushText(text),
        setWaitingInput: () => {
          throw new BasicRuntimeError('INPUT_IN_RUN', 'INPUT IN RUN');
        }
      });

      if (result.stopProgram) {
        break;
      }

      pc = result.jumpToIndex ?? pc + 1;
    }

    this.pushText('OK\r\n');
  }

  popOutputChar(): number {
    return this.outputQueue.shift() ?? 0;
  }

  getSnapshot(): MonitorRuntimeSnapshot {
    return {
      outputQueue: [...this.outputQueue],
      lineBuffer: this.lineBuffer,
      variables: Object.fromEntries(this.variables.entries()),
      program: [...this.program.entries()],
      waitingInputVar: this.waitingInputVar,
      observationProfileId: this.observationProfileId
    };
  }

  loadSnapshot(snapshot: MonitorRuntimeSnapshot): void {
    this.outputQueue.length = 0;
    this.outputQueue.push(...snapshot.outputQueue.map((v) => v & 0xff));

    this.lineBuffer = snapshot.lineBuffer;

    this.variables.clear();
    for (const [key, value] of Object.entries(snapshot.variables)) {
      this.variables.set(key, value);
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
      this.runProgram();
      return;
    }

    executeRegisteredStatement(statement, {
      mode: 'immediate',
      variables: this.variables,
      program: this.program,
      machineAdapter: this.options.machineAdapter,
      lineToIndex: new Map(),
      gosubStack: [],
      nextPc: 0,
      pushText: (text: string) => this.pushText(text),
      setWaitingInput: (variable: string) => {
        this.waitingInputVar = variable;
      }
    });
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
