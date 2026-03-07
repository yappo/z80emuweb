import path from 'node:path';

import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  resolve: {
    // Prefer TS sources over accidental stale JS artifacts inside package src folders.
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json'],
    alias: {
      '@z80emu/core-z80': path.resolve(__dirname, '../../packages/core-z80/src/index.ts'),
      '@z80emu/firmware-monitor': path.resolve(__dirname, '../../packages/firmware-monitor/src/index.ts'),
      '@z80emu/firmware-z80-basic': path.resolve(
        __dirname,
        '../../packages/firmware-z80-basic/src/index.ts'
      ),
      '@z80emu/lcd-144x32': path.resolve(__dirname, '../../packages/lcd-144x32/src/index.ts'),
      '@z80emu/machine-chipsets': path.resolve(
        __dirname,
        '../../packages/machine-chipsets/src/index.ts'
      ),
      '@z80emu/assembler-z80': path.resolve(__dirname, '../../packages/assembler-z80/src/index.ts'),
      '@z80emu/machine-pcg815': path.resolve(
        __dirname,
        '../../packages/machine-pcg815/src/index.ts'
      )
    }
  },
  build: {
    target: 'es2022'
  }
});
