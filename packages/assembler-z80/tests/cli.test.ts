import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { runCli } from '../src/cli';

describe('assembler-z80 cli', () => {
  it('writes BIN/LST/SYM and returns 0 on success', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'z80asm-'));
    try {
      const input = path.join(tempDir, 'prog.asm');
      const outBin = path.join(tempDir, 'out.bin');
      const outLst = path.join(tempDir, 'out.lst');
      const outSym = path.join(tempDir, 'out.sym');

      writeFileSync(input, 'ORG 0x0000\nSTART: LD A,1\nJP START\n', 'utf8');

      const code = runCli(['-i', input, '-o', outBin, '--lst', outLst, '--sym', outSym]);
      expect(code).toBe(0);
      expect(Array.from(readFileSync(outBin))).toEqual([0x3e, 0x01, 0xc3, 0x00, 0x00]);
      expect(readFileSync(outLst, 'utf8')).toContain('START: LD A,1');
      expect(readFileSync(outSym, 'utf8')).toContain('START');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('returns 1 when assembly fails', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'z80asm-'));
    try {
      const input = path.join(tempDir, 'bad.asm');
      writeFileSync(input, 'ORG 0x9000\nLD A,1\n', 'utf8');
      const code = runCli(['-i', input]);
      expect(code).toBe(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
