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

      if (firstPress) {
        const ascii = this.resolveAsciiCode(mapping.normal, mapping.shifted);
        if (ascii !== undefined) {
          this.asciiQueue.push(ascii);
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

  private resolveAsciiCode(normal?: number, shifted?: number): number | undefined {
    if (normal === undefined) {
      return undefined;
    }
    const shiftActive = this.pressedCodes.has('ShiftLeft') || this.pressedCodes.has('ShiftRight');
    if (shiftActive && shifted !== undefined) {
      return shifted & 0xff;
    }
    if (shiftActive && normal >= 0x41 && normal <= 0x5a) {
      return (normal + 0x20) & 0xff;
    }
    return normal & 0xff;
  }

  private getDisplayStartLine(): number {
    const offset = WORKAREA_DISPLAY_START_LINE - RAM_REGION.start;
    const raw = this.mainRam[offset] ?? 0;
    return raw & 0x1f;
  }

  private handleLcdCommand(command: number): void {
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
      getDisplayStartLine: () => this.getDisplayStartLine(),
      readKeyMatrix: (row: number) => this.keyboardRows[row & 0x07] ?? 0xff,
      in8: (port: number) => this.in8(port),
      out8: (port: number, value: number) => this.out8(port, value)
    };
  }
}

export type { MonitorRuntimeSnapshot };
