// モニタ ROM は 16KiB 窓を前提に作成する。
const ROM_SIZE = 0x4000;
const LCD_WIDTH = 144;
const LCD_HALF_WIDTH = LCD_WIDTH / 2;
const LCD_GLYPH_WIDTH = 5;
const LCD_GLYPH_HEIGHT = 7;
const LCD_GLYPH_PITCH_X = 6;
const LCD_GLYPH_PITCH_Y = 8;
const LCD_SECONDARY_CMD_PORT = 0x54;
const LCD_SECONDARY_DATA_PORT = 0x56;
const LCD_PRIMARY_CMD_PORT = 0x58;
const LCD_PRIMARY_DATA_PORT = 0x5a;
const KEY_STROBE_PORT = 0x11;
const KEY_READ_PORT = 0x10;

export const MONITOR_PROMPT_RESUME_ADDR = 0x0287;
export const MONITOR_MAIN_LOOP_ADDR = 0x02a3;
export const MONITOR_PROMPT_CURSOR_COL = 2;
export const MONITOR_PROMPT_CURSOR_ROW = 2;

const BOOT_LINES = ['PC-G815 COMPAT', 'BASIC READY', '> '];
const RESUME_LINES = ['', '', '> '];

function row(bits: string): number {
  return Number.parseInt(bits, 2) & 0x1f;
}

const BOOT_GLYPHS = new Map<string, readonly number[]>([
  [' ', [row('00000'), row('00000'), row('00000'), row('00000'), row('00000'), row('00000'), row('00000')]],
  ['-', [row('00000'), row('00000'), row('00000'), row('11111'), row('00000'), row('00000'), row('00000')]],
  ['1', [row('00100'), row('01100'), row('00100'), row('00100'), row('00100'), row('00100'), row('01110')]],
  ['5', [row('11111'), row('10000'), row('10000'), row('11110'), row('00001'), row('00001'), row('11110')]],
  ['8', [row('01110'), row('10001'), row('10001'), row('01110'), row('10001'), row('10001'), row('01110')]],
  ['>', [row('01000'), row('00100'), row('00010'), row('00001'), row('00010'), row('00100'), row('01000')]],
  ['A', [row('01110'), row('10001'), row('10001'), row('11111'), row('10001'), row('10001'), row('10001')]],
  ['B', [row('11110'), row('10001'), row('10001'), row('11110'), row('10001'), row('10001'), row('11110')]],
  ['C', [row('01110'), row('10001'), row('10000'), row('10000'), row('10000'), row('10001'), row('01110')]],
  ['D', [row('11100'), row('10010'), row('10001'), row('10001'), row('10001'), row('10010'), row('11100')]],
  ['E', [row('11111'), row('10000'), row('10000'), row('11110'), row('10000'), row('10000'), row('11111')]],
  ['G', [row('01110'), row('10001'), row('10000'), row('10111'), row('10001'), row('10001'), row('01110')]],
  ['I', [row('01110'), row('00100'), row('00100'), row('00100'), row('00100'), row('00100'), row('01110')]],
  ['M', [row('10001'), row('11011'), row('10101'), row('10101'), row('10001'), row('10001'), row('10001')]],
  ['O', [row('01110'), row('10001'), row('10001'), row('10001'), row('10001'), row('10001'), row('01110')]],
  ['P', [row('11110'), row('10001'), row('10001'), row('11110'), row('10000'), row('10000'), row('10000')]],
  ['R', [row('11110'), row('10001'), row('10001'), row('11110'), row('10100'), row('10010'), row('10001')]],
  ['S', [row('01110'), row('10001'), row('10000'), row('01110'), row('00001'), row('10001'), row('01110')]],
  ['T', [row('11111'), row('00100'), row('00100'), row('00100'), row('00100'), row('00100'), row('00100')]],
  ['Y', [row('10001'), row('10001'), row('01010'), row('00100'), row('00100'), row('00100'), row('00100')]]
]);

function getGlyph(ch: string): readonly number[] {
  return BOOT_GLYPHS.get(ch) ?? BOOT_GLYPHS.get(' ')!;
}

