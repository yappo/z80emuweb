import { describe, expect, it } from 'vitest';

import { PCG815Machine, decodeMachineText } from '../src';

type CommandName =
  | 'AUTO'
  | 'BEEP'
  | 'BLOAD'
  | 'BSAVE'
  | 'CALL'
  | 'CIRCLE'
  | 'CLEAR'
  | 'CLOSE'
  | 'CLS'
  | 'CONT'
  | 'DATA'
  | 'DEGREE'
  | 'DELETE'
  | 'DIM'
  | 'ELSE'
  | 'END'
  | 'ERASE'
  | 'FILES'
  | 'FOR'
  | 'GCURSOR'
  | 'GOSUB'
  | 'GOTO'
  | 'GPRINT'
  | 'GRAD'
  | 'HDCOPY'
  | 'IF'
  | 'INPUT'
  | 'KILL'
  | 'LCOPY'
  | 'LET'
  | 'LFILES'
  | 'LINE'
  | 'LIST'
  | 'LLIST'
  | 'LNINPUT'
  | 'LOAD'
  | 'LOCATE'
  | 'LPRINT'
  | 'MON'
  | 'NEW'
  | 'NEXT'
  | 'ON'
  | 'OPEN'
  | 'OUT'
  | 'PAINT'
  | 'PASS'
  | 'PIOPUT'
  | 'PIOSET'
  | 'POKE'
  | 'PRESET'
  | 'PRINT'
  | 'PSET'
  | 'RADIAN'
  | 'RANDOMIZE'
  | 'READ'
  | 'REM'
  | 'RENUM'
  | 'REPEAT'
  | 'RESTORE'
  | 'RETURN'
  | 'RUN'
  | 'SAVE'
  | 'SPINP'
  | 'SPOUT'
  | 'STOP'
  | 'TROFF'
  | 'TRON'
  | 'UNTIL'
  | 'USING'
  | 'WAIT'
  | 'WEND'
  | 'WHILE';

const COMMANDS_72: readonly CommandName[] = [
  'AUTO',
  'BEEP',
  'BLOAD',
  'BSAVE',
  'CALL',
  'CIRCLE',
  'CLEAR',
  'CLOSE',
  'CLS',
  'CONT',
  'DATA',
  'DEGREE',
  'DELETE',
  'DIM',
  'ELSE',
  'END',
  'ERASE',
  'FILES',
  'FOR',
  'GCURSOR',
  'GOSUB',
  'GOTO',
  'GPRINT',
  'GRAD',
  'HDCOPY',
  'IF',
  'INPUT',
  'KILL',
  'LCOPY',
  'LET',
  'LFILES',
  'LINE',
  'LIST',
  'LLIST',
  'LNINPUT',
  'LOAD',
  'LOCATE',
  'LPRINT',
  'MON',
  'NEW',
  'NEXT',
  'ON',
  'OPEN',
  'OUT',
  'PAINT',
  'PASS',
  'PIOPUT',
  'PIOSET',
  'POKE',
  'PRESET',
  'PRINT',
  'PSET',
  'RADIAN',
  'RANDOMIZE',
  'READ',
  'REM',
  'RENUM',
  'REPEAT',
  'RESTORE',
  'RETURN',
  'RUN',
  'SAVE',
  'SPINP',
  'SPOUT',
  'STOP',
  'TROFF',
  'TRON',
  'UNTIL',
  'USING',
  'WAIT',
  'WEND',
  'WHILE'
] as const;

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

function readBasicVariable(machine: PCG815Machine, name: string): number | undefined {
  const upper = name.toUpperCase();
  const key1 = upper.charCodeAt(0) || 0;
  const key2 = upper.charCodeAt(1) || 0;
  const key3 = upper.charCodeAt(2) || 0;
  const base = 0x6c00;
  for (let i = 0; i < 64; i += 1) {
    const addr = base + i * 6;
    if (machine.read8(addr) !== key1 || machine.read8(addr + 1) !== key2 || machine.read8(addr + 2) !== key3) {
      continue;
    }
    return machine.read8(addr + 3) | (machine.read8(addr + 4) << 8);
  }
  return undefined;
}

