import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      'next/server': path.resolve(__dirname, 'tests/shims/next-server.ts'),
    },
  },
});
