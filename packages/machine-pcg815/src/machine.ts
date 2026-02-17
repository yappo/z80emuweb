import type { Bus, CpuState } from '@z80emu/core-z80';
import { Z80Cpu } from '@z80emu/core-z80';
import {
  type BasicMachineAdapter,
  createMonitorRom,
  type MonitorRuntimeSnapshot,
  MonitorRuntime
} from '@z80emu/firmware-monitor';

import {
  getGlyphForCode,
  hasGlyphForCode,
  LCD_COLS,
  LCD_GLYPH_HEIGHT,
  LCD_GLYPH_PITCH_X,
  LCD_GLYPH_PITCH_Y,
  LCD_GLYPH_WIDTH,
  LCD_HEIGHT,
  LCD_ROWS,
  LCD_WIDTH
} from './font5x7';
import {
  findIoPortSpec,
  findMemoryRegionSpec,
  getIoPortSpec,
  getMemoryRegionSpec,
  getWorkAreaSpec,
  PCG815_RAM_BYTES
} from './hardware-map';
import { KEY_MAP_BY_CODE } from './keyboard-map';
import type { MachinePCG815, PCG815MachineOptions, SnapshotV1 } from './types';

// グリフ未定義時の表示は空白にフォールバックする。
const SPACE_CODE = 0x20;

function clamp8(value: number): number {
  return value & 0xff;
}

function clamp16(value: number): number {
  return value & 0xffff;
}

function toDisplayCode(value: number): number {
  if (hasGlyphForCode(value)) {
    return value;
  }
  return SPACE_CODE;
}

const RAM_REGION = getMemoryRegionSpec('main-ram-window');
const SYSTEM_ROM_REGION = getMemoryRegionSpec('system-rom-window');
const BANKED_ROM_REGION = getMemoryRegionSpec('banked-rom-window');

const SYSTEM_ROM_SIZE = SYSTEM_ROM_REGION.end - SYSTEM_ROM_REGION.start + 1;
const BANKED_ROM_SIZE = BANKED_ROM_REGION.end - BANKED_ROM_REGION.start + 1;
const TEXT_VRAM_SIZE = LCD_COLS * LCD_ROWS;
const ICON_VRAM_SIZE = 32;

const PORT_SYS_10 = getIoPortSpec('sys-10').port;
const PORT_SYS_11 = getIoPortSpec('sys-11').port;
const PORT_SYS_12 = getIoPortSpec('sys-12').port;
const PORT_SYS_13 = getIoPortSpec('sys-13').port;
const PORT_SYS_14 = getIoPortSpec('sys-14').port;
const PORT_SYS_15 = getIoPortSpec('sys-15').port;
const PORT_SYS_16 = getIoPortSpec('sys-16').port;
const PORT_SYS_17 = getIoPortSpec('sys-17').port;
const PORT_SYS_18 = getIoPortSpec('sys-18').port;
const PORT_SYS_19 = getIoPortSpec('sys-19').port;
const PORT_SYS_1a = getIoPortSpec('sys-1a').port;
const PORT_SYS_1b = getIoPortSpec('sys-1b').port;
const PORT_SYS_1c = getIoPortSpec('sys-1c').port;
const PORT_SYS_1d = getIoPortSpec('sys-1d').port;
const PORT_SYS_1e = getIoPortSpec('sys-1e').port;
const PORT_SYS_1f = getIoPortSpec('sys-1f').port;
const PORT_LCD_COMMAND_DUAL = getIoPortSpec('lcd-command-dual').port;
const PORT_LCD_DATA_DUAL = getIoPortSpec('lcd-data-dual').port;
const PORT_LCD_COMMAND_SECONDARY = getIoPortSpec('lcd-command-secondary').port;
const PORT_LCD_DATA_SECONDARY = getIoPortSpec('lcd-data-secondary').port;
const PORT_LCD_READ_SECONDARY = getIoPortSpec('lcd-read-secondary').port;
const PORT_LCD_COMMAND = getIoPortSpec('lcd-command').port;
const PORT_LCD_DATA = getIoPortSpec('lcd-data').port;
const PORT_LCD_STATUS = getIoPortSpec('lcd-status').port;
const PORT_LCD_STATUS_MIRROR = getIoPortSpec('lcd-status-mirror').port;
const PORT_LCD_STATUS_DUAL = getIoPortSpec('lcd-status-dual').port;
const PORT_LCD_STATUS_SECONDARY = getIoPortSpec('lcd-status-secondary').port;

const WORKAREA_DISPLAY_START_LINE = getWorkAreaSpec('display-start-line').address;

// かな入力合成で使う半角カナ特殊コード。
const HALF_WIDTH_KANA_DAKUTEN = 0xde;
const HALF_WIDTH_KANA_HANDAKUTEN = 0xdf;
const HALF_WIDTH_KANA_SOKUON = 0xaf;
const HALF_WIDTH_KANA_N = 0xdd;

const KANA_DIRECT_KEYCODE_TO_HALFWIDTH = new Map<string, readonly number[]>([
  ['Minus', [0xb0]], // ｰ
  ['Comma', [0xa4]], // ､
  ['Period', [0xa1]], // ｡
  ['Slash', [0xa5]], // ･
  ['Quote', [HALF_WIDTH_KANA_DAKUTEN]], // ﾞ
  ['BracketLeft', [HALF_WIDTH_KANA_HANDAKUTEN]] // ﾟ
]);

