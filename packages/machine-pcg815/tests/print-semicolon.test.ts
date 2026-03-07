import { describe, expect, it } from 'vitest';
import { decodeMachineText } from '@z80emu/lcd-144x32';
import { PCG815Machine } from '../src';

function encode(lines: readonly string[]): number[] {
  const out: number[] = [];
  for (const line of lines) {
    for (const ch of line) out.push(ch.charCodeAt(0) & 0xff);
    out.push(0x0d);
  }
  return out;
}

describe('z80 basic PRINT semicolon behavior', () => {
  it.each(['z80-firmware', 'ts-compat'] as const)(
    'does not print implicit 0 on trailing semicolon (%s)',
    (executionBackend) => {
      const machine = new PCG815Machine({ executionBackend });
      machine.runBasicInterpreter(encode(['10 PRINT "X";', 'RUN']), { appendEot: true, maxTStates: 2_000_000 });
      const line0 = decodeMachineText(machine)[0] ?? '';
      expect(line0.startsWith('X')).toBe(true);
      expect(line0.includes('X0')).toBe(false);
    }
  );

  it.each(['z80-firmware', 'ts-compat'] as const)(
    'does not increment numeric literal/value when trailing semicolon is used (%s)',
    (executionBackend) => {
      const machine = new PCG815Machine({ executionBackend });
      machine.runBasicInterpreter(encode(['10 PRINT 1;', '20 A=3', '30 PRINT A;', 'RUN']), {
        appendEot: true,
        maxTStates: 2_000_000
      });
      const screen = decodeMachineText(machine).join('\n');
      expect(screen).toContain('1');
      expect(screen).toContain('3');
      expect(screen).not.toContain('2');
      expect(screen).not.toContain('4');
    }
  );

  it.each(['z80-firmware', 'ts-compat'] as const)(
    'prints comma-separated variables at 12-column tab stops (%s)',
    (executionBackend) => {
      const machine = new PCG815Machine({ executionBackend });
      machine.runBasicInterpreter(encode(['10 X=83', '20 Y=5', '30 PRINT X,Y', 'RUN']), {
        appendEot: true,
        maxTStates: 2_000_000
      });
      const line0 = decodeMachineText(machine)[0] ?? '';
      expect(line0.startsWith('83          5')).toBe(true);
    }
  );

  it.each(['z80-firmware', 'ts-compat'] as const)(
    'keeps numeric semicolon behavior without mutating values (%s)',
    (executionBackend) => {
      const machine = new PCG815Machine({ executionBackend });
      machine.runBasicInterpreter(encode(['10 X=83', '20 PRINT 83;', '30 PRINT X;', 'RUN']), {
        appendEot: true,
        maxTStates: 2_000_000
      });
      const screen = decodeMachineText(machine).join('\n');
      expect(screen).toContain('83');
      expect(screen).not.toContain('84');
    }
  );

  it.each(['z80-firmware', 'ts-compat'] as const)(
    'continues next PRINT on same line when previous ends with semicolon (%s)',
    (executionBackend) => {
      const machine = new PCG815Machine({ executionBackend });
      machine.runBasicInterpreter(encode(['10 PRINT "X";', '20 PRINT "Y"', 'RUN']), {
        appendEot: true,
        maxTStates: 2_000_000
      });
      const line0 = decodeMachineText(machine)[0] ?? '';
      expect(line0.includes('XY')).toBe(true);
    }
  );

  it('treats colon as statement terminator after trailing semicolon (z80-firmware)', () => {
    const machine = new PCG815Machine({ executionBackend: 'z80-firmware' });
    machine.runBasicInterpreter(encode(['10 PRINT "@";:PRINT "Z"', 'RUN']), {
      appendEot: true,
      maxTStates: 2_000_000
    });
    const line0 = decodeMachineText(machine)[0] ?? '';
    expect(line0.includes('@Z')).toBe(true);
    expect(line0.includes('@0')).toBe(false);
  });

  it('does not emit implicit zero before statement terminator after numeric trailing semicolon (z80-firmware)', () => {
    const machine = new PCG815Machine({ executionBackend: 'z80-firmware' });
    machine.runBasicInterpreter(encode(['10 PRINT 1;:PRINT 2', 'RUN']), {
      appendEot: true,
      maxTStates: 2_000_000
    });
    const line0 = decodeMachineText(machine)[0] ?? '';
    expect(line0.trimStart().startsWith('1')).toBe(true);
    expect(line0.trimEnd().endsWith('2')).toBe(true);
    expect(line0.includes('10')).toBe(false);
  });

  it('treats command keyword after trailing semicolon as next statement on z80-firmware', () => {
    const machine = new PCG815Machine({ executionBackend: 'z80-firmware' });
    machine.runBasicInterpreter(encode(['10 CLS', '20 A=0', '30 GOSUB 100', '40 PRINT ".."', '50 END', '100 IF A=0 THEN PRINT "@@";RETURN', 'RUN']), {
      appendEot: true,
      maxTStates: 2_000_000
    });
    const screen = decodeMachineText(machine).join('\n');
    expect(screen).toContain('@@');
    expect(screen).toContain('..');
    expect(screen).not.toContain('@@0');
  });

  it('prints @ from IF ... THEN PRINT "@";:RETURN inside GOSUB on z80-firmware', () => {
    const machine = new PCG815Machine({ executionBackend: 'z80-firmware' });
    machine.runBasicInterpreter(
      encode(['10 CLS', '20 CH=64', '30 GOSUB 100', '40 END', '100 LOCATE 1,0', '110 IF CH=64 THEN PRINT "@";:RETURN', 'RUN']),
      {
        appendEot: true,
        maxTStates: 2_000_000
      }
    );
    const line0 = decodeMachineText(machine)[0] ?? '';
    expect(line0.startsWith(' @'), line0).toBe(true);
  });

  it('prints @ from the sample-game 4300-line dispatch on z80-firmware', () => {
    const machine = new PCG815Machine({ executionBackend: 'z80-firmware' });
    machine.runBasicInterpreter(
      encode([
        '10 CLS',
        '20 CH=64',
        '25 T=0',
        '30 GOSUB 4300',
        '40 PRINT T',
        '50 END',
        '4300 LOCATE 1,0',
        '4320 LET T=1:IF CH=46 THEN PRINT ".";:RETURN',
        '4330 LET T=2:IF CH=35 THEN PRINT "#";:RETURN',
        '4340 LET T=3:IF CH=71 THEN PRINT "G";:RETURN',
        '4350 LET T=4:IF CH=75 THEN PRINT "K";:RETURN',
        '4360 LET T=5:IF CH=64 THEN PRINT "@";:RETURN',
        '4370 LET T=6:PRINT " ";',
        '4380 LET T=7:RETURN',
        'RUN'
      ]),
      {
        appendEot: true,
        maxTStates: 2_000_000
      }
    );
    const screen = decodeMachineText(machine).join('\n');
    const debug = `${screen}\nGOSUB_SP=${machine.read8(0x6f05)}`;
    expect(screen, debug).toContain('5');
    const line0 = decodeMachineText(machine)[0] ?? '';
    expect(line0.startsWith(' @'), debug).toBe(true);
  });

  it('executes IF/THEN PRINT on line 4360 on z80-firmware', () => {
    const machine = new PCG815Machine({ executionBackend: 'z80-firmware' });
    machine.runBasicInterpreter(encode(['10 CLS', '20 CH=64', '30 LOCATE 1,0', '4360 IF CH=64 THEN PRINT "@";', '4370 END', 'RUN']), {
      appendEot: true,
      maxTStates: 2_000_000
    });
    const line0 = decodeMachineText(machine)[0] ?? '';
    expect(line0.startsWith(' @'), line0).toBe(true);
  });

  it('executes PRINT/END command sequence on line 4360 on z80-firmware', () => {
    const machine = new PCG815Machine({ executionBackend: 'z80-firmware' });
    machine.runBasicInterpreter(encode(['10 CLS', '20 LOCATE 1,0', '4360 PRINT "@";:END', 'RUN']), {
      appendEot: true,
      maxTStates: 2_000_000
    });
    const line0 = decodeMachineText(machine)[0] ?? '';
    expect(line0.startsWith(' @'), line0).toBe(true);
  });
});
