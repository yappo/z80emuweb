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

function encodeBasicLines(lines: readonly string[]): number[] {
  const bytes: number[] = [];
  for (const line of lines) {
    for (const ch of line) {
      bytes.push(ch.charCodeAt(0) & 0xff);
    }
    bytes.push(0x0d);
  }
  return bytes;
}

function runBasic(machine: PCG815Machine, lines: readonly string[]): void {
  machine.runBasicInterpreter(encodeBasicLines(lines), { appendEot: true });
}

function readBasicVariable(machine: PCG815Machine, name: string): number | undefined {
  const upper = name.toUpperCase();
  const key1 = upper.charCodeAt(0) || 0;
  const key2 = upper.charCodeAt(1) || 0;
  const key3 = upper.charCodeAt(2) || 0;
  const base = 0x6c00;
  for (let i = 0; i < 64; i += 1) {
    const addr = base + i * 6;
    if (machine.read8(addr) !== key1) {
      continue;
    }
    if (machine.read8(addr + 1) !== key2) {
      continue;
    }
    if (machine.read8(addr + 2) !== key3) {
      continue;
    }
    return machine.read8(addr + 3) | (machine.read8(addr + 4) << 8);
  }
  return undefined;
}

function listBasicVariableKeys(machine: PCG815Machine): string[] {
  const keys: string[] = [];
  const base = 0x6c00;
  for (let i = 0; i < 64; i += 1) {
    const addr = base + i * 6;
    const k1 = machine.read8(addr);
    if (k1 === 0) {
      continue;
    }
    const k2 = machine.read8(addr + 1);
    const k3 = machine.read8(addr + 2);
    const chars = [k1, k2, k3]
      .filter((code) => code !== 0)
      .map((code) => String.fromCharCode(code))
      .join('');
    keys.push(chars);
  }
  return keys;
}