// ローマ字列 -> 半角カナ列の変換表。
const ROMAJI_TO_HALFWIDTH = new Map<string, readonly number[]>([
  ['a', [0xb1]],
  ['i', [0xb2]],
  ['u', [0xb3]],
  ['e', [0xb4]],
  ['o', [0xb5]],
  ['wi', [0xb2]],
  ['we', [0xb4]],
  ['wu', [0xb3]],
  ['wa', [0xdc]],
  ['wo', [0xa6]],

  ['xa', [0xa7]],
  ['la', [0xa7]],
  ['xi', [0xa8]],
  ['li', [0xa8]],
  ['xu', [0xa9]],
  ['lu', [0xa9]],
  ['xe', [0xaa]],
  ['le', [0xaa]],
  ['xo', [0xab]],
  ['lo', [0xab]],
  ['xya', [0xac]],
  ['lya', [0xac]],
  ['xyu', [0xad]],
  ['lyu', [0xad]],
  ['xyo', [0xae]],
  ['lyo', [0xae]],
  ['xtu', [HALF_WIDTH_KANA_SOKUON]],
  ['ltu', [HALF_WIDTH_KANA_SOKUON]],
  ['xtsu', [HALF_WIDTH_KANA_SOKUON]],
  ['ltsu', [HALF_WIDTH_KANA_SOKUON]],
  ['xwa', [0xdc]],
  ['lwa', [0xdc]],

  ['ka', [0xb6]],
  ['ki', [0xb7]],
  ['ku', [0xb8]],
  ['ke', [0xb9]],
  ['ko', [0xba]],
  ['kya', [0xb7, 0xac]],
  ['kyu', [0xb7, 0xad]],
  ['kyo', [0xb7, 0xae]],

  ['sa', [0xbb]],
  ['si', [0xbc]],
  ['shi', [0xbc]],
  ['su', [0xbd]],
  ['se', [0xbe]],
  ['so', [0xbf]],
  ['sya', [0xbc, 0xac]],
  ['syu', [0xbc, 0xad]],
  ['syo', [0xbc, 0xae]],
  ['sha', [0xbc, 0xac]],
  ['shu', [0xbc, 0xad]],
  ['sho', [0xbc, 0xae]],

  ['ta', [0xc0]],
  ['ti', [0xc1]],
  ['chi', [0xc1]],
  ['tu', [0xc2]],
  ['tsu', [0xc2]],
  ['te', [0xc3]],
  ['to', [0xc4]],
  ['tya', [0xc1, 0xac]],
  ['tyu', [0xc1, 0xad]],
  ['tyo', [0xc1, 0xae]],
  ['cha', [0xc1, 0xac]],
  ['chu', [0xc1, 0xad]],
  ['cho', [0xc1, 0xae]],

  ['na', [0xc5]],
  ['ni', [0xc6]],
  ['nu', [0xc7]],
  ['ne', [0xc8]],
  ['no', [0xc9]],
  ['nya', [0xc6, 0xac]],
  ['nyu', [0xc6, 0xad]],
  ['nyo', [0xc6, 0xae]],

  ['ha', [0xca]],
  ['hi', [0xcb]],
  ['hu', [0xcc]],
  ['fu', [0xcc]],
  ['he', [0xcd]],
  ['ho', [0xce]],
  ['hya', [0xcb, 0xac]],
  ['hyu', [0xcb, 0xad]],
  ['hyo', [0xcb, 0xae]],

  ['ma', [0xcf]],
  ['mi', [0xd0]],
  ['mu', [0xd1]],
  ['me', [0xd2]],
  ['mo', [0xd3]],
  ['mya', [0xd0, 0xac]],
  ['myu', [0xd0, 0xad]],
  ['myo', [0xd0, 0xae]],

  ['ya', [0xd4]],
  ['yu', [0xd5]],
  ['yo', [0xd6]],

  ['ra', [0xd7]],
  ['ri', [0xd8]],
  ['ru', [0xd9]],
  ['re', [0xda]],
  ['ro', [0xdb]],
  ['rya', [0xd8, 0xac]],
  ['ryu', [0xd8, 0xad]],
  ['ryo', [0xd8, 0xae]],

  ['ga', [0xb6, HALF_WIDTH_KANA_DAKUTEN]],
  ['gi', [0xb7, HALF_WIDTH_KANA_DAKUTEN]],
  ['gu', [0xb8, HALF_WIDTH_KANA_DAKUTEN]],
  ['ge', [0xb9, HALF_WIDTH_KANA_DAKUTEN]],
  ['go', [0xba, HALF_WIDTH_KANA_DAKUTEN]],
  ['gya', [0xb7, HALF_WIDTH_KANA_DAKUTEN, 0xac]],
  ['gyu', [0xb7, HALF_WIDTH_KANA_DAKUTEN, 0xad]],
  ['gyo', [0xb7, HALF_WIDTH_KANA_DAKUTEN, 0xae]],

  ['za', [0xbb, HALF_WIDTH_KANA_DAKUTEN]],
  ['zi', [0xbc, HALF_WIDTH_KANA_DAKUTEN]],
  ['ji', [0xbc, HALF_WIDTH_KANA_DAKUTEN]],
  ['zu', [0xbd, HALF_WIDTH_KANA_DAKUTEN]],
  ['ze', [0xbe, HALF_WIDTH_KANA_DAKUTEN]],
  ['zo', [0xbf, HALF_WIDTH_KANA_DAKUTEN]],
  ['zya', [0xbc, HALF_WIDTH_KANA_DAKUTEN, 0xac]],
  ['zyu', [0xbc, HALF_WIDTH_KANA_DAKUTEN, 0xad]],
  ['zyo', [0xbc, HALF_WIDTH_KANA_DAKUTEN, 0xae]],
  ['ja', [0xbc, HALF_WIDTH_KANA_DAKUTEN, 0xac]],
  ['ju', [0xbc, HALF_WIDTH_KANA_DAKUTEN, 0xad]],
  ['jo', [0xbc, HALF_WIDTH_KANA_DAKUTEN, 0xae]],
  ['jya', [0xbc, HALF_WIDTH_KANA_DAKUTEN, 0xac]],
  ['jyu', [0xbc, HALF_WIDTH_KANA_DAKUTEN, 0xad]],
  ['jyo', [0xbc, HALF_WIDTH_KANA_DAKUTEN, 0xae]],

  ['da', [0xc0, HALF_WIDTH_KANA_DAKUTEN]],
  ['di', [0xc1, HALF_WIDTH_KANA_DAKUTEN]],
  ['du', [0xc2, HALF_WIDTH_KANA_DAKUTEN]],
  ['de', [0xc3, HALF_WIDTH_KANA_DAKUTEN]],
  ['do', [0xc4, HALF_WIDTH_KANA_DAKUTEN]],
  ['dya', [0xc1, HALF_WIDTH_KANA_DAKUTEN, 0xac]],
  ['dyu', [0xc1, HALF_WIDTH_KANA_DAKUTEN, 0xad]],
  ['dyo', [0xc1, HALF_WIDTH_KANA_DAKUTEN, 0xae]],

  ['ba', [0xca, HALF_WIDTH_KANA_DAKUTEN]],
  ['bi', [0xcb, HALF_WIDTH_KANA_DAKUTEN]],
  ['bu', [0xcc, HALF_WIDTH_KANA_DAKUTEN]],
  ['be', [0xcd, HALF_WIDTH_KANA_DAKUTEN]],
  ['bo', [0xce, HALF_WIDTH_KANA_DAKUTEN]],
  ['bya', [0xcb, HALF_WIDTH_KANA_DAKUTEN, 0xac]],
  ['byu', [0xcb, HALF_WIDTH_KANA_DAKUTEN, 0xad]],
  ['byo', [0xcb, HALF_WIDTH_KANA_DAKUTEN, 0xae]],

  ['pa', [0xca, HALF_WIDTH_KANA_HANDAKUTEN]],
  ['pi', [0xcb, HALF_WIDTH_KANA_HANDAKUTEN]],
  ['pu', [0xcc, HALF_WIDTH_KANA_HANDAKUTEN]],
  ['pe', [0xcd, HALF_WIDTH_KANA_HANDAKUTEN]],
  ['po', [0xce, HALF_WIDTH_KANA_HANDAKUTEN]],
  ['pya', [0xcb, HALF_WIDTH_KANA_HANDAKUTEN, 0xac]],
  ['pyu', [0xcb, HALF_WIDTH_KANA_HANDAKUTEN, 0xad]],
  ['pyo', [0xcb, HALF_WIDTH_KANA_HANDAKUTEN, 0xae]]
]);

