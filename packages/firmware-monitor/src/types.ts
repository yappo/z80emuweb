export type EvidenceConfidence = 'CONFIRMED' | 'DERIVED' | 'HYPOTHESIS';
export type CommandStatus = 'LOCKED' | 'TBD';

export interface BasicMachineAdapter {
  clearLcd?(): void;
  writeLcdChar?(charCode: number): void;
  setDisplayStartLine?(line: number): void;
  getDisplayStartLine?(): number;
  readKeyMatrix?(row: number): number;
  in8?(port: number): number;
  out8?(port: number, value: number): void;
}

export interface BasicObservationCase {
  id: string;
  profile: string;
  commands: string[];
  lines: string[];
  expect: {
    outputContains?: string[];
    outputNotContains?: string[];
    errorContains?: string[];
    variables?: Record<string, number>;
  };
}

export interface BasicCommandSpec {
  id: string;
  keyword: string;
  category: string;
  status: CommandStatus;
  confidence: EvidenceConfidence;
  implemented: boolean;
  evidence: string[];
  positiveCaseIds: string[];
  negativeCaseIds: string[];
  notes: string;
}

export interface CompatibilityReport {
  profileId: string;
  totalCommands: number;
  lockedCommands: number;
  implementedCommands: number;
  lockedUnimplemented: string[];
  tbdCommands: string[];
}

export interface MonitorRuntimeSnapshot {
  outputQueue: number[];
  lineBuffer: string;
  variables: Record<string, number>;
  program: Array<[number, string]>;
  waitingInputVar: string | null;
  observationProfileId?: string;
}

export interface RuntimeOptions {
  machineAdapter?: BasicMachineAdapter;
  commandSpecs?: BasicCommandSpec[];
  defaultProfileId?: string;
}
