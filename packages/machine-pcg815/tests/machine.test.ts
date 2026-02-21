import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  getGlyphForCode,
  getWorkAreaSpec,
  KEY_MAP_BY_CODE,
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

function countLitPixels(glyph: Uint8Array): number {
  let total = 0;
  for (let y = 0; y < 7; y += 1) {
    const bits = glyph[y] ?? 0;
    for (let x = 0; x < 5; x += 1) {
      total += (bits >> x) & 0x1;
    }
  }
  return total;
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

  it('registers extended browser key codes for JIS and numpad keyboards', () => {
    const requiredCodes = [
      'Tab',
      'Escape',
      'Delete',
      'Insert',
      'CapsLock',
      'KanaMode',
      'Convert',
      'NonConvert',
      'IntlYen',
      'IntlRo',
      'Numpad0',
      'Numpad1',
      'Numpad5',
      'Numpad9',
      'NumpadDecimal',
      'NumpadAdd',
      'NumpadSubtract',
      'NumpadMultiply',
      'NumpadDivide',
      'NumpadEqual',
      'NumpadEnter'
    ] as const;

    for (const code of requiredCodes) {
      expect(KEY_MAP_BY_CODE.has(code)).toBe(true);
    }
  });

  it('defines glyphs across half-width katakana range 0xA1-0xDF', () => {
    const fallback = [...getGlyphForCode(0x01)];
    for (let code = 0xa1; code <= 0xdf; code += 1) {
      expect([...getGlyphForCode(code)]).not.toEqual(fallback);
    }
  });

  it('keeps small katakana 0xA7-0xAB lighter than full-size 0xB1-0xB5', () => {
    const pairs = [
      [0xa7, 0xb1], // ァ vs ア
      [0xa8, 0xb2], // ィ vs イ
      [0xa9, 0xb3], // ゥ vs ウ
      [0xaa, 0xb4], // ェ vs エ
      [0xab, 0xb5] // ォ vs オ
    ] as const;

    for (const [smallCode, fullCode] of pairs) {
      const small = countLitPixels(getGlyphForCode(smallCode));
      const full = countLitPixels(getGlyphForCode(fullCode));
      expect(small).toBeLessThan(full);
    }
  });

  it('keeps small katakana 0xAC-0xAF lighter than full-size counterparts', () => {
    const pairs = [
      [0xac, 0xd4], // ャ vs ヤ
      [0xad, 0xd5], // ュ vs ユ
      [0xae, 0xd6], // ョ vs ヨ
      [0xaf, 0xc2] // ッ vs ツ
    ] as const;

    for (const [smallCode, fullCode] of pairs) {
      const small = countLitPixels(getGlyphForCode(smallCode));
      const full = countLitPixels(getGlyphForCode(fullCode));
      expect(small).toBeLessThan(full);
    }
  });

  it('defines glyphs across supplemental range 0x80-0xA0', () => {
    const fallback = [...getGlyphForCode(0x01)];
    for (let code = 0x80; code <= 0xa0; code += 1) {
      expect([...getGlyphForCode(code)]).not.toEqual(fallback);
    }
  });

  it('defines glyphs across lowercase ASCII range 0x61-0x7A', () => {
    const fallback = [...getGlyphForCode(0x01)];
    for (let code = 0x61; code <= 0x7a; code += 1) {
      expect([...getGlyphForCode(code)]).not.toEqual(fallback);
    }
  });

  it('defines glyphs across supplemental range 0xE0-0xFF', () => {
    const fallback = [...getGlyphForCode(0x01)];
    for (let code = 0xe0; code <= 0xff; code += 1) {
      expect([...getGlyphForCode(code)]).not.toEqual(fallback);
    }
  });

  it('matches committed font5x7 golden glyphs for complete range 0x20-0xFF', () => {
    for (let code = 0x20; code <= 0xff; code += 1) {
      const expected = FONT5X7_GOLDEN[code.toString(16)];
      expect(expected, `missing golden for 0x${code.toString(16)}`).toBeDefined();
      expect(toRowBits(getGlyphForCode(code))).toEqual(expected);
    }
  });

  it('passes hardware-map validator', () => {
    const result = validateHardwareMap();
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('PCG815Machine', () => {
  it('defaults to z80-firmware backend and allows ts-compat fallback', () => {
    const defaultMachine = new PCG815Machine();
    expect(defaultMachine.getExecutionBackend()).toBe('z80-firmware');

    const compatMachine = new PCG815Machine({ executionBackend: 'ts-compat' });
    expect(compatMachine.getExecutionBackend()).toBe('ts-compat');
  });

  it('exposes RAM range and allows loading program bytes into RAM window', () => {
    const machine = new PCG815Machine();
    const range = machine.getRamRange();
    expect(range).toEqual({ start: 0x0000, end: 0x7fff });

    machine.loadProgram(Uint8Array.from([0x3e, 0x2a, 0x76]), 0x0200);
    expect(machine.read8(0x0200)).toBe(0x3e);
    expect(machine.read8(0x0201)).toBe(0x2a);
    expect(machine.read8(0x0202)).toBe(0x76);
  });

  it('updates CPU PC with setProgramCounter and validates bounds', () => {
    const machine = new PCG815Machine();
    machine.setProgramCounter(0x1234);
    expect(machine.getCpuState().registers.pc).toBe(0x1234);

    expect(() => machine.setProgramCounter(0x9000)).toThrow(/out of RAM window/i);
  });

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

  it('keeps advancing tstates while HALTed in strict timing mode', () => {
    const machine = new PCG815Machine({ strictCpuOpcodes: true });
    machine.loadProgram(Uint8Array.from([0x76]), 0x0200); // HALT
    machine.setProgramCounter(0x0200);

    run(machine, 64);
    const first = machine.getCpuState();
    expect(first.halted).toBe(true);

    run(machine, 64);
    const second = machine.getCpuState();
    expect(second.halted).toBe(true);
    expect(second.tstates).toBeGreaterThan(first.tstates);
    expect(second.registers.pc).toBe(first.registers.pc);
  });

  it('accepts masked interrupt via IO registers and exits HALT in strict timing mode', () => {
    const machine = new PCG815Machine({ strictCpuOpcodes: true });
    machine.loadProgram(
      Uint8Array.from([
        0xfb, // EI
        0x76 // HALT
      ]),
      0x0200
    );
    machine.loadProgram(Uint8Array.from([0x76]), 0x0038); // HALT at IM1 vector
    machine.setProgramCounter(0x0200);

    run(machine, 128);
    expect(machine.getCpuState().halted).toBe(true);

    machine.out8(0x17, 0x10); // interrupt mask enable bit4
    machine.out8(0x11, 0x10); // raise interrupt type bit4
    run(machine, 256);

    const state = machine.getCpuState();
    expect(state.registers.pc).toBeGreaterThanOrEqual(0x0038);
    expect(state.halted).toBe(true);
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

  it('switches RAM window by port 0x1B bank control', () => {
    const machine = new PCG815Machine();
    const addr = 0x7000;

    machine.out8(0x1b, 0x00);
    machine.write8(addr, 0x11);
    expect(machine.getActiveRamBank()).toBe(0);

    machine.out8(0x1b, 0x04);
    expect(machine.getActiveRamBank()).toBe(1);
    machine.write8(addr, 0x22);
    expect(machine.read8(addr)).toBe(0x22);

    machine.out8(0x1b, 0x00);
    expect(machine.getActiveRamBank()).toBe(0);
    expect(machine.read8(addr)).toBe(0x11);
  });

  it('switches ROM windows by port 0x19 bank control', () => {
    const bankSize = 0x4000;
    const rom = new Uint8Array(bankSize * 4);
    rom.fill(0x11, 0x0000, 0x4000); // system bank0
    rom.fill(0x22, 0x4000, 0x8000); // banked bank0
    rom.fill(0x33, 0x8000, 0xc000); // system bank1
    rom.fill(0x44, 0xc000, 0x10000); // banked bank1

    const machine = new PCG815Machine({ rom });
    expect(machine.read8(0x8000)).toBe(0x11);
    expect(machine.read8(0xc000)).toBe(0x22);

    machine.out8(0x19, 0x11); // exRomBank=1, romBank=1
    expect(machine.getActiveExRomBank()).toBe(1);
    expect(machine.getActiveRomBank()).toBe(1);
    expect(machine.read8(0x8000)).toBe(0x33);
    expect(machine.read8(0xc000)).toBe(0x44);
  });

  it('returns execution domain to firmware when user program RET reaches firmware return address', () => {
    const machine = new PCG815Machine();
    machine.loadProgram(Uint8Array.from([0xc9]), 0x0200); // RET
    const firmwareReturn = machine.getFirmwareReturnAddress();

    machine.write8(0x7ffc, firmwareReturn & 0xff);
    machine.write8(0x7ffd, (firmwareReturn >> 8) & 0xff);
    machine.setStackPointer(0x7ffc);
    machine.setProgramCounter(0x0200);
    machine.setExecutionDomain('user-program');

    run(machine, 64);
    expect(machine.getExecutionDomain()).toBe('firmware');
  });

  it('updates keyboard matrix with active-low semantics', () => {
    const machine = new PCG815Machine();
    machine.out8(0x11, 0x01); // strobe row 0

    machine.setKeyState('KeyA', true);
    expect((machine.in8(0x10) & 0x01) === 0).toBe(true);

    machine.setKeyState('KeyA', false);
    expect((machine.in8(0x10) & 0x01) !== 0).toBe(true);
  });

  it('combines row strobe low/high via ports 0x11/0x12 and reads from 0x10', () => {
    const machine = new PCG815Machine();
    machine.setKeyState('KeyA', true); // row0 col0
    machine.setKeyState('KeyI', true); // row1 col0

    machine.out8(0x11, 0x01); // row0
    expect((machine.in8(0x10) & 0x01) === 0).toBe(true);

    machine.out8(0x11, 0x00);
    machine.out8(0x12, 0x02); // row1 via upper strobe
    expect((machine.in8(0x10) & 0x01) === 0).toBe(true);
  });

  it('implements LCD secondary read with dummy-first behavior on 0x57', () => {
    const machine = new PCG815Machine();
    machine.out8(0x54, 0x40); // X2=0
    machine.out8(0x54, 0x80); // Y2=0
    machine.out8(0x56, 0x41); // write 'A'
    machine.out8(0x54, 0x40); // X2=0
    machine.out8(0x54, 0x80); // Y2=0

    expect(machine.in8(0x57)).toBe(0x00);
    expect(machine.in8(0x57)).toBe(0x41);
  });

  it('writes both LCD regions on port 0x52', () => {
    const machine = new PCG815Machine();
    machine.out8(0x50, 0x40); // X=0/X2=0
    machine.out8(0x50, 0x80); // Y=0/Y2=0
    machine.out8(0x52, 0x5a);
    machine.out8(0x50, 0x40); // X=0/X2=0
    machine.out8(0x50, 0x80); // Y=0/Y2=0

    expect(machine.in8(0x57)).toBe(0x00);
    expect(machine.in8(0x57)).toBe(0x5a);
    expect(machine.in8(0x5b)).toBe(0x5a);
    expect(machine.in8(0x5b)).toBe(0x00);
  });

  it('does not dispatch OUT on 0x10 and 0x1D', () => {
    const machine = new PCG815Machine();
    machine.out8(0x11, 0x55);
    expect(machine.in8(0x10)).toBe(0xff);

    machine.out8(0x10, 0xaa); // no-op by spec
    machine.out8(0x1d, 0xaa); // no-op by spec
    machine.out8(0x11, 0x55);
    expect(machine.in8(0x10)).toBe(0xff);
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

  it('flushes BASIC runtime PRINT output onto LCD text layer', () => {
    const machine = new PCG815Machine();
    machine.runtime.executeLine('PRINT "detekonai"');
    machine.tick(1);

    const lines = machine.getTextLines().join('\n');
    expect(lines).toContain('detekonai');
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

  it('returns 0x78 for unknown IN ports and no-op for unknown OUT ports', () => {
    const machine = new PCG815Machine();
    const before = machine.read8(0x0001);

    expect(machine.in8(0xfe)).toBe(0x78);
    machine.out8(0xfe, 0x77);
    expect(machine.read8(0x0001)).toBe(before);
  });

  it('supports snapshot round-trip', () => {
    const machine = new PCG815Machine();
    machine.setKanaMode(true);
    machine.out8(0x58, 0x01);
    machine.out8(0x5a, 'X'.charCodeAt(0));
    machine.out8(0x19, 0x03);
    machine.out8(0x1b, 0x04);

    const snapshot = machine.createSnapshot();
    const clone = new PCG815Machine();
    clone.loadSnapshot(snapshot);

    expect(clone.getTextLines()[0]?.startsWith('X')).toBe(true);
    expect(clone.getKanaMode()).toBe(true);

    const cloneSnapshot = clone.createSnapshot();
    expect(cloneSnapshot.io.kanaMode).toBe(true);
    expect(cloneSnapshot.io.kanaComposeBuffer).toBe('');
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
