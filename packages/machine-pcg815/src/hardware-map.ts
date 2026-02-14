import type { HardwareEvidenceId } from './hardware-evidence';

export type Confidence = 'CONFIRMED' | 'DERIVED' | 'HYPOTHESIS';
export type SpecStatus = 'LOCKED' | 'TBD';

interface EvidenceBoundSpec {
  confidence: Confidence;
  status: SpecStatus;
  evidence: readonly HardwareEvidenceId[];
  notes: string;
}

export type MemoryRegionId = 'main-ram-window' | 'system-rom-window' | 'banked-rom-window';

export type MemoryRegionKind = 'ram-window' | 'rom-window' | 'banked-rom-window';

export interface MemoryRegionSpec extends EvidenceBoundSpec {
  id: MemoryRegionId;
  name: string;
  start: number;
  end: number;
  kind: MemoryRegionKind;
  writable: boolean;
}

export type IoDirection = 'in' | 'out' | 'inout';
export type IoBehavior =
  | 'keyboard-row-select'
  | 'keyboard-row-data'
  | 'keyboard-ascii-fifo'
  | 'interrupt-control'
  | 'bank-control'
  | 'lcd-command'
  | 'lcd-data'
  | 'lcd-status'
  | 'runtime-channel'
  | 'reserved';

export type IoPortId =
  | 'kbd-row-select'
  | 'kbd-row-data'
  | 'kbd-ascii-fifo'
  | 'int-ctrl-13'
  | 'int-ctrl-14'
  | 'int-ctrl-15'
  | 'int-ctrl-16'
  | 'int-ctrl-17'
  | 'int-ctrl-18'
  | 'bank-rom-select'
  | 'int-ctrl-1a'
  | 'bank-expansion-control'
  | 'runtime-input'
  | 'runtime-output'
  | 'reserved-1e'
  | 'reserved-1f'
  | 'lcd-command'
  | 'lcd-status-mirror'
  | 'lcd-data'
  | 'lcd-status';

export interface IoPortSpec extends EvidenceBoundSpec {
  id: IoPortId;
  name: string;
  port: number;
  direction: IoDirection;
  behavior: IoBehavior;
  defaultInValue: number;
}

export type WorkAreaId = 'display-start-line';

export interface WorkAreaSpec extends EvidenceBoundSpec {
  id: WorkAreaId;
  name: string;
  address: number;
  widthBytes: number;
}

export interface HardwareMapValidationResult {
  ok: boolean;
  errors: string[];
}

export const PCG815_DISPLAY_SPEC = {
  width: 144,
  height: 32,
  textCols: 24,
  textRows: 4,
  glyphWidth: 5,
  glyphHeight: 7,
  glyphPitchX: 6,
  glyphPitchY: 8,
  confidence: 'CONFIRMED' as const,
  status: 'LOCKED' as const,
  evidence: ['z88dk-platform-sharp-pc'] as const,
  notes: '24x4 text, 5x7 glyph in 6x8 pitch mapped onto 144x32 LCD.'
};

export const PCG815_RAM_BYTES = 0x8000;

export const PCG815_MEMORY_MAP: readonly MemoryRegionSpec[] = [
  {
    id: 'main-ram-window',
    name: 'Main RAM / Expansion Window',
    start: 0x0000,
    end: 0x7fff,
    kind: 'ram-window',
    writable: true,
    confidence: 'DERIVED',
    status: 'TBD',
    evidence: ['ashitani-g850-general', 'akiyan-g850-tech', 'mame-pce220-metadata'],
    notes: 'Initial compatibility assumption for PC-G815 family behavior.'
  },
  {
    id: 'system-rom-window',
    name: 'System ROM / Extension ROM Window',
    start: 0x8000,
    end: 0xbfff,
    kind: 'rom-window',
    writable: false,
    confidence: 'DERIVED',
    status: 'TBD',
    evidence: ['ashitani-g850-general', 'akiyan-g850-tech', 'mame-pce220-metadata'],
    notes: 'Read-only view used for monitor/system image mapping.'
  },
  {
    id: 'banked-rom-window',
    name: 'Banked ROM Window',
    start: 0xc000,
    end: 0xffff,
    kind: 'banked-rom-window',
    writable: false,
    confidence: 'DERIVED',
    status: 'TBD',
    evidence: ['ashitani-g850-general', 'akiyan-g850-tech', 'mame-pce220-metadata'],
    notes: 'Banked ROM area switched via control ports (candidate 0x19/0x1B).'
  }
];

