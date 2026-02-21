export type OpcodeSpace = 'base' | 'cb' | 'ed' | 'dd' | 'fd' | 'ddcb' | 'fdcb';

// Phase 1: opcode 空間ごとに「timing 定義が存在するか」を固定するレジストリ。
// 詳細な M/T ステート列は次段で各 opcode 個別定義へ置換する。
const FULLY_DEFINED_SPACE = Object.freeze(Array.from({ length: 0x100 }, (_v, opcode) => opcode));

export const Z80_TIMING_DEFINITION_TABLE: Readonly<Record<OpcodeSpace, readonly number[]>> = Object.freeze({
  base: FULLY_DEFINED_SPACE,
  cb: FULLY_DEFINED_SPACE,
  ed: FULLY_DEFINED_SPACE,
  dd: FULLY_DEFINED_SPACE,
  fd: FULLY_DEFINED_SPACE,
  ddcb: FULLY_DEFINED_SPACE,
  fdcb: FULLY_DEFINED_SPACE
});

export function hasTimingDefinition(space: OpcodeSpace, opcode: number): boolean {
  const clamped = opcode & 0xff;
  return Z80_TIMING_DEFINITION_TABLE[space].includes(clamped);
}
