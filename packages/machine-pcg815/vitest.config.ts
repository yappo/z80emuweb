import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json'],
    alias: {
      '@z80emu/core-z80': path.resolve(__dirname, '../core-z80/src/index.ts'),
      '@z80emu/firmware-monitor': path.resolve(__dirname, '../firmware-monitor/src/index.ts')
    }
  },
  test: {
    include: ['tests/**/*.test.ts']
  }
});