const ROMAJI_KEYS = [...ROMAJI_TO_HALFWIDTH.keys()];
const MAX_ROMAJI_SEQUENCE_LENGTH = ROMAJI_KEYS.reduce((max, key) => Math.max(max, key.length), 1);

function keyCodeToRomajiLetter(code: string): string | undefined {
  if (code.length === 4 && code.startsWith('Key')) {
    return code[3]?.toLowerCase();
  }
  return undefined;
}

function isSokuonConsonant(ch: string): boolean {
  return ch >= 'a' && ch <= 'z' && !'aeioun'.includes(ch);
}

// PC-G815 互換マシン本体。CPU バス実装も兼ねる。
export class PCG815Machine implements MachinePCG815, Bus {
  static readonly CLOCK_HZ = 3_579_545;

  readonly cpu: Z80Cpu;

  readonly runtime: MonitorRuntime;

  private readonly bootstrapImage: Uint8Array;

  private readonly mainRam = new Uint8Array(PCG815_RAM_BYTES);

  private readonly systemRomWindow = new Uint8Array(SYSTEM_ROM_SIZE);

  private readonly bankedRomWindow = new Uint8Array(BANKED_ROM_SIZE);

  private readonly textVram = new Uint8Array(TEXT_VRAM_SIZE);

  private readonly iconVram = new Uint8Array(ICON_VRAM_SIZE);

  private readonly frameBuffer = new Uint8Array(LCD_WIDTH * LCD_HEIGHT);

  private readonly graphicsPlane = new Uint8Array(LCD_WIDTH * LCD_HEIGHT);

  private readonly keyboardRows = new Uint8Array(8);

  private readonly pressedCodes = new Set<string>();

  private readonly asciiQueue: number[] = [];

  private kanaMode = false;
  private kanaComposeBuffer = '';

  private lcdCursor = 0;
  private keyStrobe = 0;
  private keyShift = 0;
  private timer = 0;
  private xinEnabled = 0;
  private interruptType = 0;
  private interruptMask = 0;
  private io3Out = 0;
  private exRomBank = 0;
  private romBank = 0;
  private ramBank = 0;
  private ioReset = 0;
  private battChk = 0;
  private keyBreak = 0;
  private pin11In = 0;

  private lcdX = 0;
  private lcdY = 0;
  private lcdX2 = 0;
  private lcdY2 = 0;
  private lcdRead = false;
  private readonly lcdRawVram = new Uint8Array(8 * 0x80);

  private dirtyFrame = true;

  private elapsedTStates = 0;
  private wasRuntimeProgramRunning = false;

  private printWaitTicks = 0;
  private printPauseMode = false;
  private immediateInputToRuntimeEnabled = true;

  private graphicCursorX = 0;
  private graphicCursorY = 0;

  private readonly printerLines: string[] = [];

  private readonly files = new Map<string, string[]>();
  private readonly openFiles = new Map<number, { path: string; mode: 'INPUT' | 'OUTPUT' | 'APPEND'; cursor: number }>();
  private nextFileHandle = 1;

  constructor(options?: PCG815MachineOptions) {
    const monitorRom = options?.rom ?? createMonitorRom();
    this.bootstrapImage = new Uint8Array(monitorRom);

    this.seedRomWindows();

    // BASIC ランタイムは machine adapter 経由で LCD/IO を操作する。
    this.runtime = new MonitorRuntime({
      machineAdapter: this.createBasicMachineAdapter()
    });
    this.cpu = new Z80Cpu(this, {
      strictUnsupportedOpcodes: options?.strictCpuOpcodes ?? false
    });

    this.reset(true);
  }

  reset(cold: boolean): void {
    if (cold) {
      this.mainRam.fill(0);
      this.seedBootstrapInMainRam();
      this.iconVram.fill(0);
      this.textVram.fill(SPACE_CODE);
      this.graphicsPlane.fill(0);
      this.files.clear();
    }

    this.keyboardRows.fill(0xff);
    this.pressedCodes.clear();
    this.asciiQueue.length = 0;
    this.kanaMode = false;
    this.kanaComposeBuffer = '';
    this.lcdCursor = 0;
    this.keyStrobe = 0;
    this.keyShift = 0;
    this.timer = 0;
    this.xinEnabled = 0;
    this.interruptType = 0;
    this.interruptMask = 0;
    this.io3Out = 0;
    this.exRomBank = 0;
    this.romBank = 0;
    this.ramBank = 0;
    this.ioReset = 0;
    this.battChk = 0;
    this.keyBreak = 0;
    this.pin11In = 0;
    this.lcdX = 0;
    this.lcdY = 0;
    this.lcdX2 = 0;
    this.lcdY2 = 0;
    this.lcdRead = false;
    this.lcdRawVram.fill(0);
    this.printWaitTicks = 0;
    this.printPauseMode = false;
    this.graphicCursorX = 0;
    this.graphicCursorY = 0;
    this.printerLines.length = 0;
    this.openFiles.clear();
    this.nextFileHandle = 1;

    this.runtime.reset(cold);
    this.cpu.reset();
    this.dirtyFrame = true;
    this.elapsedTStates = 0;
    this.wasRuntimeProgramRunning = false;
  }

  tick(tstates: number): void {
    const clamped = Math.max(0, Math.floor(tstates));
    const wasRunning = this.runtime.isProgramRunning();
    this.cpu.stepTState(clamped);
    this.elapsedTStates += clamped;
    this.runtime.pump();
    this.flushRuntimeOutputToLcd();
    const isRunning = this.runtime.isProgramRunning();
    if (!wasRunning && isRunning) {
      // RUN開始時にタイプ済み文字を捨てる（終了後の遅延エコー防止）。
      this.asciiQueue.length = 0;
    }
    if (wasRunning && !isRunning) {
      // RUN中に押されたキー残骸を破棄する。
      this.asciiQueue.length = 0;
    }
    this.wasRuntimeProgramRunning = isRunning;
  }

  private flushRuntimeOutputToLcd(): void {
    // Runtime PRINT queue is exposed as bytes; consume and mirror into LCD text layer.
    while (true) {
      const code = this.runtime.popOutputChar();
      if (code === 0) {
        break;
      }
      this.handleLcdData(code & 0xff);
    }
  }

