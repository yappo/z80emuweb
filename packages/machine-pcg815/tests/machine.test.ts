import { describe, expect, it } from 'vitest';

import {
  getGlyphForCode,
  getWorkAreaSpec,
  LCD_HEIGHT,
  LCD_WIDTH,
  PCG815_DISPLAY_SPEC,
  PCG815_IO_MAP,
  PCG815_MEMORY_MAP,
  PCG815Machine,
  validateHardwareMap
} from '../src';

function run(machine: PCG815Machine, tstates: number): void {
  machine.tick(tstates);
}

describe('PCG815 hardware map metadata', () => {
  it('covers 16-bit address space without gaps or overlaps', () => {
    const sorted = [...PCG815_MEMORY_MAP].sort((a, b) => a.start - b.start);

    expect(sorted[0]?.start).toBe(0x0000);
    expect(sorted[sorted.length - 1]?.end).toBe(0xffff);

    for (let i = 0; i < sorted.length; i += 1) {
      const current = sorted[i];
      expect(current).toBeDefined();
      if (!current) {
        continue;
      }

      expect(current.start).toBeLessThanOrEqual(current.end);
      expect(current.confidence).toMatch(/^(CONFIRMED|DERIVED|HYPOTHESIS)$/);
      expect(current.evidence.length).toBeGreaterThan(0);

      const next = sorted[i + 1];
      if (!next) {
        continue;
      }

      expect(current.end + 1).toBe(next.start);
    }
  });

  it('requires confidence and evidence for all I/O ports', () => {
    const seenPorts = new Set<number>();
    const seenIds = new Set<string>();

    for (const entry of PCG815_IO_MAP) {
      expect(entry.port).toBeGreaterThanOrEqual(0x00);
      expect(entry.port).toBeLessThanOrEqual(0xff);
      expect(entry.confidence).toMatch(/^(CONFIRMED|DERIVED|HYPOTHESIS)$/);
      expect(entry.evidence.length).toBeGreaterThan(0);
      expect(seenPorts.has(entry.port)).toBe(false);
      expect(seenIds.has(entry.id)).toBe(false);
      seenPorts.add(entry.port);
      seenIds.add(entry.id);
    }
  });

  it('exposes 144x32 LCD display baseline', () => {
    expect(PCG815_DISPLAY_SPEC.width).toBe(144);
    expect(PCG815_DISPLAY_SPEC.height).toBe(32);
    expect(PCG815_DISPLAY_SPEC.textCols).toBe(24);
    expect(PCG815_DISPLAY_SPEC.textRows).toBe(4);
  });

  it('defines glyphs for symbol keys used by browser keyboard mapping', () => {
    const fallback = [...getGlyphForCode(0x01)];
    const requiredSymbols = [0x24, 0x25, 0x26, 0x27, 0x5e, 0x60, 0x7b, 0x7d, 0x7e, 0x5c] as const;

    for (const code of requiredSymbols) {
      expect([...getGlyphForCode(code)]).not.toEqual(fallback);
    }
  });

  it('passes hardware-map validator', () => {
    const result = validateHardwareMap();
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('PCG815Machine', () => {
  it('boots monitor and shows prompt text', () => {
    const machine = new PCG815Machine({ strictCpuOpcodes: true });
    run(machine, 240_000);

    const lines = machine.getTextLines().join('\n');
    expect(lines).toContain('PC-G815 COMPAT');
    expect(lines).toContain('BASIC READY');
  });

  it('lights LCD pixels after monitor boot sequence', () => {
    const machine = new PCG815Machine({ strictCpuOpcodes: true });
    run(machine, 260_000);

    const frame = machine.getFrameBuffer();
    const litCount = frame.reduce((sum, bit) => sum + bit, 0);
    expect(litCount).toBeGreaterThan(0);
  });

  it('boots and lights LCD pixels with strict opcode mode disabled', () => {
    const machine = new PCG815Machine({ strictCpuOpcodes: false });
    run(machine, 260_000);

    const lines = machine.getTextLines().join('\n');
    expect(lines).toContain('PC-G815 COMPAT');

    const frame = machine.getFrameBuffer();
    const litCount = frame.reduce((sum, bit) => sum + bit, 0);
    expect(litCount).toBeGreaterThan(0);
  });

  it('uses RAM window as writable and ROM windows as read-only', () => {
    const machine = new PCG815Machine();

    machine.write8(0x0000, 0xa5);
    machine.write8(0x7fff, 0x5a);
    expect(machine.read8(0x0000)).toBe(0xa5);
    expect(machine.read8(0x7fff)).toBe(0x5a);

    const romLowBefore = machine.read8(0x8000);
    const romHighBefore = machine.read8(0xc000);
    machine.write8(0x8000, romLowBefore ^ 0xff);
    machine.write8(0xc000, romHighBefore ^ 0xff);
    expect(machine.read8(0x8000)).toBe(romLowBefore);
    expect(machine.read8(0xc000)).toBe(romHighBefore);
  });

  it('updates keyboard matrix with active-low semantics', () => {
    const machine = new PCG815Machine();
    machine.out8(0x10, 0x00); // select row 0

    machine.setKeyState('KeyA', true);
    expect((machine.in8(0x11) & 0x01) === 0).toBe(true);

    machine.setKeyState('KeyA', false);
    expect((machine.in8(0x11) & 0x01) !== 0).toBe(true);
  });

  it('generates ASCII queue from browser key events', () => {
    const machine = new PCG815Machine();

    machine.setKeyState('KeyP', true);
    machine.setKeyState('KeyP', false);

    const code = machine.in8(0x12);
    expect(String.fromCharCode(code)).toBe('P');
  });

  it('renders LCD framebuffer from LCD ports 0x58/0x5A', () => {
    const machine = new PCG815Machine();
    machine.out8(0x58, 0x01); // clear
    machine.out8(0x58, 0x80); // cursor home
    machine.out8(0x5a, 'A'.charCodeAt(0));

    const frame = machine.getFrameBuffer();
    expect(frame.length).toBe(LCD_WIDTH * LCD_HEIGHT);
    const litCount = frame.reduce((sum, bit) => sum + bit, 0);
    expect(litCount).toBeGreaterThan(0);
  });

  it('executes CLS through basic runtime machine adapter', () => {
    const machine = new PCG815Machine();
    machine.out8(0x58, 0x01);
    machine.out8(0x58, 0x80);
    machine.out8(0x5a, 'A'.charCodeAt(0));
    expect(machine.getTextLines()[0]?.startsWith('A')).toBe(true);

    machine.runtime.executeLine('CLS');
    const lines = machine.getTextLines();
    expect(lines[0]?.startsWith(' ')).toBe(true);
  });

  it('scrolls upward on line-feed at the last row instead of wrapping to top', () => {
    const machine = new PCG815Machine();
    machine.out8(0x58, 0x01);
    machine.out8(0x58, 0x80);

    for (let i = 0; i < 4; i += 1) {
      machine.out8(0x5a, 'A'.charCodeAt(0) + i);
      machine.out8(0x5a, 0x0d);
      machine.out8(0x5a, 0x0a);
    }

    const lines = machine.getTextLines();
    expect(lines[0]?.startsWith('B')).toBe(true);
    expect(lines[1]?.startsWith('C')).toBe(true);
    expect(lines[2]?.startsWith('D')).toBe(true);
    expect(lines[3]?.startsWith(' ')).toBe(true);
  });

  it('scrolls when writing past the last cell instead of wrapping to top-left', () => {
    const machine = new PCG815Machine();
    machine.out8(0x58, 0x01); // clear
    machine.out8(0x58, 0xdf); // cursor to last text cell (0x80 | 95)

    machine.out8(0x5a, 'A'.charCodeAt(0));
    machine.out8(0x5a, 'B'.charCodeAt(0));

    const lines = machine.getTextLines();
    expect(lines[0]?.startsWith('B')).toBe(false);
    expect(lines[3]?.startsWith('B')).toBe(true);
  });

  it('returns 0xFF for unknown IN ports and no-op for unknown OUT ports', () => {
    const machine = new PCG815Machine();
    const before = machine.read8(0x0001);

    expect(machine.in8(0xfe)).toBe(0xff);
    machine.out8(0xfe, 0x77);
    expect(machine.read8(0x0001)).toBe(before);
  });

  it('supports snapshot round-trip', () => {
    const machine = new PCG815Machine();
    machine.out8(0x58, 0x01);
    machine.out8(0x5a, 'X'.charCodeAt(0));
    machine.out8(0x19, 0x03);
    machine.out8(0x1b, 0x04);
    machine.setKeyState('Digit1', true);
    machine.setKeyState('Digit1', false);

    const snapshot = machine.createSnapshot();
    const clone = new PCG815Machine();
    clone.loadSnapshot(snapshot);

    expect(clone.getTextLines()[0]?.startsWith('X')).toBe(true);
    expect(clone.in8(0x12)).toBe('1'.charCodeAt(0));

    const cloneSnapshot = clone.createSnapshot();
    expect(cloneSnapshot.io.romBankSelect).toBe(0x03);
    expect(cloneSnapshot.io.expansionControl).toBe(0x04);
  });

  it('applies display start-line work area scroll from 0x790D candidate', () => {
    const machine = new PCG815Machine();
    const startLineAddress = getWorkAreaSpec('display-start-line').address;

    machine.out8(0x58, 0x01);
    machine.out8(0x58, 0x80);
    machine.out8(0x5a, 'A'.charCodeAt(0));

    const before = machine.getFrameBuffer().slice();
    const litBefore = before.reduce((sum, bit) => sum + bit, 0);

    machine.write8(startLineAddress, 1);
    const after = machine.getFrameBuffer().slice();
    const litAfter = after.reduce((sum, bit) => sum + bit, 0);

    expect(after).not.toEqual(before);
    expect(litAfter).toBe(litBefore);
  });
});
