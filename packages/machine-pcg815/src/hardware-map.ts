import type { HardwareEvidenceId } from './hardware-evidence';

// 仕様根拠の確度と固定度合い。
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
  | 'keyboard-matrix'
  | 'system-control'
  | 'bank-control'
  | 'battery-control'
  | 'lcd-command'
  | 'lcd-data'
  | 'lcd-status'
  | 'reserved';

export type IoPortId =
  | 'sys-10'
  | 'sys-11'
  | 'sys-12'
  | 'sys-13'
  | 'sys-14'
  | 'sys-15'
  | 'sys-16'
  | 'sys-17'
  | 'sys-18'
  | 'sys-19'
  | 'sys-1a'
  | 'sys-1b'
  | 'sys-1c'
  | 'sys-1d'
  | 'sys-1e'
  | 'sys-1f'
  | 'lcd-command-dual'
  | 'lcd-status-dual'
  | 'lcd-data-dual'
  | 'lcd-command-secondary'
  | 'lcd-status-secondary'
  | 'lcd-data-secondary'
  | 'lcd-read-secondary'
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

// 表示仕様はフォント描画モジュールからも参照される。
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

// アドレス空間を 0x0000-0xFFFF で連続に定義する。
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

// I/O ポートは PC-G815 実装範囲のみ定義する。
export const PCG815_IO_MAP: readonly IoPortSpec[] = [
  { id: 'sys-10', name: 'System Port 0x10', port: 0x10, direction: 'in', behavior: 'keyboard-matrix', defaultInValue: 0x00, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'Keyboard matrix read based on key strobe.' },
  { id: 'sys-11', name: 'System Port 0x11', port: 0x11, direction: 'inout', behavior: 'keyboard-matrix', defaultInValue: 0x00, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'Key strobe lower register.' },
  { id: 'sys-12', name: 'System Port 0x12', port: 0x12, direction: 'inout', behavior: 'keyboard-matrix', defaultInValue: 0x00, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'Key strobe upper register.' },
  { id: 'sys-13', name: 'System Port 0x13', port: 0x13, direction: 'inout', behavior: 'system-control', defaultInValue: 0x00, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'Shift key state read / output no-op.' },
  { id: 'sys-14', name: 'System Port 0x14', port: 0x14, direction: 'inout', behavior: 'system-control', defaultInValue: 0x00, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'Timer read / clear.' },
  { id: 'sys-15', name: 'System Port 0x15', port: 0x15, direction: 'inout', behavior: 'system-control', defaultInValue: 0x00, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'Xin enable control (bit7).' },
  { id: 'sys-16', name: 'System Port 0x16', port: 0x16, direction: 'inout', behavior: 'system-control', defaultInValue: 0x00, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'Interrupt cause read / clear bits on write.' },
  { id: 'sys-17', name: 'System Port 0x17', port: 0x17, direction: 'inout', behavior: 'system-control', defaultInValue: 0x00, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'Interrupt mask read / write.' },
  { id: 'sys-18', name: 'System Port 0x18', port: 0x18, direction: 'inout', behavior: 'system-control', defaultInValue: 0x00, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: '11-pin IF output control.' },
  { id: 'sys-19', name: 'System Port 0x19', port: 0x19, direction: 'inout', behavior: 'bank-control', defaultInValue: 0x00, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'ROM/EXROM bank register.' },
  { id: 'sys-1a', name: 'System Port 0x1A', port: 0x1a, direction: 'inout', behavior: 'system-control', defaultInValue: 0x00, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'BOOT ROM control (currently no-op).' },
  { id: 'sys-1b', name: 'System Port 0x1B', port: 0x1b, direction: 'inout', behavior: 'bank-control', defaultInValue: 0x00, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'RAM bank register.' },
  { id: 'sys-1c', name: 'System Port 0x1C', port: 0x1c, direction: 'out', behavior: 'system-control', defaultInValue: 0x00, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'I/O reset value write.' },
  { id: 'sys-1d', name: 'System Port 0x1D', port: 0x1d, direction: 'in', behavior: 'battery-control', defaultInValue: 0x00, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'Battery status input (returns 0x00 in current implementation).' },
  { id: 'sys-1e', name: 'System Port 0x1E', port: 0x1e, direction: 'inout', behavior: 'battery-control', defaultInValue: 0x00, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'Battery check mode register.' },
  { id: 'sys-1f', name: 'System Port 0x1F', port: 0x1f, direction: 'inout', behavior: 'system-control', defaultInValue: 0x00, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: '11-pin IF input / output no-op.' },

  { id: 'lcd-command-dual', name: 'LCD Command (Dual)', port: 0x50, direction: 'out', behavior: 'lcd-command', defaultInValue: 0x78, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'Apply command to both LCD areas.' },
  { id: 'lcd-status-dual', name: 'LCD Status (Dual)', port: 0x51, direction: 'in', behavior: 'lcd-status', defaultInValue: 0x00, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'Currently fixed 0x00.' },
  { id: 'lcd-data-dual', name: 'LCD Data (Dual Write)', port: 0x52, direction: 'out', behavior: 'lcd-data', defaultInValue: 0x78, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'Writes through both 0x56 and 0x5A paths.' },
  { id: 'lcd-command-secondary', name: 'LCD Command (Secondary)', port: 0x54, direction: 'out', behavior: 'lcd-command', defaultInValue: 0x78, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'Apply command to secondary LCD area.' },
  { id: 'lcd-status-secondary', name: 'LCD Status (Secondary)', port: 0x55, direction: 'in', behavior: 'lcd-status', defaultInValue: 0x00, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'Currently fixed 0x00.' },
  { id: 'lcd-data-secondary', name: 'LCD Data (Secondary)', port: 0x56, direction: 'out', behavior: 'lcd-data', defaultInValue: 0x78, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'Write data to secondary LCD area.' },
  { id: 'lcd-read-secondary', name: 'LCD Read (Secondary)', port: 0x57, direction: 'in', behavior: 'lcd-status', defaultInValue: 0x00, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'Read data from secondary LCD area with dummy-first behavior.' },
  { id: 'lcd-command', name: 'LCD Command', port: 0x58, direction: 'out', behavior: 'lcd-command', defaultInValue: 0x78, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'Apply command to primary LCD area.' },
  { id: 'lcd-status-mirror', name: 'LCD Status Mirror', port: 0x59, direction: 'in', behavior: 'lcd-status', defaultInValue: 0x00, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'Currently fixed 0x00.' },
  { id: 'lcd-data', name: 'LCD Data', port: 0x5a, direction: 'out', behavior: 'lcd-data', defaultInValue: 0x78, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'Write data to primary LCD area.' },
  { id: 'lcd-status', name: 'LCD Status', port: 0x5b, direction: 'in', behavior: 'lcd-status', defaultInValue: 0x00, confidence: 'CONFIRMED', status: 'TBD', evidence: ['ver0-doc-index'], notes: 'LCD data read with dummy-first behavior.' }
];

// 実機 RAM 上のワークエリア候補。
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
