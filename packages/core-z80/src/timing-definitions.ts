export type OpcodeSpace = 'base' | 'cb' | 'ed' | 'dd' | 'fd' | 'ddcb' | 'fdcb';

export type BusCycleKind = 'fetchOpcode' | 'intAck' | 'memRead' | 'memWrite' | 'ioRead' | 'ioWrite' | 'haltFetch';

export interface BusCycleTimingTemplate {
  tStates: number;
  waitSamplePhases: readonly number[];
  idleTailTStates: number;
}

export interface OpcodeTimingDefinition {
  space: OpcodeSpace;
  opcode: number;
  mnemonicTag: string;
  cycles: Readonly<Record<BusCycleKind, BusCycleTimingTemplate>>;
}

const READ_CYCLE_TEMPLATE: BusCycleTimingTemplate = Object.freeze({
  tStates: 3,
  waitSamplePhases: Object.freeze([2]),
  idleTailTStates: 0
});

const WRITE_CYCLE_TEMPLATE: BusCycleTimingTemplate = Object.freeze({
  tStates: 3,
  waitSamplePhases: Object.freeze([2]),
  idleTailTStates: 0
});

const IO_READ_CYCLE_TEMPLATE: BusCycleTimingTemplate = Object.freeze({
  tStates: 3,
  waitSamplePhases: Object.freeze([2]),
  idleTailTStates: 1
});

const IO_WRITE_CYCLE_TEMPLATE: BusCycleTimingTemplate = Object.freeze({
  tStates: 3,
  waitSamplePhases: Object.freeze([2]),
  idleTailTStates: 1
});

const FETCH_CYCLE_TEMPLATE: BusCycleTimingTemplate = Object.freeze({
  tStates: 5,
  waitSamplePhases: Object.freeze([2]),
  idleTailTStates: 0
});

const INT_ACK_CYCLE_TEMPLATE: BusCycleTimingTemplate = Object.freeze({
  tStates: 4,
  waitSamplePhases: Object.freeze([2]),
  idleTailTStates: 0
});

const HALT_FETCH_CYCLE_TEMPLATE: BusCycleTimingTemplate = Object.freeze({
  tStates: 5,
  waitSamplePhases: Object.freeze([2]),
  idleTailTStates: 0
});

const DEFAULT_CYCLE_SET: Readonly<Record<BusCycleKind, BusCycleTimingTemplate>> = Object.freeze({
  fetchOpcode: FETCH_CYCLE_TEMPLATE,
  intAck: INT_ACK_CYCLE_TEMPLATE,
  memRead: READ_CYCLE_TEMPLATE,
  memWrite: WRITE_CYCLE_TEMPLATE,
  ioRead: IO_READ_CYCLE_TEMPLATE,
  ioWrite: IO_WRITE_CYCLE_TEMPLATE,
  haltFetch: HALT_FETCH_CYCLE_TEMPLATE
});

function makeMnemonicTag(space: OpcodeSpace, opcode: number): string {
  return `${space.toUpperCase()}_${opcode.toString(16).padStart(2, '0').toUpperCase()}`;
}

function buildSpaceDefinitions(space: OpcodeSpace): readonly OpcodeTimingDefinition[] {
  return Object.freeze(
    Array.from({ length: 0x100 }, (_unused, opcode) =>
      Object.freeze({
        space,
        opcode,
        mnemonicTag: makeMnemonicTag(space, opcode),
        cycles: DEFAULT_CYCLE_SET
      })
    )
  );
}

export const Z80_TIMING_DEFINITION_TABLE: Readonly<Record<OpcodeSpace, readonly OpcodeTimingDefinition[]>> = Object.freeze({
  base: buildSpaceDefinitions('base'),
  cb: buildSpaceDefinitions('cb'),
  ed: buildSpaceDefinitions('ed'),
  dd: buildSpaceDefinitions('dd'),
  fd: buildSpaceDefinitions('fd'),
  ddcb: buildSpaceDefinitions('ddcb'),
  fdcb: buildSpaceDefinitions('fdcb')
});

export function hasTimingDefinition(space: OpcodeSpace, opcode: number): boolean {
  return getTimingDefinition(space, opcode) !== undefined;
}

export function getTimingDefinition(space: OpcodeSpace, opcode: number): OpcodeTimingDefinition {
  const clamped = opcode & 0xff;
  const definition = Z80_TIMING_DEFINITION_TABLE[space][clamped];
  if (!definition) {
    throw new Error(`Missing timing definition: ${space} opcode=0x${clamped.toString(16).padStart(2, '0')}`);
  }
  return definition;
}