  setKeyState(code: string, pressed: boolean): void {
    const mapping = KEY_MAP_BY_CODE.get(code);
    if (!mapping) {
      return;
    }

    const rowMask = 1 << mapping.col;

    if (pressed) {
      const firstPress = !this.pressedCodes.has(code);
      this.pressedCodes.add(code);
      const currentRowState = this.keyboardRows[mapping.row] ?? 0xff;
      this.keyboardRows[mapping.row] = currentRowState & ~rowMask;

      // 押下エッジでのみ ASCII キューへ投入し、オートリピートの暴走を防ぐ。
      if (firstPress) {
        const asciiCodes = this.resolveAsciiCodes(mapping.code, mapping.normal, mapping.shifted);
        if (!this.runtime.isProgramRunning() && this.immediateInputToRuntimeEnabled) {
          // Immediate mode input goes directly into runtime line editor.
          for (const ascii of asciiCodes) {
            this.runtime.receiveChar(ascii & 0xff);
          }
        } else if (asciiCodes.length > 0) {
          // Program execution uses INKEY$ path via FIFO.
          this.asciiQueue.push(...asciiCodes);
        }
      }
      this.keyShift = this.pressedCodes.has('ShiftLeft') || this.pressedCodes.has('ShiftRight') ? 1 : 0;
      return;
    }

    this.pressedCodes.delete(code);
    const currentRowState = this.keyboardRows[mapping.row] ?? 0xff;
    this.keyboardRows[mapping.row] = currentRowState | rowMask;
    this.keyShift = this.pressedCodes.has('ShiftLeft') || this.pressedCodes.has('ShiftRight') ? 1 : 0;
  }

  getFrameBuffer(): Uint8Array {
    if (this.dirtyFrame) {
      this.renderFrameBuffer();
    }
    return this.frameBuffer;
  }

  setKanaMode(enabled: boolean): void {
    this.kanaMode = Boolean(enabled);
    this.kanaComposeBuffer = '';
  }

  setImmediateInputToRuntimeEnabled(enabled: boolean): void {
    this.immediateInputToRuntimeEnabled = Boolean(enabled);
  }

  getKanaMode(): boolean {
    return this.kanaMode;
  }

  isRuntimeProgramRunning(): boolean {
    return this.runtime.isProgramRunning();
  }

  getTextLines(): string[] {
    const lines: string[] = [];
    for (let row = 0; row < LCD_ROWS; row += 1) {
      let line = '';
      for (let col = 0; col < LCD_COLS; col += 1) {
        const code = this.textVram[row * LCD_COLS + col] ?? SPACE_CODE;
        line += String.fromCharCode(toDisplayCode(code));
      }
      lines.push(line);
    }
    return lines;
  }

  getCpuState(): CpuState {
    return this.cpu.getState();
  }

  getRamRange(): { start: number; end: number } {
    return {
      start: RAM_REGION.start,
      end: RAM_REGION.end
    };
  }

  loadProgram(bytes: Uint8Array | readonly number[], origin: number): void {
    const start = clamp16(origin);
    const end = start + bytes.length - 1;
    if (bytes.length > 0 && (start < RAM_REGION.start || end > RAM_REGION.end)) {
      throw new Error(
        `Program range out of RAM window: ${start.toString(16).padStart(4, '0')}-${end
          .toString(16)
          .padStart(4, '0')}`
      );
    }

    for (let i = 0; i < bytes.length; i += 1) {
      const byte = bytes[i] ?? 0;
      const addr = start + i;
      this.mainRam[addr - RAM_REGION.start] = byte & 0xff;
    }
    this.dirtyFrame = true;
  }

  setProgramCounter(entry: number): void {
    const address = clamp16(entry);
    if (address < RAM_REGION.start || address > RAM_REGION.end) {
      throw new Error(`Entry address out of RAM window: ${address.toString(16).padStart(4, '0')}`);
    }
    const state = this.cpu.getState();
    state.registers.pc = address;
    state.halted = false;
    state.pendingNmi = false;
    state.pendingIntDataBus = undefined;
    this.cpu.loadState(state);
  }

  setStackPointer(value: number): void {
    const state = this.cpu.getState();
    state.registers.sp = clamp16(value);
    this.cpu.loadState(state);
  }

  createSnapshot(): SnapshotV1 {
    return {
      version: 1,
      cpu: this.cpu.getState(),
      ram: [...this.mainRam],
      vram: {
        text: [...this.textVram],
        icons: [...this.iconVram],
        cursor: this.lcdCursor
      },
      io: {
        selectedKeyRow: this.keyStrobe & 0xff,
        keyboardRows: [...this.keyboardRows],
        asciiQueue: [...this.asciiQueue],
        kanaMode: this.kanaMode,
        kanaComposeBuffer: this.kanaComposeBuffer,
        romBankSelect: this.romBank & 0x0f,
        expansionControl: this.ramBank & 0x04,
        runtime: this.runtime.getSnapshot()
      },
      timestampTStates: this.elapsedTStates
    };
  }

  loadSnapshot(snapshot: SnapshotV1): void {
    if (snapshot.version !== 1) {
      throw new Error(`Unsupported snapshot version: ${snapshot.version}`);
    }

    this.mainRam.fill(0);
    this.mainRam.set(snapshot.ram.map((v) => v & 0xff).slice(0, this.mainRam.length));

    this.textVram.fill(SPACE_CODE);
    this.textVram.set(snapshot.vram.text.map((v) => v & 0xff).slice(0, this.textVram.length));

    this.iconVram.fill(0);
    this.iconVram.set(snapshot.vram.icons.map((v) => v & 0xff).slice(0, this.iconVram.length));

    this.lcdCursor = snapshot.vram.cursor & 0x7f;

    this.keyStrobe = snapshot.io.selectedKeyRow & 0xffff;
    this.keyboardRows.fill(0xff);
    this.keyboardRows.set(snapshot.io.keyboardRows.map((v) => v & 0xff).slice(0, this.keyboardRows.length));

    this.asciiQueue.length = 0;
    this.asciiQueue.push(...snapshot.io.asciiQueue.map((v) => v & 0xff));
    this.kanaMode = Boolean(snapshot.io.kanaMode);
    this.kanaComposeBuffer = snapshot.io.kanaComposeBuffer ?? '';

    this.romBank = snapshot.io.romBankSelect & 0x0f;
    this.ramBank = snapshot.io.expansionControl & 0x04;

    this.runtime.loadSnapshot(snapshot.io.runtime);

    this.cpu.loadState(snapshot.cpu);
    this.elapsedTStates = snapshot.timestampTStates;
    this.dirtyFrame = true;
  }