interface RunResult {
  machine: PCG815Machine;
  error: Error | null;
  screen: string;
}

function runBasic(lines: readonly string[], maxTStates = 2_000_000): RunResult {
  const machine = new PCG815Machine({ executionBackend: 'z80-firmware' });
  let error: Error | null = null;
  try {
    machine.runBasicInterpreter(encodeBasicLines(lines), { appendEot: true, maxTStates });
  } catch (caught) {
    error = caught instanceof Error ? caught : new Error(String(caught));
  }
  return { machine, error, screen: decodeMachineText(machine).join('\n') };
}

type PositiveChecker = (result: RunResult) => void;
type NegativeChecker = (result: RunResult) => void;

interface CommandScenario {
  positiveLines: string[];
  negativeLines: string[];
  positiveCheck: PositiveChecker;
  negativeCheck: NegativeChecker;
}

const expectNoError: PositiveChecker = ({ error }) => {
  expect(error).toBeNull();
};

const expectAnyError: NegativeChecker = ({ error }) => {
  expect(error).not.toBeNull();
};

const DEFAULT_SCENARIO: CommandScenario = {
  positiveLines: ['NEW', '10 REM DEFAULT', '20 PRINT 1', 'RUN'],
  negativeLines: ['NEW', '10 PRINT 1', 'RUN ???'],
  positiveCheck: ({ error, screen }) => {
    expect(error).toBeNull();
    expect(screen).toContain('1');
  },
  negativeCheck: expectAnyError
};