export const PCG815_IO_MAP: readonly IoPortSpec[] = [
  {
    id: 'kbd-row-select',
    name: 'Keyboard Row Select',
    port: 0x10,
    direction: 'out',
    behavior: 'keyboard-row-select',
    defaultInValue: 0xff,
    confidence: 'DERIVED',
    status: 'TBD',
    evidence: ['akiyan-g850-tech', 'ver0-doc-index', 'ver0-root'],
    notes: 'Row index register for active-low keyboard matrix scan.'
  },
  {
    id: 'kbd-row-data',
    name: 'Keyboard Row Data',
    port: 0x11,
    direction: 'in',
    behavior: 'keyboard-row-data',
    defaultInValue: 0xff,
    confidence: 'DERIVED',
    status: 'TBD',
    evidence: ['akiyan-g850-tech', 'ver0-doc-index', 'ver0-root'],
    notes: 'Returns selected keyboard row bits (active-low).'
  },
  {
    id: 'kbd-ascii-fifo',
    name: 'Keyboard ASCII FIFO',
    port: 0x12,
    direction: 'in',
    behavior: 'keyboard-ascii-fifo',
    defaultInValue: 0x00,
    confidence: 'HYPOTHESIS',
    status: 'TBD',
    evidence: ['ver0-js', 'ver0-root'],
    notes: 'Compatibility helper FIFO used by the monitor runtime.'
  },
  {
    id: 'int-ctrl-13',
    name: 'Interrupt/Control Reserved',
    port: 0x13,
    direction: 'inout',
    behavior: 'interrupt-control',
    defaultInValue: 0xff,
    confidence: 'DERIVED',
    status: 'TBD',
    evidence: ['ver0-doc-index', 'mame-pce220-metadata'],
    notes: 'Reserved placeholder in the 0x10-0x1F control block.'
  },
  {
    id: 'int-ctrl-14',
    name: 'Interrupt/Control Reserved',
    port: 0x14,
    direction: 'inout',
    behavior: 'interrupt-control',
    defaultInValue: 0xff,
    confidence: 'DERIVED',
    status: 'TBD',
    evidence: ['ver0-doc-index', 'mame-pce220-metadata'],
    notes: 'Reserved placeholder in the 0x10-0x1F control block.'
  },
  {
    id: 'int-ctrl-15',
    name: 'Interrupt/Control Reserved',
    port: 0x15,
    direction: 'inout',
    behavior: 'interrupt-control',
    defaultInValue: 0xff,
    confidence: 'DERIVED',
    status: 'TBD',
    evidence: ['ver0-doc-index', 'mame-pce220-metadata'],
    notes: 'Reserved placeholder in the 0x10-0x1F control block.'
  },
  {
    id: 'int-ctrl-16',
    name: 'Interrupt/Control Reserved',
    port: 0x16,
    direction: 'inout',
    behavior: 'interrupt-control',
    defaultInValue: 0xff,
    confidence: 'DERIVED',
    status: 'TBD',
    evidence: ['ver0-doc-index', 'mame-pce220-metadata'],
    notes: 'Reserved placeholder in the 0x10-0x1F control block.'
  },
  {
    id: 'int-ctrl-17',
    name: 'Interrupt/Control Reserved',
    port: 0x17,
    direction: 'inout',
    behavior: 'interrupt-control',
    defaultInValue: 0xff,
    confidence: 'DERIVED',
    status: 'TBD',
    evidence: ['ver0-doc-index', 'mame-pce220-metadata'],
    notes: 'Reserved placeholder in the 0x10-0x1F control block.'
  },
  {
    id: 'int-ctrl-18',
    name: 'Interrupt/Control Reserved',
    port: 0x18,
    direction: 'inout',
    behavior: 'interrupt-control',
    defaultInValue: 0xff,
    confidence: 'DERIVED',
    status: 'TBD',
    evidence: ['ver0-doc-index', 'mame-pce220-metadata'],
    notes: 'Reserved placeholder in the 0x10-0x1F control block.'
  },
  {
    id: 'bank-rom-select',
    name: 'ROM Bank Select (Candidate)',
    port: 0x19,
    direction: 'out',
    behavior: 'bank-control',
    defaultInValue: 0xff,
    confidence: 'DERIVED',
    status: 'TBD',
    evidence: ['akiyan-g850-tech', 'mame-pce220-metadata', 'wikipedia-pce220'],
    notes: 'Candidate register for bank/window control.'
  },
  {
    id: 'int-ctrl-1a',
    name: 'Interrupt/Control Reserved',
    port: 0x1a,
    direction: 'inout',
    behavior: 'interrupt-control',
    defaultInValue: 0xff,
    confidence: 'DERIVED',
    status: 'TBD',
    evidence: ['ver0-doc-index', 'mame-pce220-metadata'],
    notes: 'Reserved placeholder in the 0x10-0x1F control block.'
  },
  {
    id: 'bank-expansion-control',
    name: 'Expansion RAM Control (Candidate)',
    port: 0x1b,
    direction: 'out',
    behavior: 'bank-control',
    defaultInValue: 0xff,
    confidence: 'DERIVED',
    status: 'TBD',
    evidence: ['akiyan-g850-tech', 'mame-pce220-metadata', 'wikipedia-pce220'],
    notes: 'Candidate register for RAM expansion mapping.'
  },
  {
    id: 'runtime-input',
    name: 'Runtime Input Channel',
    port: 0x1c,
    direction: 'out',
    behavior: 'runtime-channel',
    defaultInValue: 0xff,
    confidence: 'HYPOTHESIS',
    status: 'TBD',
    evidence: ['ver0-js', 'ver0-root'],
    notes: 'Emulator helper channel for monitor runtime input.'
  },
  {
    id: 'runtime-output',
    name: 'Runtime Output Channel',
    port: 0x1d,
    direction: 'in',
    behavior: 'runtime-channel',
    defaultInValue: 0x00,
    confidence: 'HYPOTHESIS',
    status: 'TBD',
    evidence: ['ver0-js', 'ver0-root'],
    notes: 'Emulator helper channel for monitor runtime output.'
  },
  {
    id: 'reserved-1e',
    name: 'Reserved Control',
    port: 0x1e,
    direction: 'inout',
    behavior: 'reserved',
    defaultInValue: 0xff,
    confidence: 'DERIVED',
    status: 'TBD',
    evidence: ['ver0-doc-index', 'mame-pce220-metadata'],
    notes: 'Unimplemented control register in 0x10-0x1F block.'
  },
  {
    id: 'reserved-1f',
    name: 'Reserved Control',
    port: 0x1f,
    direction: 'inout',
    behavior: 'reserved',
    defaultInValue: 0xff,
    confidence: 'DERIVED',
    status: 'TBD',
    evidence: ['ver0-doc-index', 'mame-pce220-metadata'],
    notes: 'Unimplemented control register in 0x10-0x1F block.'
  },
  {
    id: 'lcd-command',
    name: 'LCD Command',
    port: 0x58,
    direction: 'out',
    behavior: 'lcd-command',
    defaultInValue: 0xff,
    confidence: 'CONFIRMED',
    status: 'LOCKED',
    evidence: ['z88dk-platform-sharp-pc', 'pokecom-basic-samples'],
    notes: 'LCD command port observed in community BASIC examples.'
  },
  {
    id: 'lcd-status-mirror',
    name: 'LCD Status (Mirror Candidate)',
    port: 0x59,
    direction: 'in',
    behavior: 'lcd-status',
    defaultInValue: 0xff,
    confidence: 'HYPOTHESIS',
    status: 'TBD',
    evidence: ['pokecom-basic-samples', 'ver0-doc-index'],
    notes: 'Mirror/alternate status read candidate.'
  },
  {
    id: 'lcd-data',
    name: 'LCD Data',
    port: 0x5a,
    direction: 'out',
    behavior: 'lcd-data',
    defaultInValue: 0xff,
    confidence: 'CONFIRMED',
    status: 'LOCKED',
    evidence: ['z88dk-platform-sharp-pc', 'pokecom-basic-samples'],
    notes: 'LCD data write port observed in community BASIC examples.'
  },
  {
    id: 'lcd-status',
    name: 'LCD Status',
    port: 0x5b,
    direction: 'in',
    behavior: 'lcd-status',
    defaultInValue: 0xff,
    confidence: 'DERIVED',
    status: 'TBD',
    evidence: ['ver0-doc-index', 'mame-pce220-metadata'],
    notes: 'Status read-back candidate used in compatibility mode.'
  }
];