  read8(addr: number): number {
    const address = clamp16(addr);
    const region = findMemoryRegionSpec(address);

    if (!region) {
      return 0xff;
    }

    // メモリマップ定義に従って RAM/ROM の窓を切り替える。
    if (region.kind === 'ram-window') {
      return this.mainRam[address - RAM_REGION.start] ?? 0xff;
    }

    if (region.kind === 'rom-window') {
      return this.systemRomWindow[address - SYSTEM_ROM_REGION.start] ?? 0xff;
    }

    if (region.kind === 'banked-rom-window') {
      return this.bankedRomWindow[address - BANKED_ROM_REGION.start] ?? 0xff;
    }

    return 0xff;
  }

  write8(addr: number, value: number): void {
    const address = clamp16(addr);
    const byte = clamp8(value);
    const region = findMemoryRegionSpec(address);

    if (!region || !region.writable) {
      return;
    }

    if (region.kind === 'ram-window') {
      this.mainRam[address - RAM_REGION.start] = byte;
      if (address === WORKAREA_DISPLAY_START_LINE) {
        this.dirtyFrame = true;
      }
    }
  }

  in8(port: number): number {
    const portSpec = findIoPortSpec(port);
    if (!portSpec) {
      return 0x78;
    }

    const normalized = portSpec.port & 0xff;
    switch (normalized) {
      case PORT_SYS_10:
        return this.readKeyMatrixByStrobe();
      case PORT_SYS_11:
      case PORT_SYS_12:
        return 0x00;
      case PORT_SYS_13:
        return (this.keyStrobe & 0x08) !== 0 ? this.keyShift & 0xff : 0x00;
      case PORT_SYS_14:
        return this.timer & 0xff;
      case PORT_SYS_15:
        return this.xinEnabled & 0xff;
      case PORT_SYS_16:
        return this.interruptType & 0xff;
      case PORT_SYS_17:
        return this.interruptMask & 0xff;
      case PORT_SYS_18:
        return this.io3Out & 0xff;
      case PORT_SYS_19:
        return (((this.exRomBank & 0x07) << 4) | (this.romBank & 0x0f)) & 0xff;
      case PORT_SYS_1a:
      case PORT_SYS_1c:
      case PORT_SYS_1e:
        return 0x00;
      case PORT_SYS_1b:
        return this.ramBank & 0xff;
      case PORT_SYS_1d:
        return 0x00;
      case PORT_SYS_1f: {
        const xinValue = (this.xinEnabled & 0x80) !== 0 ? this.pin11In & 0x04 : 0;
        const bit1 = (this.pin11In & 0x20) !== 0 ? 0x02 : 0;
        const bit0 = (this.pin11In & 0x10) !== 0 ? 0x01 : 0;
        return (this.keyBreak | xinValue | bit1 | bit0) & 0xff;
      }
      case PORT_LCD_STATUS_DUAL:
      case PORT_LCD_STATUS_SECONDARY:
      case PORT_LCD_STATUS_MIRROR:
        return 0x00;
      case PORT_LCD_READ_SECONDARY:
        return this.readLcdData(false);
      case PORT_LCD_STATUS:
        return this.readLcdData(true);
      default:
        return portSpec.defaultInValue & 0xff;
    }
  }

  out8(port: number, value: number): void {
    const portSpec = findIoPortSpec(port);
    if (!portSpec) {
      return;
    }

    const byte = clamp8(value);

    switch (portSpec.port & 0xff) {
      case PORT_SYS_11:
        this.keyStrobe = (this.keyStrobe & 0xff00) | byte;
        if ((byte & 0x10) !== 0) {
          this.interruptType |= 0x10;
        }
        return;
      case PORT_SYS_12:
        this.keyStrobe = (this.keyStrobe & 0x00ff) | (byte << 8);
        return;
      case PORT_SYS_13:
        return;
      case PORT_SYS_14:
        this.timer = 0;
        return;
      case PORT_SYS_15:
        this.xinEnabled = byte & 0x80;
        return;
      case PORT_SYS_16:
        this.interruptType &= ~byte;
        return;
      case PORT_SYS_17:
        this.interruptMask = byte;
        return;
      case PORT_SYS_18:
        this.io3Out = byte & 0xc3;
        return;
      case PORT_SYS_19:
        this.romBank = byte & 0x0f;
        this.exRomBank = (byte >> 4) & 0x07;
        return;
      case PORT_SYS_1a:
        return;
      case PORT_SYS_1b:
        this.ramBank = byte & 0x04;
        return;
      case PORT_SYS_1c:
        this.ioReset = byte;
        return;
      case PORT_SYS_1e:
        this.battChk = byte & 0x03;
        return;
      case PORT_SYS_1f:
        return;
      case PORT_LCD_COMMAND_DUAL:
        this.g815LcdCtrl('secondary', byte);
        this.g815LcdCtrl('primary', byte);
        return;
      case PORT_LCD_DATA_DUAL:
        this.writeLcdData('secondary', byte);
        this.writeLcdData('primary', byte);
        return;
      case PORT_LCD_COMMAND_SECONDARY:
        this.g815LcdCtrl('secondary', byte);
        return;
      case PORT_LCD_DATA_SECONDARY:
        this.writeLcdData('secondary', byte);
        return;
      case PORT_LCD_COMMAND:
        this.g815LcdCtrl('primary', byte);
        return;
      case PORT_LCD_DATA:
        this.writeLcdData('primary', byte);
        return;
      default:
        return;
    }
  }

  private runtimeIn8(port: number): number {
    return this.in8(port);
  }

  private runtimeOut8(port: number, value: number): void {
    this.out8(port, value);
  }

  private readKeyMatrixByStrobe(): number {
    let out = 0;
    for (let row = 0; row < 8; row += 1) {
      if (((this.keyStrobe >> row) & 0x01) !== 0) {
        out |= this.keyboardRows[row] ?? 0;
      }
    }
    return out & 0xff;
  }

  private g815LcdCtrl(target: 'primary' | 'secondary', command: number): void {
    this.lcdRead = false;
    switch (command & 0xc0) {
      case 0x00:
        return;
      case 0x40:
        if (target === 'secondary') {
          this.lcdX2 = command & 0x3f;
        } else {
          this.lcdX = command & 0x3f;
        }
        return;
      case 0x80:
        if (target === 'secondary') {
          this.lcdY2 = command & 0x07;
        } else {
          this.lcdY = command & 0x07;
        }
        return;
      case 0xc0: {
        const line = (command >> 3) & 0x07;
        const offset = WORKAREA_DISPLAY_START_LINE - RAM_REGION.start;
        this.mainRam[offset] = line & 0x1f;
        this.dirtyFrame = true;
        return;
      }
    }
  }

