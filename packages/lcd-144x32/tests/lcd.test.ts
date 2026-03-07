import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  decodeLcdTextFrame,
  getGlyphForCode,
  LCD_HEIGHT,
  LCD_WIDTH,
  Lcd144x32
} from '../src';

const FONT5X7_GOLDEN = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/font5x7-line-seed-20-ff.json', import.meta.url)), 'utf8')
) as Record<string, string[]>;

function toRowBits(glyph: Uint8Array): string[] {
  const rows: string[] = [];
  for (let y = 0; y < 7; y += 1) {
    const bits = glyph[y] ?? 0;
    rows.push(bits.toString(2).padStart(5, '0').slice(-5));
  }
  return rows;
}

describe('lcd-144x32 font', () => {
  it('matches committed font5x7 golden glyphs for complete range 0x20-0xFF', () => {
    for (let code = 0x20; code <= 0xff; code += 1) {
      const expected = FONT5X7_GOLDEN[code.toString(16)];
      expect(toRowBits(getGlyphForCode(code))).toEqual(expected);
    }
  });
});

describe('Lcd144x32', () => {
  it('renders a 144x32 framebuffer', () => {
    const lcd = new Lcd144x32();
    expect(lcd.getFrameBuffer()).toHaveLength(LCD_WIDTH * LCD_HEIGHT);
  });

  it('implements dummy-first reads on primary and secondary paths', () => {
    const lcd = new Lcd144x32();

    void lcd.applyCommand('primary', 0x40);
    void lcd.applyCommand('primary', 0x80);
    lcd.writeData('primary', 0xaa);
    void lcd.applyCommand('primary', 0x40);
    void lcd.applyCommand('primary', 0x80);

    expect(lcd.readData(true)).toBe(0x00);
    expect(lcd.readData(true)).toBe(0xaa);

    void lcd.applyCommand('secondary', 0x40);
    void lcd.applyCommand('secondary', 0x80);
    lcd.writeData('secondary', 0x55);
    void lcd.applyCommand('secondary', 0x40);
    void lcd.applyCommand('secondary', 0x80);

    expect(lcd.readData(false)).toBe(0x00);
    expect(lcd.readData(false)).toBe(0x55);
  });

  it('updates framebuffer text decoding after raw writes', () => {
    const lcd = new Lcd144x32();
    lcd.drawTextCell(0, 0, 'A'.charCodeAt(0));

    expect(decodeLcdTextFrame(lcd.getFrameBuffer())[0]?.startsWith('A')).toBe(true);
  });

  it('supports display start line scroll when producing the framebuffer', () => {
    const lcd = new Lcd144x32();
    lcd.drawPoint(0, 0, 1);
    lcd.setDisplayStartLine(1);

    const frame = lcd.getFrameBuffer();
    expect(frame[31 * LCD_WIDTH + 0]).toBe(1);
  });
});