const SCENARIOS: Partial<Record<CommandName, CommandScenario>> = {
  NEW: {
    positiveLines: ['10 PRINT 9', 'NEW', 'LIST'],
    negativeLines: ['NEW 1'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).not.toContain('10 PRINT 9');
    },
    negativeCheck: expectAnyError
  },
  LIST: {
    positiveLines: ['10 PRINT 1', 'LIST'],
    negativeLines: ['LIST *'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('10 PRINT 1');
    },
    negativeCheck: expectAnyError
  },
  RUN: {
    positiveLines: ['10 PRINT 42', 'RUN'],
    negativeLines: ['10 GOTO 10', 'RUN'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('42');
    },
    negativeCheck: expectAnyError
  },
  PRINT: {
    positiveLines: ['PRINT 2+3'],
    negativeLines: ['PRINT ;'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('5');
    },
    negativeCheck: expectAnyError
  },
  LET: {
    positiveLines: ['LET A=10', 'PRINT A'],
    negativeLines: ['LET 1A=10'],
    positiveCheck: ({ error, screen, machine }) => {
      expect(error).toBeNull();
      expect(screen).toContain('10');
      expect(readBasicVariable(machine, 'A')).toBe(10);
    },
    negativeCheck: expectAnyError
  },
  INPUT: {
    positiveLines: ['10 INPUT "[0-99]> ";X', '20 PRINT "Your Input:";X', 'RUN', '42'],
    negativeLines: ['INPUT'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('Your Input:42');
    },
    negativeCheck: expectAnyError
  },
  GOTO: {
    positiveLines: ['10 GOTO 30', '20 PRINT 0', '30 PRINT 1', 'RUN'],
    negativeLines: ['10 GOTO 9999', 'RUN'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
      expect(screen).not.toContain('0\n');
    },
    negativeCheck: expectAnyError
  },
  GOSUB: {
    positiveLines: ['10 GOSUB 100', '20 PRINT 9', '30 END', '100 PRINT 3', '110 RETURN', 'RUN'],
    negativeLines: ['10 GOSUB 9999', 'RUN'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('3');
      expect(screen).toContain('9');
    },
    negativeCheck: expectAnyError
  },
  RETURN: {
    positiveLines: ['10 GOSUB 100', '20 END', '100 RETURN', 'RUN'],
    negativeLines: ['10 RETURN', 'RUN'],
    positiveCheck: expectNoError,
    negativeCheck: expectAnyError
  },
  END: {
    positiveLines: ['10 PRINT 1', '20 END', '30 PRINT 2', 'RUN'],
    negativeLines: ['END 1'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
      expect(screen).not.toContain('2\n');
    },
    negativeCheck: expectAnyError
  },
  STOP: {
    positiveLines: ['10 PRINT 1', '20 STOP', '30 PRINT 2', 'RUN'],
    negativeLines: ['STOP 1'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
      expect(screen).not.toContain('2\n');
    },
    negativeCheck: expectAnyError
  },
  CONT: {
    positiveLines: ['10 PRINT 1', '20 STOP', '30 PRINT 2', 'RUN', 'CONT'],
    negativeLines: ['CONT 1'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('2');
    },
    negativeCheck: expectAnyError
  },
  IF: {
    positiveLines: [
      '10 LET A=1',
      '20 IF A=1 PRINT "A is 1"',
      '30 IF A=2 PRINT "NG"',
      '40 IF A=2 PRINT "X" ELSE PRINT "ELSE"',
      'RUN'
    ],
    negativeLines: ['10 IF A THEN X', 'RUN'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('A is 1');
      expect(screen).toContain('ELSE');
      expect(screen).not.toContain('NG');
    },
    negativeCheck: expectAnyError
  },
  CLS: {
    positiveLines: ['PRINT "ABC"', 'CLS', 'PRINT "X"'],
    negativeLines: ['CLS 1'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('X');
    },
    negativeCheck: expectAnyError
  },
  REM: {
    positiveLines: ['10 REM TEST', '20 PRINT 5', 'RUN'],
    negativeLines: ['10 REM', '20 REM', 'RUN'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('5');
    },
    negativeCheck: expectNoError
  },
  FOR: {
    positiveLines: ['10 FOR I=1 TO 3', '20 PRINT I', '30 NEXT I', 'RUN'],
    negativeLines: ['10 FOR I=1', 'RUN'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
      expect(screen).toContain('2');
      expect(screen).toContain('3');
    },
    negativeCheck: expectAnyError
  },
  NEXT: {
    positiveLines: ['10 FOR I=1 TO 2', '20 NEXT I', '30 PRINT I', 'RUN'],
    negativeLines: ['10 NEXT', 'RUN'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('3');
    },
    negativeCheck: expectAnyError
  },
  DIM: {
    positiveLines: ['DIM A(2)', 'A(1)=7', 'PRINT A(1)'],
    negativeLines: ['DIM A(-1)'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('7');
    },
    negativeCheck: expectAnyError
  },
  DATA: {
    positiveLines: ['10 DATA 5,6', '20 READ A,B', '30 PRINT A,B', 'RUN'],
    negativeLines: ['10 DATA', '20 READ A', 'RUN'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('5');
      expect(screen).toContain('6');
    },
    negativeCheck: expectAnyError
  },
  READ: {
    positiveLines: ['10 DATA 9', '20 READ A', '30 PRINT A', 'RUN'],
    negativeLines: ['10 DATA 1', '20 READ A,B', 'RUN'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('9');
    },
    negativeCheck: expectAnyError
  },
  RESTORE: {
    positiveLines: ['10 DATA 1,2', '20 READ A', '30 RESTORE', '40 READ B', '50 PRINT B', 'RUN'],
    negativeLines: ['10 DATA 1', '20 RESTORE 9999', 'RUN'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
    },
    negativeCheck: expectAnyError
  },
  POKE: {
    positiveLines: ['POKE 24576,65', 'PRINT 1'],
    negativeLines: ['POKE 1'],
    positiveCheck: ({ error, machine }) => {
      expect(error).toBeNull();
      expect(machine.read8(24576)).toBe(65);
    },
    negativeCheck: expectAnyError
  },
  OUT: {
    positiveLines: ['NEW', '10 OUT 24,1', '20 PRINT INP(24)', 'RUN'],
    negativeLines: ['OUT'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
    },
    negativeCheck: expectAnyError
  },
  BEEP: {
    positiveLines: ['BEEP 1', 'PRINT 1'],
    negativeLines: ['BEEP 1,2,3,4'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
    },
    negativeCheck: expectAnyError
  },
  WAIT: {
    positiveLines: ['10 PRINT 1', '20 WAIT 1', '30 PRINT 2', 'RUN'],
    negativeLines: ['WAIT 1,2'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
      expect(screen).toContain('2');
    },
    negativeCheck: expectAnyError
  },
  LOCATE: {
    positiveLines: ['10 CLS', '20 LOCATE 0,0', '30 PRINT "A";', '40 END', 'RUN'],
    negativeLines: ['LOCATE'],
    positiveCheck: ({ error, machine }) => {
      expect(error).toBeNull();
      const head = decodeMachineText(machine)[0] ?? '';
      expect(head.startsWith('A')).toBe(true);
    },
    negativeCheck: expectAnyError
  },
  AUTO: {
    positiveLines: ['AUTO 100,10', 'PRINT 1', '.', 'LIST'],
    negativeLines: ['AUTO -1'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('100 PRINT 1');
    },
    negativeCheck: expectAnyError
  },
  BLOAD: {
    positiveLines: ['BLOAD "E:BIN.DAT",100', 'PRINT 1'],
    negativeLines: ['BLOAD'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
    },
    negativeCheck: expectAnyError
  },
  BSAVE: {
    positiveLines: ['BSAVE "E:BIN.DAT",100,100', 'FILES'],
    negativeLines: ['BSAVE "E:BIN.DAT",20,10'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('E:BIN.DAT');
    },
    negativeCheck: expectAnyError
  },
  FILES: {
    positiveLines: ['BSAVE "E:BIN.DAT",100,100', 'FILES'],
    negativeLines: ['FILES 1'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('E:BIN.DAT');
    },
    negativeCheck: expectAnyError
  },
  HDCOPY: {
    positiveLines: ['HDCOPY'],
    negativeLines: ['HDCOPY 1'],
    positiveCheck: expectNoError,
    negativeCheck: expectAnyError
  },
  PAINT: {
    positiveLines: ['PAINT 1,1'],
    negativeLines: ['PAINT (1,2)'],
    positiveCheck: expectNoError,
    negativeCheck: expectAnyError
  },
  CIRCLE: {
    positiveLines: ['CIRCLE 10,10,2'],
    negativeLines: ['CIRCLE (10,10),0'],
    positiveCheck: expectNoError,
    negativeCheck: expectAnyError
  },
  PASS: {
    positiveLines: ['PASS "SECURE"', 'PRINT 1'],
    negativeLines: ['PASS'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
    },
    negativeCheck: expectAnyError
  },
  PIOSET: {
    positiveLines: ['PIOSET 1', 'PRINT 1'],
    negativeLines: ['PIOSET'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
    },
    negativeCheck: expectAnyError
  },
  PIOPUT: {
    positiveLines: ['PIOPUT 2', 'PRINT 1'],
    negativeLines: ['PIOPUT'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
    },
    negativeCheck: expectAnyError
  },
  SPINP: {
    positiveLines: ['SPINP A', 'PRINT A'],
    negativeLines: ['SPINP'],
    positiveCheck: expectNoError,
    negativeCheck: expectAnyError
  },
  SPOUT: {
    positiveLines: ['SPOUT 3', 'PRINT 1'],
    negativeLines: ['SPOUT'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
    },
    negativeCheck: expectAnyError
  },
  REPEAT: {
    positiveLines: ['10 LET A=0', '20 REPEAT', '30 LET A=A+1', '40 UNTIL A=3', '50 PRINT A', 'RUN'],
    negativeLines: ['10 REPEAT 1', 'RUN'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('3');
    },
    negativeCheck: expectAnyError
  },
  UNTIL: {
    positiveLines: ['10 LET A=0', '20 REPEAT', '30 LET A=A+1', '40 UNTIL A=2', '50 PRINT A', 'RUN'],
    negativeLines: ['10 UNTIL 1', 'RUN'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('2');
    },
    negativeCheck: expectAnyError
  },
  WHILE: {
    positiveLines: ['10 LET B=0', '20 WHILE B<2', '30 PRINT B', '40 LET B=B+1', '50 WEND', 'RUN'],
    negativeLines: ['10 WHILE', 'RUN'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
    },
    negativeCheck: expectAnyError
  },
  WEND: {
    positiveLines: ['10 LET B=0', '20 WHILE B<1', '30 LET B=B+1', '40 WEND', '50 PRINT B', 'RUN'],
    negativeLines: ['10 WEND', 'RUN'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
    },
    negativeCheck: expectAnyError
  },
  LNINPUT: {
    positiveLines: ['10 LNINPUT A$', '20 PRINT A$', 'RUN', 'HELLO,PCG815'],
    negativeLines: ['LNINPUT'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('HELLO,PCG815');
    },
    negativeCheck: expectAnyError
  },
  CLEAR: {
    positiveLines: ['LET A=9', 'CLEAR', 'PRINT A'],
    negativeLines: ['CLEAR 1'],
    positiveCheck: ({ error, screen, machine }) => {
      expect(error).toBeNull();
      expect(readBasicVariable(machine, 'A') ?? 0).toBe(0);
      expect(screen).toContain('0');
    },
    negativeCheck: expectAnyError
  },
  DELETE: {
    positiveLines: ['10 PRINT 1', '20 PRINT 2', 'DELETE 20', 'LIST'],
    negativeLines: ['DELETE A'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('10 PRINT 1');
      expect(screen).not.toContain('20 PRINT 2');
    },
    negativeCheck: expectAnyError
  },
  ERASE: {
    positiveLines: ['DIM A(2)', 'A(1)=9', 'ERASE A', 'DIM A(2)', 'A(1)=7', 'PRINT A(1)'],
    negativeLines: ['ERASE'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('7');
    },
    negativeCheck: expectAnyError
  },
  ON: {
    positiveLines: ['10 LET A=2', '20 ON A GOTO 100,200', '30 PRINT 0', '100 PRINT 1', '110 END', '200 PRINT 2', '210 END', 'RUN'],
    negativeLines: ['10 ON', 'RUN'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('2');
      expect(screen).not.toContain('0\n');
    },
    negativeCheck: expectAnyError
  },
  RANDOMIZE: {
    positiveLines: ['RANDOMIZE', 'PRINT 1'],
    negativeLines: ['RANDOMIZE A'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
    },
    negativeCheck: expectAnyError
  },
  RENUM: {
    positiveLines: ['10 PRINT 1', '20 PRINT 2', 'RENUM 100,10'],
    negativeLines: ['RENUM A'],
    positiveCheck: ({ error }) => {
      expect(error).toBeNull();
    },
    negativeCheck: expectAnyError
  },
  USING: {
    positiveLines: ['PRINT USING "###";12'],
    negativeLines: ['USING'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('12');
    },
    negativeCheck: expectAnyError
  },
  MON: {
    positiveLines: ['MON', 'PRINT 1'],
    negativeLines: ['MON 1'],
    positiveCheck: expectNoError,
    negativeCheck: expectAnyError
  },
  OPEN: {
    positiveLines: ['OPEN "E:TMP.TXT"', 'PRINT 1'],
    negativeLines: ['OPEN'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
    },
    negativeCheck: expectAnyError
  },
  CLOSE: {
    positiveLines: ['OPEN "E:TMP.TXT"', 'CLOSE', 'PRINT 1'],
    negativeLines: ['CLOSE A'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
    },
    negativeCheck: expectAnyError
  },
  LOAD: {
    positiveLines: ['SAVE "E:PROG.BAS"', 'NEW', 'LOAD "E:PROG.BAS"', 'PRINT 1'],
    negativeLines: ['LOAD'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
    },
    negativeCheck: expectAnyError
  },
  SAVE: {
    positiveLines: ['10 PRINT 1', 'SAVE "E:PROG.BAS"', 'FILES'],
    negativeLines: ['SAVE'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('E:PROG.BAS');
    },
    negativeCheck: expectAnyError
  },
  LFILES: {
    positiveLines: ['LFILES', 'PRINT 1'],
    negativeLines: ['LFILES 1'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
    },
    negativeCheck: expectAnyError
  },
  LCOPY: {
    positiveLines: ['LCOPY', 'PRINT 1'],
    negativeLines: ['LCOPY 1'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
    },
    negativeCheck: expectAnyError
  },
  KILL: {
    positiveLines: ['BSAVE "E:DEL.DAT",100,100', 'KILL "E:DEL.DAT"', 'FILES'],
    negativeLines: ['KILL'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).not.toContain('E:DEL.DAT');
    },
    negativeCheck: expectAnyError
  },
  CALL: {
    positiveLines: ['CALL 100', 'PRINT 1'],
    negativeLines: ['CALL'],
    positiveCheck: expectNoError,
    negativeCheck: expectAnyError
  },
  GCURSOR: {
    positiveLines: ['GCURSOR 0,0', 'PRINT 1'],
    negativeLines: ['GCURSOR'],
    positiveCheck: expectNoError,
    negativeCheck: expectAnyError
  },
  GPRINT: {
    positiveLines: ['GCURSOR 0,0', 'GPRINT "A"', 'PRINT 1'],
    negativeLines: ['GPRINT'],
    positiveCheck: expectNoError,
    negativeCheck: expectAnyError
  },
  LINE: {
    positiveLines: ['LINE 0,0,10,10', 'PRINT 1'],
    negativeLines: ['LINE'],
    positiveCheck: expectNoError,
    negativeCheck: expectAnyError
  },
  PSET: {
    positiveLines: ['PSET 1,1', 'PRINT 1'],
    negativeLines: ['PSET'],
    positiveCheck: expectNoError,
    negativeCheck: expectAnyError
  },
  PRESET: {
    positiveLines: ['PRESET 1,1', 'PRINT 1'],
    negativeLines: ['PRESET'],
    positiveCheck: expectNoError,
    negativeCheck: expectAnyError
  },
  ELSE: {
    positiveLines: ['10 LET A=0', '20 IF A=1 THEN PRINT 1 ELSE PRINT 2', 'RUN'],
    negativeLines: ['10 ELSE', 'RUN'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('2');
    },
    negativeCheck: expectAnyError
  },
  LLIST: {
    positiveLines: ['10 PRINT 1', 'LLIST'],
    negativeLines: ['LLIST 1'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('10 PRINT 1');
    },
    negativeCheck: expectAnyError
  },
  LPRINT: {
    positiveLines: ['LPRINT "X"', 'PRINT 1'],
    negativeLines: ['LPRINT'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
    },
    negativeCheck: expectAnyError
  },
  DEGREE: {
    positiveLines: ['DEGREE', 'PRINT 1'],
    negativeLines: ['DEGREE 1'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
    },
    negativeCheck: expectAnyError
  },
  RADIAN: {
    positiveLines: ['RADIAN', 'PRINT 1'],
    negativeLines: ['RADIAN 1'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
    },
    negativeCheck: expectAnyError
  },
  GRAD: {
    positiveLines: ['GRAD', 'PRINT 1'],
    negativeLines: ['GRAD 1'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
    },
    negativeCheck: expectAnyError
  },
  TROFF: {
    positiveLines: ['TROFF', 'PRINT 1'],
    negativeLines: ['TROFF 1'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
    },
    negativeCheck: expectAnyError
  },
  TRON: {
    positiveLines: ['TRON', 'PRINT 1'],
    negativeLines: ['TRON 1'],
    positiveCheck: ({ error, screen }) => {
      expect(error).toBeNull();
      expect(screen).toContain('1');
    },
    negativeCheck: expectAnyError
  }
};

function getScenario(command: CommandName): CommandScenario {
  const override = SCENARIOS[command];
  if (override) {
    return override;
  }

  return {
    ...DEFAULT_SCENARIO,
    positiveLines: ['NEW', `10 ${command}`, '20 PRINT 1', 'RUN'],
    negativeLines: ['NEW', `10 ${command} ???`, 'RUN']
  };
}

describe('Z80 BASIC 72-command spec', () => {
  for (const command of COMMANDS_72) {
    it(`spec:${command}:positive`, () => {
      const scenario = getScenario(command);
      const result = runBasic(scenario.positiveLines);
      scenario.positiveCheck(result);
    });

    it(`spec:${command}:negative`, () => {
      const scenario = getScenario(command);
      const result = runBasic(scenario.negativeLines);
      scenario.negativeCheck(result);
    });
  }
});
