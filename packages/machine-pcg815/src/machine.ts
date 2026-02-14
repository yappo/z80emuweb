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

const PORT_KEYBOARD_ROW_SELECT = getIoPortSpec('kbd-row-select').port;
const PORT_KEYBOARD_ROW_DATA = getIoPortSpec('kbd-row-data').port;
const PORT_KEYBOARD_ASCII_FIFO = getIoPortSpec('kbd-ascii-fifo').port;
const PORT_ROM_BANK_SELECT = getIoPortSpec('bank-rom-select').port;
const PORT_EXPANSION_CONTROL = getIoPortSpec('bank-expansion-control').port;
const PORT_RUNTIME_INPUT = getIoPortSpec('runtime-input').port;
const PORT_RUNTIME_OUTPUT = getIoPortSpec('runtime-output').port;
const PORT_LCD_COMMAND = getIoPortSpec('lcd-command').port;
const PORT_LCD_DATA = getIoPortSpec('lcd-data').port;
const PORT_LCD_STATUS = getIoPortSpec('lcd-status').port;
const PORT_LCD_STATUS_MIRROR = getIoPortSpec('lcd-status-mirror').port;

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

  private readonly keyboardRows = new Uint8Array(8);

  private readonly pressedCodes = new Set<string>();

  private readonly asciiQueue: number[] = [];

  private kanaMode = false;
  private kanaComposeBuffer = '';

  private selectedKeyRow = 0;

  private lcdCursor = 0;

  private romBankSelect = 0;

  private expansionControl = 0;

  private dirtyFrame = true;

  private elapsedTStates = 0;

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
    }

    this.keyboardRows.fill(0xff);
    this.pressedCodes.clear();
    this.asciiQueue.length = 0;
    this.kanaMode = false;
    this.kanaComposeBuffer = '';
    this.selectedKeyRow = 0;
    this.lcdCursor = 0;
    this.romBankSelect = 0;
    this.expansionControl = 0;

    this.runtime.reset(cold);
    this.cpu.reset();
    this.dirtyFrame = true;
    this.elapsedTStates = 0;
  }

  tick(tstates: number): void {
    const clamped = Math.max(0, Math.floor(tstates));
    this.cpu.stepTState(clamped);
    this.elapsedTStates += clamped;
    this.runtime.pump();
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
        if (asciiCodes.length > 0) {
          this.asciiQueue.push(...asciiCodes);
        }
      }
      return;
    }

    this.pressedCodes.delete(code);
    const currentRowState = this.keyboardRows[mapping.row] ?? 0xff;
    this.keyboardRows[mapping.row] = currentRowState | rowMask;
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
        selectedKeyRow: this.selectedKeyRow,
        keyboardRows: [...this.keyboardRows],
        asciiQueue: [...this.asciiQueue],
        kanaMode: this.kanaMode,
        kanaComposeBuffer: this.kanaComposeBuffer,
        romBankSelect: this.romBankSelect,
        expansionControl: this.expansionControl,
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

    this.selectedKeyRow = snapshot.io.selectedKeyRow & 0x07;
    this.keyboardRows.fill(0xff);
    this.keyboardRows.set(snapshot.io.keyboardRows.map((v) => v & 0xff).slice(0, this.keyboardRows.length));

    this.asciiQueue.length = 0;
    this.asciiQueue.push(...snapshot.io.asciiQueue.map((v) => v & 0xff));
    this.kanaMode = Boolean(snapshot.io.kanaMode);
    this.kanaComposeBuffer = snapshot.io.kanaComposeBuffer ?? '';

    this.romBankSelect = snapshot.io.romBankSelect & 0xff;
    this.expansionControl = snapshot.io.expansionControl & 0xff;

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
      return 0xff;
    }

    switch (portSpec.port & 0xff) {
      case PORT_KEYBOARD_ROW_DATA:
        return this.keyboardRows[this.selectedKeyRow] ?? 0xff;
      case PORT_KEYBOARD_ASCII_FIFO:
        // FIFO は読み出しで消費される。
        return this.asciiQueue.shift() ?? 0x00;
      case PORT_LCD_STATUS:
      case PORT_LCD_STATUS_MIRROR:
        return this.lcdCursor & 0xff;
      case PORT_RUNTIME_OUTPUT:
        return this.runtime.popOutputChar();
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
      case PORT_KEYBOARD_ROW_SELECT:
        this.selectedKeyRow = byte & 0x07;
        return;
      case PORT_ROM_BANK_SELECT:
        this.romBankSelect = byte;
        return;
      case PORT_EXPANSION_CONTROL:
        this.expansionControl = byte;
        return;
      case PORT_RUNTIME_INPUT:
        // モニタ実行系への入力チャネル。
        this.runtime.receiveChar(byte);
        return;
      case PORT_LCD_COMMAND:
        this.handleLcdCommand(byte);
        return;
      case PORT_LCD_DATA:
        this.handleLcdData(byte);
        return;
      default:
        return;
    }
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

    this.dirtyFrame = false;
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
      in8: (port: number) => this.in8(port),
      out8: (port: number, value: number) => this.out8(port, value),
      peek8: (address: number) => this.read8(address),
      poke8: (address: number, value: number) => this.write8(address, value),
      // 非ブロッキング方針: WAIT/BEEP でメインスレッドを塞がない。
      sleepMs: (_ms: number) => {}
    };
  }
}

export type { MonitorRuntimeSnapshot };