export const PCG815_WORK_AREA: readonly WorkAreaSpec[] = [
  {
    id: 'display-start-line',
    name: 'Display Start Line / Scroll Origin (Candidate)',
    address: 0x790d,
    widthBytes: 1,
    confidence: 'DERIVED',
    status: 'TBD',
    evidence: ['akiyan-g850-tech', 'pokecom-basic-samples', 'ver0-doc-index'],
    notes: 'Low 5 bits are interpreted as display start line in compatibility mode.'
  }
];

const memoryRegionById = new Map(PCG815_MEMORY_MAP.map((entry) => [entry.id, entry]));
const ioPortMap = new Map(PCG815_IO_MAP.map((entry) => [entry.port & 0xff, entry]));
const ioPortById = new Map(PCG815_IO_MAP.map((entry) => [entry.id, entry]));
const workAreaById = new Map(PCG815_WORK_AREA.map((entry) => [entry.id, entry]));

export function getMemoryRegionSpec(id: MemoryRegionId): MemoryRegionSpec {
  const entry = memoryRegionById.get(id);
  if (!entry) {
    throw new Error(`Unknown memory region id: ${id}`);
  }
  return entry;
}

export function getIoPortSpec(id: IoPortId): IoPortSpec {
  const entry = ioPortById.get(id);
  if (!entry) {
    throw new Error(`Unknown I/O port id: ${id}`);
  }
  return entry;
}