  private writeLcdData(target: 'primary' | 'secondary', value: number): void {
    this.lcdRead = false;
    if (target === 'secondary') {
      if (this.lcdX2 < 0x3c && this.lcdY2 < 8) {
        this.writeRawLcdAt(this.lcdX2, this.lcdY2, value);
        this.lcdX2 = (this.lcdX2 + 1) & 0xff;
      }
      return;
    }

    const address = 0x3c + this.lcdX;
    if ((address < 0x49 || address === 0x7b) && this.lcdY < 8) {
      this.writeRawLcdAt(address, this.lcdY, value);
      this.lcdX = (this.lcdX + 1) & 0xff;
    }
    this.handleLcdData(value);
  }

  private readLcdData(primary: boolean): number {
    if (!this.lcdRead) {
      this.lcdRead = true;
      return 0x00;
    }

    if (!primary) {
      if (this.lcdX2 < 0x3c && this.lcdY2 < 8) {
        const value = this.readRawLcdAt(this.lcdX2, this.lcdY2);
        this.lcdX2 = (this.lcdX2 + 1) & 0xff;
        return value;
      }
      return 0x00;
    }

    const address = 0x3c + this.lcdX;
    if (address < 0x49 && this.lcdY < 8) {
      const value = this.readRawLcdAt(address, this.lcdY);
      this.lcdX = (this.lcdX + 1) & 0xff;
      return value;
    }
    return 0x00;
  }

  private readRawLcdAt(x: number, y: number): number {
    const xx = x & 0x7f;
    const yy = y & 0x07;
    return this.lcdRawVram[yy * 0x80 + xx] ?? 0x00;
  }

  private writeRawLcdAt(x: number, y: number, value: number): void {
    const xx = x & 0x7f;
    const yy = y & 0x07;
    this.lcdRawVram[yy * 0x80 + xx] = value & 0xff;
  }

  private seedBootstrapInMainRam(): void {
    this.mainRam.set(this.bootstrapImage.subarray(0, Math.min(this.bootstrapImage.length, this.mainRam.length)), 0);
  }

  private seedRomWindows(): void {
    this.systemRomWindow.fill(0);
    this.systemRomWindow.set(
      this.bootstrapImage.subarray(0, Math.min(this.bootstrapImage.length, this.systemRomWindow.length)),
      0
    );

    this.bankedRomWindow.fill(0);
    const bankedOffset = this.systemRomWindow.length;
    this.bankedRomWindow.set(
      this.bootstrapImage.subarray(
        bankedOffset,
        Math.min(this.bootstrapImage.length, bankedOffset + this.bankedRomWindow.length)
      ),
      0
    );
  }

  private resolveAsciiCodes(code: string, normal?: number, shifted?: number): number[] {
    if (normal === undefined) {
      return [];
    }
    if (!this.kanaMode) {
      return [this.resolveAsciiWithoutKana(normal, shifted)];
    }
    return this.resolveKanaAsciiCodes(code, normal, shifted);
  }

  private resolveAsciiWithoutKana(normal: number, shifted?: number): number {
    const shiftActive = this.pressedCodes.has('ShiftLeft') || this.pressedCodes.has('ShiftRight');
    if (shiftActive && shifted !== undefined) {
      return shifted & 0xff;
    }
    if (shiftActive && normal >= 0x41 && normal <= 0x5a) {
      return (normal + 0x20) & 0xff;
    }
    return normal & 0xff;
  }

  private resolveKanaAsciiCodes(code: string, normal: number, shifted?: number): number[] {
    const out: number[] = [];

    // アルファベットは一旦 compose buffer に貯め、確定可能な分だけ吐き出す。
    const letter = keyCodeToRomajiLetter(code);
    if (letter !== undefined) {
      this.kanaComposeBuffer += letter;
      this.flushKanaCompose(out, false);
      return out;
    }

    const directKana = KANA_DIRECT_KEYCODE_TO_HALFWIDTH.get(code);
    if (directKana) {
      this.flushKanaCompose(out, true);
      out.push(...directKana);
      return out;
    }

    this.flushKanaCompose(out, true);
    out.push(this.resolveAsciiWithoutKana(normal, shifted));
    return out;
  }

  private flushKanaCompose(out: number[], force: boolean): void {
    // force=false: まだ続く可能性がある入力は確定しない。
    while (this.kanaComposeBuffer.length > 0) {
      if (this.kanaComposeBuffer.startsWith('nn')) {
        out.push(HALF_WIDTH_KANA_N);
        this.kanaComposeBuffer = this.kanaComposeBuffer.slice(1);
        continue;
      }

      if (this.kanaComposeBuffer.length >= 2) {
        const first = this.kanaComposeBuffer[0] ?? '';
        const second = this.kanaComposeBuffer[1] ?? '';
        if (first === second && isSokuonConsonant(first)) {
          out.push(HALF_WIDTH_KANA_SOKUON);
          this.kanaComposeBuffer = this.kanaComposeBuffer.slice(1);
          continue;
        }
      }

      const matched = this.findRomajiMatch(this.kanaComposeBuffer);
      if (matched) {
        if (!force && matched.length === this.kanaComposeBuffer.length && this.hasRomajiLongerPrefix(matched)) {
          return;
        }
        const kana = ROMAJI_TO_HALFWIDTH.get(matched);
        if (kana) {
          out.push(...kana);
        }
        this.kanaComposeBuffer = this.kanaComposeBuffer.slice(matched.length);
        continue;
      }

      if (!force) {
        if (this.kanaComposeBuffer === 'n' || this.isPotentialRomajiPrefix(this.kanaComposeBuffer)) {
          return;
        }
      }

      const head = this.kanaComposeBuffer[0] ?? '';
      if (head === 'n') {
        out.push(HALF_WIDTH_KANA_N);
      } else {
        out.push(head.toUpperCase().charCodeAt(0) & 0xff);
      }
      this.kanaComposeBuffer = this.kanaComposeBuffer.slice(1);
    }
  }

  private findRomajiMatch(buffer: string): string | undefined {
    for (let len = Math.min(MAX_ROMAJI_SEQUENCE_LENGTH, buffer.length); len >= 1; len -= 1) {
      const candidate = buffer.slice(0, len);
      if (ROMAJI_TO_HALFWIDTH.has(candidate)) {
        return candidate;
      }
    }
    return undefined;
  }

  private hasRomajiLongerPrefix(value: string): boolean {
    return ROMAJI_KEYS.some((key) => key.length > value.length && key.startsWith(value));
  }

  private isPotentialRomajiPrefix(value: string): boolean {
    return ROMAJI_KEYS.some((key) => key.startsWith(value));
  }

