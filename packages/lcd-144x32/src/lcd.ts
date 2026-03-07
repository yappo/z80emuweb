import {
  getGlyphForCode,
  LCD_COLS,
  LCD_GLYPH_HEIGHT,
  LCD_GLYPH_PITCH_X,
  LCD_GLYPH_PITCH_Y,
  LCD_GLYPH_WIDTH,
  LCD_HEIGHT,
  LCD_ROWS,
  LCD_WIDTH
} from './font5x7';

const LCD_HALF_WIDTH = LCD_WIDTH / 2;

function clampDisplayStartLine(line: number): number {
  return line & 0x1f;
}

export type LcdTarget = 'primary' | 'secondary';

export class Lcd144x32 {
  private readonly frameBuffer = new Uint8Array(LCD_WIDTH * LCD_HEIGHT);

  private readonly rawVram = new Uint8Array(8 * 0x80);

  private lcdX = 0;
  private lcdY = 0;
  private lcdX2 = 0;
  private lcdY2 = 0;
  private lcdRead = false;

  private dirtyFrame = true;
  private frameRevision = 0;
  private displayStartLine = 0;

  private graphicCursorX = 0;
  private graphicCursorY = 0;

  reset(): void {
    this.lcdX = 0;
    this.lcdY = 0;
    this.lcdX2 = 0;
    this.lcdY2 = 0;
    this.lcdRead = false;
    this.rawVram.fill(0);
    this.graphicCursorX = 0;
    this.graphicCursorY = 0;
    this.dirtyFrame = true;
  }

  getRawVram(): Uint8Array {
    return new Uint8Array(this.rawVram);
  }

  loadRawVram(rawVram: Uint8Array | readonly number[]): void {
    this.rawVram.fill(0);
    this.rawVram.set(Array.from(rawVram, (value) => value & 0xff).slice(0, this.rawVram.length));
    this.dirtyFrame = true;
  }

  setDisplayStartLine(line: number): void {
    const next = clampDisplayStartLine(line);
    if (this.displayStartLine === next) {
      return;
    }
    this.displayStartLine = next;
    this.dirtyFrame = true;
  }

  getFrameBuffer(): Uint8Array {
    if (this.dirtyFrame) {
      this.renderFrameBuffer();
    }
    return this.frameBuffer;
  }

  getFrameRevision(): number {
    if (this.dirtyFrame) {
      this.renderFrameBuffer();
    }
    return this.frameRevision;
  }

  clear(): void {
    this.rawVram.fill(0);
    this.graphicCursorX = 0;
    this.graphicCursorY = 0;
    this.dirtyFrame = true;
  }

  setGraphicCursor(x: number, y: number): void {
    this.graphicCursorX = Math.max(0, Math.min(LCD_WIDTH - 1, Math.trunc(x)));
    this.graphicCursorY = Math.max(0, Math.min(LCD_HEIGHT - 1, Math.trunc(y)));
  }

  applyCommand(target: LcdTarget, command: number): number | undefined {
    this.lcdRead = false;
    switch (command & 0xc0) {
      case 0x00:
        return undefined;
      case 0x40:
        if (target === 'secondary') {
          this.lcdX2 = command & 0x3f;
        } else {
          this.lcdX = command & 0x3f;
        }
        return undefined;
      case 0x80:
        if (target === 'secondary') {
          this.lcdY2 = command & 0x07;
        } else {
          this.lcdY = command & 0x07;
        }
        return undefined;
      case 0xc0:
        return (command >> 3) & 0x07;
      default:
        return undefined;
    }
  }

  writeData(target: LcdTarget, value: number): void {
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
  }