function setVisiblePixel(rawPages: Uint8Array, x: number, y: number): void {
  if (x < 0 || x >= LCD_WIDTH || y < 0 || y >= 32) {
    return;
  }
  const page = y >> 3;
  const bit = y & 0x07;
  let rawPage = page;
  let rawX = x;
  if (x >= LCD_HALF_WIDTH) {
    rawPage = (page + 4) & 0x07;
    rawX = LCD_WIDTH - 1 - x;
  }
  rawPages[rawPage * LCD_HALF_WIDTH + rawX]! |= 1 << bit;
}

function drawGlyph(rawPages: Uint8Array, originX: number, originY: number, ch: string): void {
  const glyph = getGlyph(ch);
  for (let y = 0; y < LCD_GLYPH_HEIGHT; y += 1) {
    const bits = glyph[y] ?? 0;
    for (let x = 0; x < LCD_GLYPH_WIDTH; x += 1) {
      if (((bits >> (LCD_GLYPH_WIDTH - 1 - x)) & 0x01) === 0) {
        continue;
      }
      setVisiblePixel(rawPages, originX + x, originY + y);
    }
  }
}

function buildRawPages(lines: readonly string[]): Uint8Array {
  const rawPages = new Uint8Array(8 * LCD_HALF_WIDTH);
  lines.forEach((line, rowIndex) => {
    const originY = rowIndex * LCD_GLYPH_PITCH_Y;
    [...line].forEach((ch, colIndex) => {
      drawGlyph(rawPages, colIndex * LCD_GLYPH_PITCH_X, originY, ch);
    });
  });
  return rawPages;
}

function emitLdAOut(code: number[], value: number, port: number): void {
  code.push(0x3e, value & 0xff, 0xd3, port & 0xff);
}

function emitPageSpan(code: number[], rawPages: Uint8Array, page: number, rawStart: number, rawEnd: number): void {
  let first = -1;
  let last = -1;
  for (let x = rawStart; x <= rawEnd; x += 1) {
    const value = rawPages[page * LCD_HALF_WIDTH + x] ?? 0;
    if (value === 0) {
      continue;
    }
    if (first < 0) {
      first = x;
    }
    last = x;
  }
  if (first < 0 || last < 0) {
    return;
  }

  const isSecondary = rawStart === 0;
  const cmdPort = isSecondary ? LCD_SECONDARY_CMD_PORT : LCD_PRIMARY_CMD_PORT;
  const dataPort = isSecondary ? LCD_SECONDARY_DATA_PORT : LCD_PRIMARY_DATA_PORT;
  const xBase = isSecondary ? 0 : 60;

  emitLdAOut(code, 0x40 | ((first - xBase) & 0x3f), cmdPort);
  emitLdAOut(code, 0x80 | (page & 0x07), cmdPort);
  for (let x = first; x <= last; x += 1) {
    emitLdAOut(code, rawPages[page * LCD_HALF_WIDTH + x] ?? 0, dataPort);
  }
}

function buildBootDrawCode(): number[] {
  const rawPages = buildRawPages(BOOT_LINES);
  const resumeRawPages = buildRawPages(RESUME_LINES);
  const code: number[] = [0x31, 0xff, 0x7f];

  for (let page = 0; page < 8; page += 1) {
    emitPageSpan(code, rawPages, page, 0, 59);
    emitPageSpan(code, rawPages, page, 60, 71);
  }

  while (code.length < MONITOR_PROMPT_RESUME_ADDR) {
    code.push(0x00);
  }

  emitPageSpan(code, resumeRawPages, 2, 0, 59);

  while (code.length < MONITOR_MAIN_LOOP_ADDR) {
    code.push(0x00);
  }

  code.push(
    0x3e,
    0xff, // LD A,FFh
    0xd3,
    KEY_STROBE_PORT, // OUT (11h),A
    0xdb,
    KEY_READ_PORT, // IN A,(10h)
    0x18,
    0xf8 // JR main_loop
  );

  return code;
}

// 起動画面と簡易 I/O ループだけを持つ最小ブート ROM。
export function createMonitorRom(): Uint8Array {
  const rom = new Uint8Array(ROM_SIZE);
  rom.set(buildBootDrawCode().slice(0, ROM_SIZE), 0);
  return rom;
}