  private getDisplayStartLine(): number {
    const offset = WORKAREA_DISPLAY_START_LINE - RAM_REGION.start;
    const raw = this.mainRam[offset] ?? 0;
    return raw & 0x1f;
  }

  private handleLcdCommand(command: number): void {
    // 現状は CLS とカーソル設定のみを実装。
    if (command === 0x01) {
      this.textVram.fill(SPACE_CODE);
      this.graphicsPlane.fill(0);
      this.lcdCursor = 0;
      this.dirtyFrame = true;
      return;
    }

    if ((command & 0x80) !== 0) {
      this.lcdCursor = command & 0x7f;
      if (this.lcdCursor >= TEXT_VRAM_SIZE) {
        this.lcdCursor %= TEXT_VRAM_SIZE;
      }
      return;
    }
  }

  private handleLcdData(rawValue: number): void {
    const value = rawValue & 0xff;

    // CR/LF/BS を先に処理して、テキスト VRAM の編集挙動を再現する。
    if (value === 0x0d) {
      const row = Math.floor(this.lcdCursor / LCD_COLS);
      this.lcdCursor = row * LCD_COLS;
      return;
    }

    if (value === 0x0a) {
      const row = Math.floor(this.lcdCursor / LCD_COLS);
      const col = this.lcdCursor % LCD_COLS;
      if (row < LCD_ROWS - 1) {
        this.lcdCursor = (row + 1) * LCD_COLS + col;
      } else {
        this.scrollTextUp(1);
        this.lcdCursor = (LCD_ROWS - 1) * LCD_COLS + col;
      }
      return;
    }

    if (value === 0x08) {
      if (this.lcdCursor > 0) {
        this.lcdCursor -= 1;
      }
      this.textVram[this.lcdCursor] = SPACE_CODE;
      this.dirtyFrame = true;
      return;
    }

    this.textVram[this.lcdCursor] = toDisplayCode(value);
    this.lcdCursor += 1;
    if (this.lcdCursor >= TEXT_VRAM_SIZE) {
      this.scrollTextUp(1);
      this.lcdCursor = (LCD_ROWS - 1) * LCD_COLS;
    }
    this.dirtyFrame = true;
  }

  private scrollTextUp(lines: number): void {
    const count = Math.max(0, Math.min(lines, LCD_ROWS));
    if (count === 0) {
      return;
    }

    const shift = count * LCD_COLS;
    if (shift >= TEXT_VRAM_SIZE) {
      this.textVram.fill(SPACE_CODE);
      this.dirtyFrame = true;
      return;
    }

    this.textVram.copyWithin(0, shift, TEXT_VRAM_SIZE);
    this.textVram.fill(SPACE_CODE, TEXT_VRAM_SIZE - shift);
    this.dirtyFrame = true;
  }

  private renderFrameBuffer(): void {
    // textVRAM の文字コードを 5x7 グリフへ展開し、1bpp バッファを生成する。
    this.frameBuffer.fill(0);
    const verticalScroll = this.getDisplayStartLine();

    for (let row = 0; row < LCD_ROWS; row += 1) {
      for (let col = 0; col < LCD_COLS; col += 1) {
        const charCode = this.textVram[row * LCD_COLS + col] ?? SPACE_CODE;
        const glyph = getGlyphForCode(charCode);

        const originX = col * LCD_GLYPH_PITCH_X;
        const originY = row * LCD_GLYPH_PITCH_Y;

        for (let y = 0; y < LCD_GLYPH_HEIGHT; y += 1) {
          const bits = glyph[y] ?? 0;
          for (let x = 0; x < LCD_GLYPH_WIDTH; x += 1) {
            if (((bits >> (LCD_GLYPH_WIDTH - 1 - x)) & 0x01) === 0) {
              continue;
            }
            const dstX = originX + x;
            const dstY = (originY + y - verticalScroll + LCD_HEIGHT) % LCD_HEIGHT;
            if (dstX < 0 || dstX >= LCD_WIDTH || dstY < 0 || dstY >= LCD_HEIGHT) {
              continue;
            }
            this.frameBuffer[dstY * LCD_WIDTH + dstX] = 1;
          }
        }
      }
    }

    for (let index = 0; index < this.graphicsPlane.length; index += 1) {
      if (this.graphicsPlane[index] !== 0) {
        this.frameBuffer[index] = 1;
      }
    }

    this.dirtyFrame = false;
  }

  private setGraphicsPixel(x: number, y: number, mode = 1): void {
    const ix = Math.trunc(x);
    const iy = Math.trunc(y);
    if (ix < 0 || ix >= LCD_WIDTH || iy < 0 || iy >= LCD_HEIGHT) {
      return;
    }

    const offset = iy * LCD_WIDTH + ix;
    if (mode === 0) {
      this.graphicsPlane[offset] = 0;
    } else if (mode === 2) {
      this.graphicsPlane[offset] = this.graphicsPlane[offset] ? 0 : 1;
    } else {
      this.graphicsPlane[offset] = 1;
    }

    this.dirtyFrame = true;
  }

  private drawGraphicsLine(x1: number, y1: number, x2: number, y2: number, mode = 1): void {
    let cx = Math.trunc(x1);
    let cy = Math.trunc(y1);
    const tx = Math.trunc(x2);
    const ty = Math.trunc(y2);

    const dx = Math.abs(tx - cx);
    const sx = cx < tx ? 1 : -1;
    const dy = -Math.abs(ty - cy);
    const sy = cy < ty ? 1 : -1;
    let err = dx + dy;

    while (true) {
      this.setGraphicsPixel(cx, cy, mode);
      if (cx === tx && cy === ty) {
        break;
      }
      const e2 = err * 2;
      if (e2 >= dy) {
        err += dy;
        cx += sx;
      }
      if (e2 <= dx) {
        err += dx;
        cy += sy;
      }
    }
  }

  private fillGraphicsArea(x: number, y: number, pattern = 6): void {
    const sx = Math.trunc(x);
    const sy = Math.trunc(y);
    if (sx < 0 || sx >= LCD_WIDTH || sy < 0 || sy >= LCD_HEIGHT) {
      return;
    }

    const seedOffset = sy * LCD_WIDTH + sx;
    const target = this.graphicsPlane[seedOffset] ? 1 : 0;
    const queue: number[] = [seedOffset];
    const visited = new Uint8Array(this.graphicsPlane.length);

    const shouldPaint = (px: number, py: number): boolean => {
      if (pattern <= 1 || pattern >= 6) {
        return true;
      }
      const sum = Math.abs(px + py);
      return sum % pattern === 0;
    };

    while (queue.length > 0) {
      const offset = queue.pop();
      if (offset === undefined || visited[offset]) {
        continue;
      }
      visited[offset] = 1;

      if ((this.graphicsPlane[offset] ? 1 : 0) !== target) {
        continue;
      }

      const px = offset % LCD_WIDTH;
      const py = Math.trunc(offset / LCD_WIDTH);
      if (shouldPaint(px, py)) {
        this.graphicsPlane[offset] = 1;
      }

      if (px > 0) {
        queue.push(offset - 1);
      }
      if (px + 1 < LCD_WIDTH) {
        queue.push(offset + 1);
      }
      if (py > 0) {
        queue.push(offset - LCD_WIDTH);
      }
      if (py + 1 < LCD_HEIGHT) {
        queue.push(offset + LCD_WIDTH);
      }
    }

    this.dirtyFrame = true;
  }