export function getWorkAreaSpec(id: WorkAreaId): WorkAreaSpec {
  const entry = workAreaById.get(id);
  if (!entry) {
    throw new Error(`Unknown work area id: ${id}`);
  }
  return entry;
}

export function findMemoryRegionSpec(address: number): MemoryRegionSpec | undefined {
  const addr = address & 0xffff;
  return PCG815_MEMORY_MAP.find((entry) => addr >= entry.start && addr <= entry.end);
}

export function findIoPortSpec(port: number): IoPortSpec | undefined {
  return ioPortMap.get(port & 0xff);
}

export function validateHardwareMap(): HardwareMapValidationResult {
  const errors: string[] = [];

  const regions = [...PCG815_MEMORY_MAP].sort((a, b) => a.start - b.start);
  if (regions.length === 0) {
    errors.push('Memory map is empty.');
  } else {
    if (regions[0]?.start !== 0x0000) {
      errors.push('Memory map does not start at 0x0000.');
    }
    if (regions[regions.length - 1]?.end !== 0xffff) {
      errors.push('Memory map does not end at 0xFFFF.');
    }

    for (let index = 0; index < regions.length; index += 1) {
      const region = regions[index];
      if (!region) {
        continue;
      }
      if (region.start > region.end) {
        errors.push(`Invalid memory region ${region.id}: start > end.`);
      }
      if (region.evidence.length === 0) {
        errors.push(`Memory region ${region.id} has no evidence.`);
      }
      const next = regions[index + 1];
      if (next && region.end + 1 !== next.start) {
        errors.push(`Memory region gap/overlap between ${region.id} and ${next.id}.`);
      }
    }
  }

  const seenPorts = new Set<number>();
  for (const port of PCG815_IO_MAP) {
    const normalized = port.port & 0xff;
    if (seenPorts.has(normalized)) {
      errors.push(`Duplicate I/O port entry: 0x${normalized.toString(16).padStart(2, '0')}.`);
    }
    seenPorts.add(normalized);

    if (port.evidence.length === 0) {
      errors.push(`I/O port ${port.id} has no evidence.`);
    }
  }

  for (const workArea of PCG815_WORK_AREA) {
    if (workArea.evidence.length === 0) {
      errors.push(`Work area ${workArea.id} has no evidence.`);
    }
    const region = findMemoryRegionSpec(workArea.address);
    if (!region) {
      errors.push(`Work area ${workArea.id} is outside memory map.`);
      continue;
    }
    if (region.kind !== 'ram-window') {
      errors.push(`Work area ${workArea.id} must be in RAM window, found ${region.kind}.`);
    }
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

const validation = validateHardwareMap();
if (!validation.ok) {
  throw new Error(`Invalid PC-G815 hardware map:\n- ${validation.errors.join('\n- ')}`);
}