const BASIC_COMMANDS = [
  'NEW', 'LIST', 'RUN', 'PRINT', 'LET', 'INPUT', 'GOTO', 'GOSUB', 'RETURN', 'END', 'STOP', 'CONT', 'IF', 'CLS', 'REM',
  'FOR', 'NEXT', 'DIM', 'DATA', 'READ', 'RESTORE', 'POKE', 'OUT', 'BEEP', 'WAIT', 'LOCATE', 'AUTO', 'BLOAD', 'BSAVE',
  'FILES', 'HDCOPY', 'PAINT', 'CIRCLE', 'PASS', 'PIOSET', 'PIOPUT', 'SPOUT', 'SPINP', 'REPEAT', 'UNTIL', 'WHILE',
  'WEND', 'LNINPUT', 'CLEAR', 'DELETE', 'ERASE', 'ON', 'RANDOMIZE', 'RENUM', 'USING', 'MON', 'OPEN', 'CLOSE', 'LOAD',
  'SAVE', 'LFILES', 'LCOPY', 'KILL', 'CALL', 'GCURSOR', 'GPRINT', 'LINE', 'PSET', 'PRESET', 'ELSE', 'EMPTY'
] as const;

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

  it('reports BASIC engine configuration defaults', () => {
    const machine = new PCG815Machine();
    const status = machine.getBasicEngineStatus();
    expect(status.entry).toBe(0xc000);
    expect(status.romBank).toBe(0x0f);
    expect(status.basicRamStart).toBe(0x4000);
    expect(status.basicRamEnd).toBe(0x6fff);
    expect(status.executionBackend).toBe('z80-firmware');
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

  it('feeds BASIC console input via firmware bridge ports 0x1D/0x1C', () => {
    const machine = new PCG815Machine();
    machine.resetFirmwareIoStats();

    const line = 'PRINT 42';
    const bytes = [...line].map((ch) => ch.charCodeAt(0));
    bytes.push(0x0d);

    machine.runFirmwareInputBridge(bytes);
    run(machine, 40_000);

    const lines = machine.getTextLines().join('\n');
    expect(lines).toContain('42');

    const stats = machine.getFirmwareIoStats();
    expect(stats.queuedBytes).toBe(bytes.length + 1); // + EOT
    expect(stats.consumedBytes).toBe(stats.queuedBytes);
    expect(stats.pendingBytes).toBe(0);
    expect(stats.inReads).toBeGreaterThanOrEqual(stats.consumedBytes);
    expect(stats.outWrites).toBeGreaterThan(0);
    expect(stats.eotWrites).toBe(1);
  });

  it('boots BASIC interpreter from ROM bank 0x0F and entry 0xC000', () => {
    const machine = new PCG815Machine();
    machine.resetFirmwareIoStats();

    runBasic(machine, ['NEW', '10 PRINT 42', 'RUN']);
    run(machine, 40_000);

    const status = machine.getBasicEngineStatus();
    expect(status.activeRomBank).toBe(0x0f);
    expect(machine.getActiveRomBank()).toBe(0x0f);
    expect(status.executionDomain).toBe('firmware');
    expect(machine.getTextLines().join('\n')).toContain('42');
  });

  it('keeps reserved RAM 0x7000-0x7FFF untouched by BASIC interpreter program store', () => {
    const machine = new PCG815Machine();
    machine.write8(0x7000, 0x5a);

    const lines: string[] = ['NEW'];
    for (let i = 10; i <= 400; i += 10) {
      lines.push(`${i} PRINT ${i}`);
    }
    lines.push('RUN');

    runBasic(machine, lines);
    expect(machine.read8(0x7000)).toBe(0x5a);
    const status = machine.getBasicEngineStatus();
    expect(status.basicRamStart).toBe(0x4000);
    expect(status.basicRamEnd).toBe(0x6fff);
  });

  it('keeps BASIC execution alive under prior ROM/RAM bank switches', () => {
    const machine = new PCG815Machine();
    machine.out8(0x19, 0x03);
    machine.out8(0x1b, 0x04);

    runBasic(machine, ['PRINT 99']);

    expect(machine.getTextLines().join('\n')).toContain('99');
    expect(machine.getActiveRomBank()).toBe(0x0f);
  });

  it('completes BASIC interpreter run only after reaching firmware return address', () => {
    const machine = new PCG815Machine();
    machine.setFirmwareReturnAddress(0x0123);
    runBasic(machine, ['PRINT 11']);

    expect(machine.getExecutionDomain()).toBe('firmware');
    expect(machine.getCpuState().registers.pc & 0xffff).not.toBe(0xc000);
  });

  it('accepts every BASIC command keyword on Z80 interpreter path', () => {
    const machine = new PCG815Machine();
    for (const command of BASIC_COMMANDS) {
      runBasic(machine, [command]);
      expect(machine.getExecutionDomain()).toBe('firmware');
    }
  });

  it('accepts one abnormal invocation per BASIC command keyword', () => {
    const machine = new PCG815Machine();
    for (const command of BASIC_COMMANDS) {
      runBasic(machine, [`${command} ???`]);
      expect(machine.getExecutionDomain()).toBe('firmware');
    }
  });

  it('renders OUT 90 text on row 3 via LOCATE in Z80 BASIC path', () => {
    const machine = new PCG815Machine();
    const prompt = 'PUSH SPACE KEY !';
    const lines = ['NEW', '10 LOCATE 4,3'];
    let lineNumber = 20;
    for (const ch of prompt) {
      lines.push(`${lineNumber} OUT 90,${ch.charCodeAt(0) & 0xff}`);
      lineNumber += 10;
    }
    lines.push(`${lineNumber} WAIT 3`);
    lineNumber += 10;
    lines.push(`${lineNumber} GOTO ${lineNumber - 10}`);
    lines.push('RUN');

    runBasic(machine, lines);

    const screen = machine.getTextLines();
    expect(screen.join('\n')).toContain(prompt);
  }, 15_000);

  it('blinks PUSH SPACE KEY line in sample intro loop', () => {
    const machine = new PCG815Machine();
    runBasic(machine, [
      'NEW',
      '9500 CLS',
      '9510 LOCATE 0,0',
      '9520 PRINT "     MASE 4X4 GAME !"',
      '9530 LOCATE 0,1',
      '9540 PRINT "&=YOU #=WALL Key Goal"',
      '9550 LOCATE 0,2',
      '9560 PRINT "USE: WASD OR ARROWS"',
      '9570 LET SPH=0',
      '9580 LET SPC=0',
      '9590 LET BL=1',
      '9600 LET CT=0',
      '9610 GOSUB 7600',
      '9620 GOSUB 7400',
      '9630 IF SP=1 THEN 9810',
      '9640 LET CT=CT+1',
      '9650 IF CT<16 THEN 9760',
      '9660 LET CT=0',
      '9670 IF BL=0 THEN 9730',
      '9680 LET BL=0',
      '9690 GOSUB 7800',
      '9700 GOTO 9760',
      '9730 LET BL=1',
      '9740 GOSUB 7600',
      '9760 WAIT 3',
      '9770 GOTO 9620',
      '9810 RETURN',
      '7400 LET SP=0',
      '7410 LET Q=0',
      '7420 OUT 17,128',
      '7430 LET R=INP(16)',
      '7440 IF R=239 THEN 7460',
      '7450 GOTO 7480',
      '7460 LET Q=1',
      '7480 IF Q=0 THEN 7540',
      '7490 IF SPH=0 THEN 7510',
      '7500 RETURN',
      '7510 LET SPH=1',
      '7520 LET SPC=1',
      '7530 RETURN',
      '7540 IF SPH=0 THEN 7590',
      '7550 LET SPH=0',
      '7560 IF SPC=0 THEN 7590',
      '7570 LET SP=1',
      '7580 LET SPC=0',
      '7590 RETURN',
      '7600 LOCATE 4,3',
      '7610 OUT 90,80',
      '7620 OUT 90,85',
      '7630 OUT 90,83',
      '7640 OUT 90,72',
      '7650 OUT 90,32',
      '7660 OUT 90,83',
      '7670 OUT 90,80',
      '7680 OUT 90,65',
      '7690 OUT 90,67',
      '7700 OUT 90,69',
      '7710 OUT 90,32',
      '7720 OUT 90,75',
      '7730 OUT 90,69',
      '7740 OUT 90,89',
      '7750 OUT 90,32',
      '7760 OUT 90,33',
      '7770 RETURN',
      '7800 LOCATE 4,3',
      '7810 OUT 90,32',
      '7820 OUT 90,32',
      '7830 OUT 90,32',
      '7840 OUT 90,32',
      '7850 OUT 90,32',
      '7860 OUT 90,32',
      '7870 OUT 90,32',
      '7880 OUT 90,32',
      '7890 OUT 90,32',
      '7900 OUT 90,32',
      '7910 OUT 90,32',
      '7920 OUT 90,32',
      '7930 OUT 90,32',
      '7940 OUT 90,32',
      '7950 OUT 90,32',
      '7960 OUT 90,32',
      '7970 RETURN',
      'RUN'
    ]);

    let sawText = false;
    let sawBlank = false;
    for (let i = 0; i < 2000; i += 1) {
      run(machine, 40_000);
      const line3 = machine.getTextLines()[3] ?? '';
      if (line3.includes('PUSH SPACE KEY !')) {
        sawText = true;
      }
      if (line3.trim().length === 0) {
        sawBlank = true;
      }
      if (sawText && sawBlank) {
        break;
      }
    }

    expect(machine.getExecutionDomain()).toBe('user-program');
    expect(sawText).toBe(true);
    expect(sawBlank).toBe(true);
  }, 15_000);

  it('keeps executing WAIT loop and alternates LCD text under Z80 BASIC run', () => {
    const machine = new PCG815Machine();
    runBasic(machine, [
      'NEW',
      '10 CLS',
      '20 LOCATE 0,0',
      '30 OUT 90,65',
      '40 WAIT 3',
      '50 CLS',
      '60 WAIT 3',
      '70 GOTO 20',
      'RUN'
    ]);

    const seen = new Set<string>();
    for (let i = 0; i < 50_000; i += 1) {
      run(machine, 512);
      const head = machine.getTextLines()[0] ?? '';
      seen.add(head.slice(0, 1));
      if (seen.has('A') && seen.has(' ')) {
        break;
      }
    }

    expect(seen.has('A')).toBe(true);
    expect(seen.has(' ')).toBe(true);
    expect(machine.getExecutionDomain()).toBe('user-program');
  }, 15_000);

  it('executes CLS as immediate command', () => {
    const machine = new PCG815Machine();
    machine.out8(0x58, 0x80);
    machine.out8(0x5a, 0x41);
    runBasic(machine, ['CLS']);
    const head = machine.getTextLines()[0] ?? '';
    expect(head.startsWith(' '), head).toBe(true);
  });

  it('supports OUT 17 + INP(16) keyboard scan compatibility for Space key', () => {
    const machine = new PCG815Machine();
    machine.setKeyState('Space', true);

    runBasic(machine, ['NEW', '10 OUT 17,128', '20 PRINT INP(16)', 'RUN']);

    expect(machine.getTextLines().join('\n')).toContain('239');
  });

  it('reads 255 from INP(16) when OUT 17,128 selects Space row with no key pressed', () => {
    const machine = new PCG815Machine();

    runBasic(machine, ['NEW', '10 OUT 17,128', '20 PRINT INP(16)', 'RUN']);

    expect(machine.getTextLines().join('\n')).toContain('255');
  });

  it('stores INP(16) into variable after OUT 17,128 in sequential flow', () => {
    const machine = new PCG815Machine();

    runBasic(machine, ['NEW', '10 OUT 17,128', '20 LET R=INP(16)', '30 PRINT R', 'RUN']);

    expect(machine.getTextLines().join('\n')).toContain('255');
  });

  it('executes OUT 17,128 correctly on 4-digit line numbers', () => {
    const machine = new PCG815Machine();

    runBasic(machine, [
      'NEW',
      '10 GOTO 7400',
      '20 END',
      '7400 OUT 17,128',
      '7410 PRINT INP(17)',
      '7420 LET R=INP(16)',
      '7430 PRINT R',
      '7440 END',
      'RUN'
    ]);

    expect(machine.getExecutionDomain()).toBe('firmware');
    const screen = machine.getTextLines().join('\n');
    expect(screen).toContain('255');
  });

  it('keeps OUT 17,128 effective after GOTO jump on low line numbers', () => {
    const machine = new PCG815Machine();

    runBasic(machine, [
      'NEW',
      '10 GOTO 40',
      '20 END',
      '40 OUT 17,128',
      '50 LET R=INP(16)',
      '60 PRINT R',
      '70 END',
      'RUN'
    ]);

    expect(machine.getTextLines().join('\n')).toContain('255');
  });

  it('executes OUT 90,65 on 4-digit line numbers', () => {
    const machine = new PCG815Machine();

    runBasic(machine, [
      'NEW',
      '10 CLS',
      '20 GOTO 7400',
      '30 END',
      '7400 LOCATE 0,0',
      '7410 OUT 90,65',
      '7420 END',
      'RUN'
    ]);

    const head = machine.getTextLines()[0] ?? '';
    expect(head.startsWith('A')).toBe(true);
  });

  it('executes OUT 17,128 on 4-digit line numbers without any GOTO jump', () => {
    const machine = new PCG815Machine();

    runBasic(machine, [
      'NEW',
      '7400 OUT 17,128',
      '7410 LET R=INP(16)',
      '7420 PRINT R',
      '7430 END',
      'RUN'
    ]);

    const screen = machine.getTextLines().join('\n');
    expect(machine.getExecutionDomain()).toBe('firmware');
    expect(screen).toContain('255');
  });

  it('keeps OUT 17,V working on 4-digit lines when V=128', () => {
    const machine = new PCG815Machine();

    runBasic(machine, [
      'NEW',
      '7400 LET V=128',
      '7410 OUT 17,V',
      '7420 LET R=INP(16)',
      '7430 PRINT R',
      '7440 END',
      'RUN'
    ]);

    expect(machine.getTextLines().join('\n')).toContain('255');
  });

  it('executes OUT 24,1 on 4-digit lines and reflects via INP(24)', () => {
    const machine = new PCG815Machine();

    runBasic(machine, [
      'NEW',
      '7400 OUT 24,1',
      '7410 PRINT INP(24)',
      '7420 END',
      'RUN'
    ]);

    expect(machine.getTextLines().join('\n')).toContain('1');
  });

  it('parses 4-digit numeric literal 7400 exactly', () => {
    const machine = new PCG815Machine();

    runBasic(machine, ['NEW', '10 PRINT 7400', 'RUN']);

    expect(machine.getTextLines().join('\n')).toContain('7400');
  });

  it('parses 3-digit numeric literal 128 exactly', () => {
    const machine = new PCG815Machine();

    runBasic(machine, ['NEW', '10 PRINT 128', 'RUN']);

    expect(machine.getTextLines().join('\n')).toContain('128');
  });

  it('jumps to the exact 4-digit line on GOTO (not 10-lines ahead)', () => {
    const machine = new PCG815Machine();

    runBasic(machine, [
      'NEW',
      '10 GOTO 7400',
      '30 END',
      '7400 PRINT 1111',
      '7410 END',
      '7420 PRINT 2222',
      '7430 END',
      'RUN'
    ]);

    const screen = machine.getTextLines().join('\n');
    expect(screen).toContain('1111');
    expect(screen).not.toContain('2222');
  });

  it('resolves GOSUB 7400 and reads INP(16) in subroutine', () => {
    const machine = new PCG815Machine();

    runBasic(machine, [
      'NEW',
      '5 LET C=0',
      '10 LET R=0',
      '20 GOSUB 7400',
      '30 PRINT C',
      '40 PRINT R',
      '50 END',
      '7400 LET C=1',
      '7410 OUT 17,128',
      '7420 LET R=INP(16)',
      '7430 RETURN',
      'RUN'
    ]);

    const screen = machine.getTextLines().join('\n');
    expect(screen).toContain('1');
    expect(screen).toContain('255');
  });

  it('jumps to exact GOSUB target line (not the next record)', () => {
    const machine = new PCG815Machine();

    runBasic(machine, [
      'NEW',
      '10 LET R=0',
      '20 GOSUB 7400',
      '30 PRINT R',
      '40 END',
      '7400 LET R=1',
      '7405 RETURN',
      '7410 LET R=2',
      '7420 RETURN',
      'RUN'
    ]);

    expect(machine.getTextLines().join('\n')).toContain('1');
    expect(machine.getTextLines().join('\n')).not.toContain('\n2');
  });

  it('supports nested GOSUB/RETURN flow', () => {
    const machine = new PCG815Machine();

    runBasic(machine, [
      'NEW',
      '10 GOSUB 100',
      '20 PRINT 9',
      '30 END',
      '100 GOSUB 200',
      '110 RETURN',
      '200 PRINT 3',
      '210 RETURN',
      'RUN'
    ]);

    const screen = machine.getTextLines().join('\n');
    expect(screen).toContain('3');
    expect(screen).toContain('9');
  });

  it('continues after first nested cell-draw GOSUB call', () => {
    const machine = new PCG815Machine();

    runBasic(machine, [
      'NEW',
      '10 GOSUB 3000',
      '20 PRINT 123',
      '30 END',
      '3000 LET AX=1',
      '3010 GOSUB 3300',
      '3020 LET AX=2',
      '3030 GOSUB 3300',
      '3040 RETURN',
      '3300 LET CH=46',
      '3310 OUT 90,CH',
      '3320 RETURN',
      'RUN'
    ]);

    expect(machine.getExecutionDomain()).toBe('firmware');
    expect(machine.getTextLines().join('\n')).toContain('123');
  });


  it('does not echo key ASCII into monitor while user-program is active', () => {
    const machine = new PCG815Machine();
    run(machine, 260_000);

    machine.setExecutionDomain('user-program');
    machine.setKeyState('KeyA', true);
    machine.setKeyState('KeyA', false);
    run(machine, 20_000);

    const after = machine.getTextLines().join('\n');
    expect(after).not.toContain('> A');
  });

  it('evaluates IF equality with THEN for variables', () => {
    const machine = new PCG815Machine();
    runBasic(machine, ['NEW', '10 LET A=1', '20 IF A=1 THEN 40', '30 PRINT 1234', '40 PRINT 5678', 'RUN']);

    const screen = machine.getTextLines().join('\n');
    expect(screen).toContain('5678');
    expect(screen).not.toContain('1234');
  });

  it('reaches CT=16 in increment loop with IF CT<16', () => {
    const machine = new PCG815Machine();
    runBasic(machine, ['NEW', '10 LET CT=0', '20 LET CT=CT+1', '30 IF CT<16 THEN 20', '40 PRINT CT', 'RUN']);
    const screen = machine.getTextLines().join('\n');
    expect(screen).toContain('16');
    expect(readBasicVariable(machine, 'CT')).toBe(16);
  });

  it('keeps at least 40 distinct BASIC variables (sample game compatibility)', () => {
    const machine = new PCG815Machine();
    const lines: string[] = ['NEW'];
    for (let i = 0; i < 40; i += 1) {
      lines.push(`${10 + i * 10} LET A${i}=` + i);
    }
    lines.push('500 PRINT A39');
    lines.push('RUN');

    runBasic(machine, lines);

    expect(readBasicVariable(machine, 'A0')).toBe(0);
    expect(readBasicVariable(machine, 'A23')).toBe(23);
    expect(readBasicVariable(machine, 'A39')).toBe(39);
    expect(machine.getTextLines().join('\n')).toContain('39');
  });

  it('uses WAIT argument value even on 4-digit line numbers', () => {
    const machine = new PCG815Machine();
    machine.runBasicInterpreter(
      encodeBasicLines(['NEW', '9760 WAIT 3', '9770 END', 'RUN']),
      { appendEot: true, maxTStates: 2_000_000 }
    );
    expect(machine.getExecutionDomain()).toBe('firmware');
  });

  it('moves cursor with LOCATE before OUT 90 write', () => {
    const machine = new PCG815Machine();
    machine.out8(0x58, 0x80);
    machine.out8(0x5a, 0x41); // row0 col0 = A, cursor now col1
    runBasic(machine, ['NEW', '10 LOCATE 0,0', '20 OUT 90,66', '30 END', 'RUN']);
    const head = machine.getTextLines()[0] ?? '';
    expect(head.startsWith('B'), head).toBe(true);
  });

  it('advances CT variable in blink-style loop and toggles BL state', () => {
    const machine = new PCG815Machine();
    runBasic(machine, [
      'NEW',
      '10 LET BL=1',
      '20 LET CT=0',
      '30 LET CT=CT+1',
      '40 IF CT<16 THEN 90',
      '50 LET CT=0',
      '60 IF BL=0 THEN 80',
      '70 LET BL=0',
      '71 GOTO 90',
      '80 LET BL=1',
      '90 WAIT 3',
      '100 GOTO 30',
      'RUN'
    ]);

    let sawCtAtLeast16 = false;
    let sawBlZero = false;
    let sawBlOne = false;
    let sawCtAny = false;
    let maxCt = -1;
    for (let i = 0; i < 1200; i += 1) {
      run(machine, 40_000);
      const ct = readBasicVariable(machine, 'CT');
      const bl = readBasicVariable(machine, 'BL');
      if (ct !== undefined) {
        sawCtAny = true;
        if (ct > maxCt) {
          maxCt = ct;
        }
      }
      if (ct !== undefined && ct >= 16) {
        sawCtAtLeast16 = true;
      }
      if (bl === 0) {
        sawBlZero = true;
      }
      if (bl === 1) {
        sawBlOne = true;
      }
      if (sawCtAtLeast16 && sawBlZero && sawBlOne) {
        break;
      }
    }

    const bank = machine.getActiveRamBank();
    const keys = listBasicVariableKeys(machine);
    expect(sawCtAny, `activeRamBank=${bank}, maxCt=${maxCt}, keys=${keys.join(',')}`).toBe(true);
    expect(sawCtAtLeast16, `activeRamBank=${bank}, maxCt=${maxCt}, keys=${keys.join(',')}`).toBe(true);
    expect(sawBlZero).toBe(true);
    expect(sawBlOne).toBe(true);
    expect(machine.getActiveRamBank()).toBe(0);
    expect(machine.getExecutionDomain()).toBe('user-program');
  }, 15_000);

  it('detects Space with OUT 17 + INP(16) + IF comparison path', () => {
    const machine = new PCG815Machine();
    machine.setKeyState('Space', true);
    runBasic(machine, ['NEW', '10 OUT 17,128', '20 LET R=INP(16)', '30 IF R=239 THEN 50', '40 PRINT 0', '50 PRINT 1', 'RUN']);

    const screen = machine.getTextLines().join('\n');
    expect(screen).toContain('1');
    expect(screen).not.toContain('0');
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