  private drawGraphicsText(text: string): void {
    for (const ch of text) {
      const code = ch.charCodeAt(0) & 0xff;
      if (code === 0x0d) {
        this.graphicCursorX = 0;
        continue;
      }
      if (code === 0x0a) {
        this.graphicCursorX = 0;
        this.graphicCursorY += LCD_GLYPH_PITCH_Y;
        continue;
      }

      const glyph = getGlyphForCode(code);
      for (let y = 0; y < LCD_GLYPH_HEIGHT; y += 1) {
        const bits = glyph[y] ?? 0;
        for (let x = 0; x < LCD_GLYPH_WIDTH; x += 1) {
          if (((bits >> (LCD_GLYPH_WIDTH - 1 - x)) & 0x01) === 0) {
            continue;
          }
          this.setGraphicsPixel(this.graphicCursorX + x, this.graphicCursorY + y, 1);
        }
      }

      this.graphicCursorX += LCD_GLYPH_PITCH_X;
      if (this.graphicCursorX + LCD_GLYPH_WIDTH >= LCD_WIDTH) {
        this.graphicCursorX = 0;
        this.graphicCursorY += LCD_GLYPH_PITCH_Y;
      }
      if (this.graphicCursorY + LCD_GLYPH_HEIGHT >= LCD_HEIGHT) {
        this.graphicCursorY = 0;
      }
    }
  }

  private normalizeFilePath(path: string): string {
    if (path.startsWith('E:') || path.startsWith('e:')) {
      return path.slice(2);
    }
    return path;
  }

  private createBasicMachineAdapter(): BasicMachineAdapter {
    // firmware-monitor から見える操作だけを束ねて公開する。
    return {
      clearLcd: () => {
        this.handleLcdCommand(0x01);
      },
      writeLcdChar: (charCode: number) => {
        this.handleLcdData(charCode & 0xff);
      },
      setDisplayStartLine: (line: number) => {
        const offset = WORKAREA_DISPLAY_START_LINE - RAM_REGION.start;
        this.mainRam[offset] = line & 0x1f;
        this.dirtyFrame = true;
      },
      setTextCursor: (col: number, row: number) => {
        const safeCol = Math.max(0, Math.min(LCD_COLS - 1, col | 0));
        const safeRow = Math.max(0, Math.min(LCD_ROWS - 1, row | 0));
        this.lcdCursor = safeRow * LCD_COLS + safeCol;
      },
      getDisplayStartLine: () => this.getDisplayStartLine(),
      readKeyMatrix: (row: number) => this.keyboardRows[row & 0x07] ?? 0xff,
      in8: (port: number) => this.runtimeIn8(port),
      out8: (port: number, value: number) => this.runtimeOut8(port, value),
      peek8: (address: number) => this.read8(address),
      poke8: (address: number, value: number) => this.write8(address, value),
      waitForEnterKey: () => {},
      setPrintWait: (ticks: number, pauseMode: boolean) => {
        this.printWaitTicks = Math.max(0, Math.trunc(ticks));
        this.printPauseMode = pauseMode;
      },
      openFile: (path: string, mode: 'INPUT' | 'OUTPUT' | 'APPEND') => {
        const normalizedPath = this.normalizeFilePath(path);
        if (mode === 'OUTPUT') {
          this.files.set(normalizedPath, []);
        } else if (!this.files.has(normalizedPath)) {
          this.files.set(normalizedPath, []);
        }

        const handle = this.nextFileHandle;
        this.nextFileHandle += 1;
        this.openFiles.set(handle, { path: normalizedPath, mode, cursor: 0 });
        return handle;
      },
      closeFile: (handle: number) => {
        this.openFiles.delete(Math.trunc(handle));
      },
      readFileValue: (handle: number) => {
        const state = this.openFiles.get(Math.trunc(handle));
        if (!state) {
          return null;
        }
        const lines = this.files.get(state.path) ?? [];
        const value = lines[state.cursor];
        if (value === undefined) {
          return null;
        }
        state.cursor += 1;
        return value;
      },
      writeFileValue: (handle: number, value: string | number) => {
        const state = this.openFiles.get(Math.trunc(handle));
        if (!state) {
          return;
        }

        const lines = this.files.get(state.path) ?? [];
        const text = String(value);
        if (state.mode === 'APPEND') {
          lines.push(text);
        } else if (state.mode === 'OUTPUT') {
          lines[state.cursor] = text;
          state.cursor += 1;
        }

        this.files.set(state.path, lines);
      },
      listFiles: () => [...this.files.keys()].sort((a, b) => a.localeCompare(b)).map((path) => `E:${path}`),
      deleteFile: (path: string) => this.files.delete(this.normalizeFilePath(path)),
      printDeviceWrite: (text: string) => {
        this.printerLines.push(text);
      },
      callMachine: (_address: number, _args: number[]) => 0,
      setGraphicCursor: (x: number, y: number) => {
        this.graphicCursorX = Math.max(0, Math.min(LCD_WIDTH - 1, Math.trunc(x)));
        this.graphicCursorY = Math.max(0, Math.min(LCD_HEIGHT - 1, Math.trunc(y)));
      },
      drawLine: (x1: number, y1: number, x2: number, y2: number, mode = 1) => {
        this.drawGraphicsLine(x1, y1, x2, y2, mode);
      },
      drawPoint: (x: number, y: number, mode = 1) => {
        this.setGraphicsPixel(x, y, mode);
      },
      paintArea: (x: number, y: number, pattern = 6) => {
        this.fillGraphicsArea(x, y, pattern);
      },
      printGraphicText: (text: string) => {
        this.drawGraphicsText(text);
      },
      readInkey: () => {
        const code = this.asciiQueue.shift();
        if (code === undefined) {
          return null;
        }
        return String.fromCharCode(code & 0xff);
      },
      // 非ブロッキング方針: WAIT/BEEP でメインスレッドを塞がない。
      sleepMs: (_ms: number) => {}
    };
  }
}

export type { MonitorRuntimeSnapshot };
