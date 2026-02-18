import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json'],
    alias: {
      '@z80emu/core-z80': path.resolve(__dirname, '../../packages/core-z80/src/index.ts'),
      '@z80emu/firmware-monitor': path.resolve(__dirname, '../../packages/firmware-monitor/src/index.ts'),
      '@z80emu/machine-chipsets': path.resolve(__dirname, '../../packages/machine-chipsets/src/index.ts'),
      '@z80emu/machine-pcg815': path.resolve(__dirname, '../../packages/machine-pcg815/src/index.ts')
    }
  },
  test: {
    include: ['src/**/*.test.ts'],
    passWithNoTests: true
  }
});
