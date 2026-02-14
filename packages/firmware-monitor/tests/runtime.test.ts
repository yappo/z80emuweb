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

  it('exposes compatibility report', () => {
    const runtime = new PcG815BasicRuntime();
    runtime.loadObservationProfile('public-observed-v1');

    const report = runtime.getCompatibilityReport();
    expect(report.profileId).toBe('public-observed-v1');
    expect(report.totalCommands).toBeGreaterThan(0);
    expect(report.lockedCommands).toBeGreaterThan(0);
    expect(report.lockedUnimplemented).toEqual([]);
    expect(report.tbdCommands.length).toBeGreaterThan(0);
  });

  it('maintains character I/O mode via MonitorRuntime alias', () => {
    const runtime = new MonitorRuntime();

    typeLine(runtime, 'LET A=10');
    typeLine(runtime, 'PRINT A');

    const output = drain(runtime);
    expect(output).toContain('LET A=10');
    expect(output).toContain('10');
  });
});
