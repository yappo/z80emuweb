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
    expect(output).toContain('14 2');
  });

  it('supports IF comparison in RUN program', () => {
    const runtime = new PcG815BasicRuntime();

    const output = executeLines(runtime, [
      '10 LET A=1',
      '20 IF A=1 THEN 40',
      '30 PRINT 0',
      '40 PRINT 9',
      'RUN'
    ]);

    expect(output).toContain('9');
    expect(output).not.toContain('0\r\n');
  });

  it('supports INPUT in immediate mode', () => {
    const runtime = new PcG815BasicRuntime();

    const output = executeLines(runtime, ['INPUT A', '123', 'PRINT A']);

    expect(output).toContain('? ');
    expect(output).toContain('123');
    expect(runtime.getVariables().get('A')).toBe(123);
  });

  it('supports machine-adapter backed CLS', () => {
    let clearCount = 0;
    const runtime = new PcG815BasicRuntime({
      machineAdapter: {
        clearLcd: () => {
          clearCount += 1;
        }
      }
    });

    const output = executeLines(runtime, ['CLS']);

    expect(clearCount).toBe(1);
    expect(output).toContain('OK');
  });

  it('prints syntax errors with numeric code suffix', () => {
    const runtime = new PcG815BasicRuntime();

    const output = executeLines(runtime, ['PRINT']);
    expect(output).toContain('ERR SYNTAX (E01)');
  });

  it('prints dynamic NO LINE errors with numeric code suffix', () => {
    const runtime = new PcG815BasicRuntime();

    const output = executeLines(runtime, ['10 GOTO 999', 'RUN']);
    expect(output).toContain('ERR NO LINE 999 (E06)');
  });

  it('exposes compatibility report', () => {
    const runtime = new PcG815BasicRuntime();
    runtime.loadObservationProfile('public-observed-v1');

    const report = runtime.getCompatibilityReport();
    expect(report.profileId).toBe('public-observed-v1');
    expect(report.totalCommands).toBeGreaterThan(0);
    expect(report.lockedCommands).toBeGreaterThan(0);
    expect(report.lockedUnimplemented).toEqual([]);
    expect(report.tbdCommands.length).toBe(0);
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

  it('supports FOR/NEXT loops with positive and negative STEP', () => {
    const runtime = new PcG815BasicRuntime();

    const output = executeLines(runtime, [
      '10 FOR I=1 TO 3',
      '20 PRINT I',
      '30 NEXT I',
      '40 FOR J=3 TO 1 STEP -1',
      '50 PRINT J',
      '60 NEXT J',
      'RUN'
    ]);

    expect(output).toContain('1');
    expect(output).toContain('2');
    expect(output).toContain('3');
  });

  it('supports DIM with array assignment and reference', () => {
    const runtime = new PcG815BasicRuntime();

    const output = executeLines(runtime, ['DIM A(2)', 'A(1)=7', 'PRINT A(1)']);

    expect(output).toContain('7');
  });

  it('supports DATA/READ/RESTORE stream', () => {
    const runtime = new PcG815BasicRuntime();

    const output = executeLines(runtime, [
      '10 DATA 5,6',
      '20 READ A,B',
      '30 PRINT A,B',
      '40 RESTORE',
      '50 READ C',
      '60 PRINT C',
      'RUN'
    ]);

    expect(output).toContain('5 6');
    expect(output).toContain('5');
  });

  it('supports INP/OUT and PEEK/POKE via machine adapter', () => {
    const ports = new Map<number, number>();
    const memory = new Map<number, number>();
    const runtime = new PcG815BasicRuntime({
      machineAdapter: {
        in8: (port) => ports.get(port & 0xff) ?? 0xff,
        out8: (port, value) => {
          ports.set(port & 0xff, value & 0xff);
        },
        peek8: (address) => memory.get(address & 0xffff) ?? 0xff,
        poke8: (address, value) => {
          memory.set(address & 0xffff, value & 0xff);
        }
      }
    });

    const output = executeLines(runtime, ['OUT 16,99', 'PRINT INP(16)', 'POKE 100,42', 'PRINT PEEK(100)']);

    expect(output).toContain('99');
    expect(output).toContain('42');
  });

  it('uses sleep adapter for WAIT and BEEP', () => {
    const sleeps: number[] = [];
    const runtime = new PcG815BasicRuntime({
      machineAdapter: {
        sleepMs: (ms) => {
          sleeps.push(ms);
        }
      }
    });

    executeLines(runtime, ['WAIT 64', 'WAIT', 'BEEP 8,1,0']);

    expect(sleeps.length).toBe(3);
    expect(sleeps[0]).toBe(1000);
    expect(sleeps[1]).toBe(1000);
    expect(sleeps[2]).toBeGreaterThanOrEqual(1000);
    expect(sleeps[2]).toBeLessThanOrEqual(3000);
  });

  it('supports LOCATE via machine adapter cursor API', () => {
    const positions: Array<[number, number]> = [];
    const runtime = new PcG815BasicRuntime({
      machineAdapter: {
        setTextCursor: (col, row) => {
          positions.push([col, row]);
        }
      }
    });

    executeLines(runtime, ['LOCATE 5,2,1']);

    expect(positions).toEqual([[5, 2]]);
  });
});
