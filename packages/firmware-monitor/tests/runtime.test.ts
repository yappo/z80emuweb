import { describe, expect, it } from 'vitest';

import { createMonitorRom } from '../src/monitor-rom';
import { MonitorRuntime, PcG815BasicRuntime } from '../src/runtime';

function drain(runtime: PcG815BasicRuntime): string {
  const chars: string[] = [];
  for (let i = 0; i < 20_000; i += 1) {
    const code = runtime.popOutputChar();
    if (code === 0) {
      break;
    }
    chars.push(String.fromCharCode(code));
  }
  return chars.join('');
}

function executeLines(runtime: PcG815BasicRuntime, lines: string[]): string {
  for (const line of lines) {
    runtime.executeLine(line);
  }
  let now = Date.now();
  for (let i = 0; i < 20_000 && runtime.isProgramRunning(); i += 1) {
    now += 50;
    runtime.pump(now);
  }
  return drain(runtime);
}

function typeLine(runtime: PcG815BasicRuntime, line: string): void {
  for (const ch of line) {
    runtime.receiveChar(ch.charCodeAt(0));
  }
  runtime.receiveChar(0x0d);
}

describe('createMonitorRom', () => {
  it('creates a 16 KiB ROM with banner text', () => {
    const rom = createMonitorRom();
    expect(rom.length).toBe(0x4000);
    const bannerText = String.fromCharCode(...rom.slice(0x0027, 0x0027 + 12));
    expect(bannerText.startsWith('PC-G815')).toBe(true);
  });
});

