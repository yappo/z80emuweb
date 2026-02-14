// 仕様確度と実装ステータスは、互換度レポートでそのまま表示する。
export type EvidenceConfidence = 'CONFIRMED' | 'DERIVED' | 'HYPOTHESIS';
export type CommandStatus = 'LOCKED' | 'TBD';

// エミュレータ本体に依存しすぎない最小限の機械アダプタ。
export interface BasicMachineAdapter {
  clearLcd?(): void;
  writeLcdChar?(charCode: number): void;
  setDisplayStartLine?(line: number): void;
  getDisplayStartLine?(): number;
  readKeyMatrix?(row: number): number;
  in8?(port: number): number;
  out8?(port: number, value: number): void;
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
    variables?: Record<string, number>;
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
  variables: Record<string, number>;
  program: Array<[number, string]>;
  waitingInputVar: string | null;
  observationProfileId?: string;
}

// ランタイム起動オプション。
export interface RuntimeOptions {
  machineAdapter?: BasicMachineAdapter;
  commandSpecs?: BasicCommandSpec[];
  defaultProfileId?: string;
}
