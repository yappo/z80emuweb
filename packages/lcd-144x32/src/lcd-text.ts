import {
  getGlyphForCode,
  hasGlyphForCode,
  LCD_COLS,
  LCD_GLYPH_HEIGHT,
  LCD_GLYPH_PITCH_X,
  LCD_GLYPH_PITCH_Y,
  LCD_GLYPH_WIDTH,
  LCD_ROWS,
  LCD_WIDTH
} from './font5x7';

export const LCD_TEXT_SPACE_CODE = 0x20;

const ALT_GLYPHS = new Map<number, Uint8Array[]>([
  // ASM sample 1 uses a colon glyph lowered by 1px for visual balance.
  [0x3a, [Uint8Array.from([0x00, 0x06, 0x06, 0x00, 0x06, 0x06, 0x00])]]
]);

export function decodeLcdTextFrame(frame: Uint8Array): string[] {
  const lines: string[] = [];
  for (let row = 0; row < LCD_ROWS; row += 1) {
    let line = '';
    for (let col = 0; col < LCD_COLS; col += 1) {
      line += String.fromCharCode(decodeCellCode(frame, col, row));
    }
    lines.push(line);
  }
  return lines;
}

export function decodeMachineText(machine: { getFrameBuffer(): Uint8Array }): string[] {
  return decodeLcdTextFrame(machine.getFrameBuffer());
}

export function decodeCellCode(frame: Uint8Array, col: number, row: number): number {
  const originX = col * LCD_GLYPH_PITCH_X;
  const originY = row * LCD_GLYPH_PITCH_Y;
  let litPixels = 0;
  for (let y = 0; y < LCD_GLYPH_HEIGHT; y += 1) {
    for (let x = 0; x < LCD_GLYPH_WIDTH; x += 1) {
      litPixels += frame[(originY + y) * LCD_WIDTH + (originX + x)] ?? 0;
    }
  }
  if (litPixels <= 1) {
    return LCD_TEXT_SPACE_CODE;
  }

  let bestCode = LCD_TEXT_SPACE_CODE;
  let bestScore = Number.POSITIVE_INFINITY;
  let blankScore = Number.POSITIVE_INFINITY;

  for (let code = 0x20; code <= 0xff; code += 1) {
    if (!hasGlyphForCode(code)) {
      continue;
    }
    const glyphs = [getGlyphForCode(code), ...(ALT_GLYPHS.get(code) ?? [])];
    let score = Number.POSITIVE_INFINITY;
    for (const glyph of glyphs) {
      let glyphScore = 0;
      for (let y = 0; y < LCD_GLYPH_HEIGHT; y += 1) {
        const bits = glyph[y] ?? 0;
        for (let x = 0; x < LCD_GLYPH_WIDTH; x += 1) {
          const expected = ((bits >> (LCD_GLYPH_WIDTH - 1 - x)) & 0x01) !== 0 ? 1 : 0;
          const actual = frame[(originY + y) * LCD_WIDTH + (originX + x)] ?? 0;
          if (expected !== actual) {
            glyphScore += 1;
          }
        }
      }
      if (glyphScore < score) {
        score = glyphScore;
      }
      if (score === 0) {
        break;
      }
    }
    if (score < bestScore) {
      bestScore = score;
      bestCode = code;
      if (score === 0) {
        break;
      }
    }
    if (code === LCD_TEXT_SPACE_CODE) {
      blankScore = score;
    }
  }

  if (bestScore > 4) {
    return LCD_TEXT_SPACE_CODE;
  }
  if (bestCode !== LCD_TEXT_SPACE_CODE && bestScore + 2 >= blankScore) {
    return LCD_TEXT_SPACE_CODE;
  }
  return bestCode;
}