describe('PcG815BasicRuntime', () => {
  it('supports immediate PRINT and LET', () => {
    const runtime = new PcG815BasicRuntime();

    const output = executeLines(runtime, ['LET A=2+3*4', 'PRINT A,1+1']);

    expect(output).toContain('OK');
    expect(output).toContain('14      2');
  });

  it('supports line labels and RUN/LIST targets', () => {
    const runtime = new PcG815BasicRuntime();

    const output = executeLines(runtime, ['10 *START:PRINT 1', '20 PRINT 2', 'LIST 20', 'RUN *START']);

    expect(output).toContain('20 PRINT 2');
    expect(output).toContain('1');
    expect(output).toContain('2');
  });

  it('supports IF inline ELSE branch execution', () => {
    const runtime = new PcG815BasicRuntime();

    const output = executeLines(runtime, ['10 LET A=0', '20 IF A THEN PRINT 1 ELSE PRINT 2', 'RUN']);

    expect(output).toContain('2');
    expect(output).not.toContain('1\r\n');
  });

  it('supports INPUT in immediate mode and RUN mode', () => {
    const runtime = new PcG815BasicRuntime();

    const output = executeLines(runtime, ['10 INPUT A,B$', '20 PRINT A;B$', 'RUN', '123,HELLO']);

    expect(output).toContain('? ');
    expect(output).toContain('123HELLO');
    expect(runtime.getVariables().get('A')).toBe(123);
    expect(runtime.getVariables().get('B$')).toBe('HELLO');
  });

  it('supports STOP and CONT resume flow', () => {
    const runtime = new PcG815BasicRuntime();

    const first = executeLines(runtime, ['10 PRINT 1', '20 STOP', '30 PRINT 2', 'RUN']);
    expect(first).toContain('1');
    expect(first).toContain('BREAK');
    expect(first).not.toContain('2\r\n');

    runtime.executeLine('CONT');
    let now = Date.now();
    for (let i = 0; i < 1000 && runtime.isProgramRunning(); i += 1) {
      now += 10;
      runtime.pump(now);
    }
    const second = drain(runtime);
    expect(second).toContain('2');
  });

  it('supports RETURN with target line and FOR/NEXT search', () => {
    const runtime = new PcG815BasicRuntime();

    const output = executeLines(runtime, [
      '10 FOR I=1 TO 2 STEP 0',
      '20 PRINT I',
      '30 NEXT I',
      '40 GOSUB 100',
      '50 PRINT 9',
      '60 END',
      '100 RETURN 50',
      'RUN'
    ]);

    expect(output).toContain('1');
    expect(output).toContain('9');
  });

  it('supports DIM string arrays and DATA/READ mixed types', () => {
    const runtime = new PcG815BasicRuntime();

    const output = executeLines(runtime, [
      '10 DIM A$(2)*8',
      '20 DATA "A",1',
      '30 READ A$(0),B',
      '40 PRINT A$(0);B',
      'RUN'
    ]);

    expect(output).toContain('A1');
    expect(runtime.getVariables().get('B')).toBe(1);
  });

  it('supports OUT default port and POKE multi-write', () => {
    const ports = new Map<number, number>();
    const memory = new Map<number, number>();
    const runtime = new PcG815BasicRuntime({
      machineAdapter: {
        out8: (port, value) => {
          ports.set(port & 0xff, value & 0xff);
        },
        peek8: (address) => memory.get(address & 0xffff) ?? 0,
        poke8: (address, value) => {
          memory.set(address & 0xffff, value & 0xff);
        }
      }
    });

    executeLines(runtime, ['OUT 16', 'POKE 100,1,2,3']);

    expect(ports.get(0x18)).toBe(16);
    expect(memory.get(100)).toBe(1);
    expect(memory.get(101)).toBe(2);
    expect(memory.get(102)).toBe(3);
  });

  it('supports WAIT immediate delay/enter-wait and BEEP sleep fallback', () => {
    const sleeps: number[] = [];
    let enterWaitCount = 0;
    const runtime = new PcG815BasicRuntime({
      machineAdapter: {
        sleepMs: (ms) => {
          sleeps.push(ms);
        },
        waitForEnterKey: () => {
          enterWaitCount += 1;
        }
      }
    });

    executeLines(runtime, ['WAIT 64', 'WAIT', 'BEEP 8,1,0']);
    expect(sleeps.some((ms) => ms >= 900 && ms <= 1100)).toBe(true);
    expect(enterWaitCount).toBe(1);

    const firstRun = executeLines(runtime, ['10 PRINT 1', '20 WAIT', '30 PRINT 2', 'RUN']);
    expect(firstRun).toContain('1');
    expect(firstRun).not.toContain('2\r\n');

    runtime.receiveChar(0x0d);
    let now = Date.now();
    for (let i = 0; i < 1000 && runtime.isProgramRunning(); i += 1) {
      now += 10;
      runtime.pump(now);
    }
    const resumed = drain(runtime);
    expect(resumed).toContain('2');
  });

  it('supports Task2 control commands', () => {
    const runtime = new PcG815BasicRuntime();

    const output = executeLines(runtime, [
      '10 LET A=1',
      '20 LET B=2',
      '30 ON 2 GOTO 100,200',
      '40 END',
      '100 PRINT 1',
      '110 END',
      '200 PRINT 2',
      '210 END',
      'RUN'
    ]);

    expect(output).toContain('2');

    executeLines(runtime, ['DELETE 100-210', 'LIST']);
    const listed = drain(runtime);
    expect(listed).not.toContain('100 PRINT 1');
  });

  it('supports Task5 builtin function set', () => {
    const runtime = new PcG815BasicRuntime({
      machineAdapter: {
        readInkey: () => 'K'
      }
    });

    const output = executeLines(runtime, [
      'LET A=ABS(-2)+INT(3.9)+SGN(-1)+LEN("AB")+ASC("Z")+VAL("12")',
      'PRINT A',
      'PRINT LEFT$("ABCDE",2);MID$("ABCDE",2,2);RIGHT$("ABCDE",1)',
      'PRINT CHR$(65);HEX$(255);INKEY$'
    ]);

    expect(output).toContain('108');
    expect(output).toContain('ABBCE');
    expect(output).toContain('AFFK');
  });

  it('supports Task6 REPEAT/UNTIL and WHILE/WEND loops', () => {
    const runtime = new PcG815BasicRuntime();

    const output = executeLines(runtime, [
      '10 LET A=0',
      '20 REPEAT',
      '30 LET A=A+1',
      '40 UNTIL A=3',
      '50 LET B=0',
      '60 WHILE B<2',
      '70 PRINT B',
      '80 LET B=B+1',
      '90 WEND',
      '100 PRINT A',
      'RUN'
    ]);

    expect(output).toContain('0');
    expect(output).toContain('1');
    expect(output).toContain('3');
  });

  it('supports Task6 AUTO/BLOAD/BSAVE/FILES/LNINPUT and machine-dependent I/O', () => {
    const files = new Map<string, Array<string | number>>();
    const open = new Map<number, { path: string; mode: 'INPUT' | 'OUTPUT' | 'APPEND'; cursor: number }>();
    const memory = new Map<number, number>([
      [100, 1],
      [101, 2],
      [102, 3]
    ]);
    const outEvents: Array<{ port: number; value: number }> = [];
    const printDevice: string[] = [];
    let nextHandle = 1;

    const runtime = new PcG815BasicRuntime({
      machineAdapter: {
        openFile: (path, mode) => {
          const normalized = path.startsWith('E:') ? path.slice(2) : path;
          if (mode === 'OUTPUT') {
            files.set(normalized, []);
          } else if (!files.has(normalized)) {
            files.set(normalized, []);
          }
          const handle = nextHandle;
          nextHandle += 1;
          open.set(handle, { path: normalized, mode, cursor: 0 });
          return handle;
        },
        closeFile: (handle) => {
          open.delete(handle);
        },
        readFileValue: (handle) => {
          const state = open.get(handle);
          if (!state) {
            return null;
          }
          const values = files.get(state.path) ?? [];
          const value = values[state.cursor];
          if (value === undefined) {
            return null;
          }
          state.cursor += 1;
          return value;
        },
        writeFileValue: (handle, value) => {
          const state = open.get(handle);
          if (!state) {
            return;
          }
          const values = files.get(state.path) ?? [];
          values.push(value);
          files.set(state.path, values);
        },
        listFiles: () => [...files.keys()].map((name) => `E:${name}`),
        peek8: (address) => memory.get(address & 0xffff) ?? 0,
        poke8: (address, value) => {
          memory.set(address & 0xffff, value & 0xff);
        },
        in8: (port) => (port === 0x32 ? 77 : 0xff),
        out8: (port, value) => {
          outEvents.push({ port: port & 0xff, value: value & 0xff });
        },
        printDeviceWrite: (text) => {
          printDevice.push(text);
        }
      }
    });

    const autoOutput = executeLines(runtime, ['AUTO 100,10', 'PRINT 1', 'PRINT 2', '.', 'LIST']);
    expect(autoOutput).toContain('100 PRINT 1');
    expect(autoOutput).toContain('110 PRINT 2');

    const ioOutput = executeLines(runtime, [
      'BSAVE "E:BIN.DAT",100,102',
      'POKE 100,0,0,0',
      'BLOAD "E:BIN.DAT",100',
      'PRINT PEEK(100),PEEK(101),PEEK(102)',
      'FILES',
      'PASS "SECURE"',
      'PIOSET 1',
      'PIOPUT 2',
      'SPOUT 3',
      'SPINP A',
      'PRINT A',
      'HDCOPY'
    ]);

    expect(ioOutput).toContain('1       2       3');
    expect(ioOutput).toContain('E:BIN.DAT');
    expect(ioOutput).toContain('77');
    expect(runtime.getVariables().get('PASS$')).toBe('SECURE');

    const lninputOutput = executeLines(runtime, ['10 LNINPUT A$', '20 PRINT A$', 'RUN', 'HELLO,THERE']);
    expect(lninputOutput).toContain('HELLO,THERE');
    expect(outEvents).toContainEqual({ port: 0x30, value: 1 });
    expect(outEvents).toContainEqual({ port: 0x31, value: 2 });
    expect(outEvents).toContainEqual({ port: 0x32, value: 3 });
    expect(printDevice.some((line) => line.includes('HDCOPY'))).toBe(true);
  });

  it('supports OPEN/CLOSE/LOAD/SAVE/LFILES/KILL/CALL via machine adapter', () => {
    const files = new Map<string, string[]>();
    const open = new Map<number, { path: string; mode: 'INPUT' | 'OUTPUT' | 'APPEND'; cursor: number }>();
    let nextHandle = 1;
    const calls: Array<{ address: number; args: number[] }> = [];

    const runtime = new PcG815BasicRuntime({
      machineAdapter: {
        openFile: (path, mode) => {
          const normalized = path.startsWith('E:') ? path.slice(2) : path;
          if (mode === 'OUTPUT') {
            files.set(normalized, []);
          } else if (!files.has(normalized)) {
            files.set(normalized, []);
          }
          const handle = nextHandle;
          nextHandle += 1;
          open.set(handle, { path: normalized, mode, cursor: 0 });
          return handle;
        },
        closeFile: (handle) => {
          open.delete(handle);
        },
        readFileValue: (handle) => {
          const state = open.get(handle);
          if (!state) {
            return null;
          }
          const lines = files.get(state.path) ?? [];
          const value = lines[state.cursor];
          if (value === undefined) {
            return null;
          }
          state.cursor += 1;
          return value;
        },
        writeFileValue: (handle, value) => {
          const state = open.get(handle);
          if (!state) {
            return;
          }
          const lines = files.get(state.path) ?? [];
          if (state.mode === 'APPEND') {
            lines.push(String(value));
          } else {
            lines.push(String(value));
          }
          files.set(state.path, lines);
        },
        listFiles: () => [...files.keys()].map((name) => `E:${name}`),
        deleteFile: (path) => {
          const normalized = path.startsWith('E:') ? path.slice(2) : path;
          return files.delete(normalized);
        },
        callMachine: (address, args) => {
          calls.push({ address, args });
          return 0;
        }
      }
    });

    const output = executeLines(runtime, ['10 PRINT 1', 'SAVE "E:PROG.BAS"', 'NEW', 'LOAD "E:PROG.BAS"', 'RUN']);
    expect(output).toContain('1');

    const listedOutput = executeLines(runtime, ['LFILES']);
    expect(listedOutput).toContain('E:PROG.BAS');

    const afterKill = executeLines(runtime, ['CALL 4660,1,2,3', 'KILL "E:PROG.BAS"', 'LFILES']);
    expect(afterKill).not.toContain('PROG.BAS');
    expect(calls[0]).toEqual({ address: 4660, args: [1, 2, 3] });
  });

  it('supports graphics commands through adapter primitives', () => {
    const events: string[] = [];
    const runtime = new PcG815BasicRuntime({
      machineAdapter: {
        setGraphicCursor: (x, y) => events.push(`CUR:${x},${y}`),
        printGraphicText: (text) => events.push(`TXT:${text}`),
        drawPoint: (x, y, mode) => events.push(`PT:${x},${y},${mode}`),
        drawLine: (x1, y1, x2, y2, mode) => events.push(`LN:${x1},${y1},${x2},${y2},${mode}`)
      }
    });

    executeLines(runtime, ['GCURSOR (1,2)', 'GPRINT "AB"', 'PSET (3,4)', 'PRESET (3,4)', 'LINE (0,0)-(5,5)']);

    expect(events).toContain('CUR:1,2');
    expect(events).toContain('TXT:AB');
    expect(events).toContain('PT:3,4,1');
    expect(events).toContain('PT:3,4,0');
    expect(events.some((event) => event.startsWith('LN:0,0,5,5'))).toBe(true);
  });

  it('maintains character I/O mode via MonitorRuntime alias', () => {
    const runtime = new MonitorRuntime();

    typeLine(runtime, 'LET A=10');
    typeLine(runtime, 'PRINT A');

    const output = drain(runtime);
    expect(output).toContain('LET A=10');
    expect(output).toContain('10');
  });

  it('echoes half-width kana bytes from keyboard input', () => {
    const runtime = new MonitorRuntime();

    runtime.receiveChar(0xbb); // ｻ
    runtime.receiveChar(0xb1); // ｱ

    expect(runtime.popOutputChar()).toBe(0xbb);
    expect(runtime.popOutputChar()).toBe(0xb1);
  });
});