  readData(primary: boolean): number {
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

  clearTextCell(col: number, row: number): void {
    const originX = col * LCD_GLYPH_PITCH_X;
    const originY = row * LCD_GLYPH_PITCH_Y;
    for (let y = 0; y < LCD_GLYPH_PITCH_Y; y += 1) {
      for (let x = 0; x < LCD_GLYPH_PITCH_X; x += 1) {
        this.writeScreenPixel(originX + x, originY + y, 0);
      }
    }
  }

  drawTextCell(col: number, row: number, charCode: number): void {
    this.clearTextCell(col, row);
    this.drawGlyphAt(col * LCD_GLYPH_PITCH_X, row * LCD_GLYPH_PITCH_Y, charCode);
  }

  drawGlyphAt(originX: number, originY: number, charCode: number): void {
    const glyph = getGlyphForCode(charCode);
    for (let y = 0; y < LCD_GLYPH_HEIGHT; y += 1) {
      const bits = glyph[y] ?? 0;
      for (let x = 0; x < LCD_GLYPH_WIDTH; x += 1) {
        if (((bits >> (LCD_GLYPH_WIDTH - 1 - x)) & 0x01) === 0) {
          continue;
        }
        this.writeScreenPixel(originX + x, originY + y, 1);
      }
    }
  }

  scrollUp(lines: number): void {
    const shift = Math.max(0, Math.min(LCD_HEIGHT, Math.trunc(lines)));
    if (shift === 0) {
      return;
    }
    const snapshot = new Uint8Array(LCD_WIDTH * LCD_HEIGHT);
    for (let y = 0; y < LCD_HEIGHT; y += 1) {
      for (let x = 0; x < LCD_WIDTH; x += 1) {
        snapshot[y * LCD_WIDTH + x] = this.readScreenPixel(x, y) ? 1 : 0;
      }
    }
    this.rawVram.fill(0);
    for (let y = 0; y < LCD_HEIGHT - shift; y += 1) {
      for (let x = 0; x < LCD_WIDTH; x += 1) {
        if (snapshot[(y + shift) * LCD_WIDTH + x] !== 0) {
          this.writeScreenPixel(x, y, 1);
        }
      }
    }
    this.dirtyFrame = true;
  }

  drawPoint(x: number, y: number, mode = 1): void {
    this.writeScreenPixel(Math.trunc(x), Math.trunc(y), mode);
  }

  drawLine(x1: number, y1: number, x2: number, y2: number, mode = 1): void {
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
      this.drawPoint(cx, cy, mode);
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

  paintArea(x: number, y: number, pattern = 6): void {
    const sx = Math.trunc(x);
    const sy = Math.trunc(y);
    if (sx < 0 || sx >= LCD_WIDTH || sy < 0 || sy >= LCD_HEIGHT) {
      return;
    }

    const seedOffset = sy * LCD_WIDTH + sx;
    const target = this.readScreenPixel(sx, sy) ? 1 : 0;
    const queue: number[] = [seedOffset];
    const visited = new Uint8Array(LCD_WIDTH * LCD_HEIGHT);

    const shouldPaint = (px: number, py: number): boolean => {
      if (pattern <= 1 || pattern >= 6) {
        return true;
      }
      return Math.abs(px + py) % pattern === 0;
    };

    while (queue.length > 0) {
      const offset = queue.pop();
      if (offset === undefined || visited[offset]) {
        continue;
      }
      visited[offset] = 1;

      const px = offset % LCD_WIDTH;
      const py = Math.trunc(offset / LCD_WIDTH);
      if ((this.readScreenPixel(px, py) ? 1 : 0) !== target) {
        continue;
      }
      if (shouldPaint(px, py)) {
        this.writeScreenPixel(px, py, 1);
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
  }

  printGraphicText(text: string): void {
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

      this.drawGlyphAt(this.graphicCursorX, this.graphicCursorY, code);
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

  private renderFrameBuffer(): void {
    const verticalScroll = this.displayStartLine;
    for (let y = 0; y < LCD_HEIGHT; y += 1) {
      const sourceY = (y + verticalScroll) % LCD_HEIGHT;
      for (let x = 0; x < LCD_WIDTH; x += 1) {
        this.frameBuffer[y * LCD_WIDTH + x] = this.readScreenPixel(x, sourceY) ? 1 : 0;
      }
    }
    this.dirtyFrame = false;
    this.frameRevision = (this.frameRevision + 1) >>> 0;
  }

  private writeScreenPixel(x: number, y: number, mode = 1): void {
    const mapping = this.mapScreenPixel(x, y);
    if (!mapping) {
      return;
    }

    const offset = mapping.page * 0x80 + mapping.x;
    const mask = 1 << mapping.bit;
    const current = this.rawVram[offset] ?? 0;
    let next = current;
    if (mode === 0) {
      next = current & ~mask;
    } else if (mode === 2) {
      next = current ^ mask;
    } else {
      next = current | mask;
    }
    if (next === current) {
      return;
    }
    this.rawVram[offset] = next;
    if (this.dirtyFrame) {
      return;
    }
    this.updateFrameBufferFromRawByte(mapping.x, mapping.page, next);
  }

  private readScreenPixel(x: number, y: number): boolean {
    const mapping = this.mapScreenPixel(x, y);
    if (!mapping) {
      return false;
    }
    const value = this.rawVram[mapping.page * 0x80 + mapping.x] ?? 0;
    return (value & (1 << mapping.bit)) !== 0;
  }

  private mapScreenPixel(x: number, y: number): { x: number; page: number; bit: number } | null {
    const ix = Math.trunc(x);
    const iy = Math.trunc(y);
    if (ix < 0 || ix >= LCD_WIDTH || iy < 0 || iy >= LCD_HEIGHT) {
      return null;
    }

    const page = iy >> 3;
    const bit = iy & 0x07;
    if (ix < LCD_HALF_WIDTH) {
      return { x: ix & 0x7f, page, bit };
    }
    return {
      x: (LCD_HALF_WIDTH - 1 - (ix - LCD_HALF_WIDTH)) & 0x7f,
      page: (page + 4) & 0x07,
      bit
    };
  }

  private updateFrameBufferFromRawByte(rawX: number, rawPage: number, value: number): void {
    if (rawX < 0 || rawX >= LCD_HALF_WIDTH || rawPage < 0 || rawPage >= 8) {
      return;
    }

    const visibleX = rawPage < 4 ? rawX : LCD_HALF_WIDTH + (LCD_HALF_WIDTH - 1 - rawX);
    const sourceBaseY = (rawPage & 0x03) * 8;
    const verticalScroll = this.displayStartLine;

    for (let bit = 0; bit < 8; bit += 1) {
      const sourceY = sourceBaseY + bit;
      const visibleY = (sourceY - verticalScroll + LCD_HEIGHT) % LCD_HEIGHT;
      this.frameBuffer[visibleY * LCD_WIDTH + visibleX] = (value >> bit) & 0x01;
    }

    this.frameRevision = (this.frameRevision + 1) >>> 0;
  }

  private readRawLcdAt(x: number, y: number): number {
    const xx = x & 0x7f;
    const yy = y & 0x07;
    return this.rawVram[yy * 0x80 + xx] ?? 0x00;
  }

  private writeRawLcdAt(x: number, y: number, value: number): void {
    const xx = x & 0x7f;
    const yy = y & 0x07;
    const offset = yy * 0x80 + xx;
    const next = value & 0xff;
    if ((this.rawVram[offset] ?? 0) === next) {
      return;
    }
    this.rawVram[offset] = next;
    if (this.dirtyFrame) {
      return;
    }
    this.updateFrameBufferFromRawByte(xx, yy, next);
  }
}

export function createBlankLcdFrame(): Uint8Array {
  return new Uint8Array(LCD_WIDTH * LCD_HEIGHT);
}

export function getLcdTextGrid(): { cols: number; rows: number } {
  return { cols: LCD_COLS, rows: LCD_ROWS };
}
