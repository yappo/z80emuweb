import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json']
  },
  test: {
    include: ['tests/**/*.test.ts']
  }
});
