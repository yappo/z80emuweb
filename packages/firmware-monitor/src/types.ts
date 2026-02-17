// 仕様確度と実装ステータスは、互換度レポートでそのまま表示する。
export type EvidenceConfidence = 'CONFIRMED' | 'DERIVED' | 'HYPOTHESIS';
export type CommandStatus = 'LOCKED' | 'TBD';

export type ScalarValue = number | string;

export interface SnapshotScalarValueNumber {
  type: 'number';
  value: number;
}

export interface SnapshotScalarValueString {
  type: 'string';
  value: string;
}

export type SnapshotScalarValue = SnapshotScalarValueNumber | SnapshotScalarValueString;

export interface SnapshotNumberArray {
  kind: 'number-array';
  dimensions: number[];
  data: number[];
}

export interface SnapshotStringArray {
  kind: 'string-array';
  dimensions: number[];
  length: number;
  data: string[];
}

export type SnapshotArray = SnapshotNumberArray | SnapshotStringArray;

// エミュレータ本体に依存しすぎない最小限の機械アダプタ。
export interface BasicMachineAdapter {
  clearLcd?(): void;
  writeLcdChar?(charCode: number): void;
  setDisplayStartLine?(line: number): void;
  getDisplayStartLine?(): number;
  setTextCursor?(col: number, row: number): void;
  readKeyMatrix?(row: number): number;
  in8?(port: number): number;
  out8?(port: number, value: number): void;
  peek8?(address: number): number;
  poke8?(address: number, value: number): void;
  sleepMs?(ms: number): void;

  waitForEnterKey?(): void;
  setPrintWait?(ticks: number, pauseMode: boolean): void;

  openFile?(path: string, mode: 'INPUT' | 'OUTPUT' | 'APPEND'): number;
  closeFile?(handle: number): void;
  readFileValue?(handle: number): ScalarValue | null;
  writeFileValue?(handle: number, value: ScalarValue): void;
  listFiles?(): string[];
  deleteFile?(path: string): boolean;

  printDeviceWrite?(text: string): void;

  callMachine?(address: number, args: number[]): number | void;

  setGraphicCursor?(x: number, y: number): void;
  drawLine?(x1: number, y1: number, x2: number, y2: number, mode?: number, pattern?: number): void;
  drawPoint?(x: number, y: number, mode?: number): void;
  paintArea?(x: number, y: number, pattern?: number): void;
  printGraphicText?(text: string): void;
  readInkey?(): string | null;
}

// 互換確認向けの観測ケース定義。
export interface BasicObservationCase {
  id: string;
  profile: string;
  commands: string[];
  lines: string[];
  expect: {
    outputContains?: string[];
    outputNotContains?: string[];
    errorContains?: string[];
    errorCodeContains?: string[];
    variables?: Record<string, ScalarValue>;
  };
}

// BASIC コマンドの対応状況メタデータ。
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

// 現在ロード中プロファイルでの互換レポート。
export interface CompatibilityReport {
  profileId: string;
  totalCommands: number;
  lockedCommands: number;
  implementedCommands: number;
  lockedUnimplemented: string[];
  tbdCommands: string[];
}

// ランタイム保存用スナップショット。
export interface MonitorRuntimeSnapshot {
  outputQueue: number[];
  lineBuffer: string;
  variables: Record<string, SnapshotScalarValue>;
  arrays?: Record<string, SnapshotArray>;
  program: Array<[number, string]>;
  waitingInput?: {
    variables: string[];
    prompt?: string;
    channel?: number;
  } | null;
  observationProfileId?: string;
}

// ランタイム起動オプション。
export interface RuntimeOptions {
  machineAdapter?: BasicMachineAdapter;
  commandSpecs?: BasicCommandSpec[];
  defaultProfileId?: string;
}
