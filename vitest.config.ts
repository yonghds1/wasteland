import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@core/shared': path.resolve(__dirname, 'src/core/shared'),
      '@core/runtime': path.resolve(__dirname, 'src/core/runtime'),
      '@core/adapters': path.resolve(__dirname, 'src/core/adapters'),
      '@core/skills': path.resolve(__dirname, 'src/skills'),
      '@config': path.resolve(__dirname, 'src/config'),
      '@providers': path.resolve(__dirname, 'src/providers'),
      '@ui': path.resolve(__dirname, 'src/ui'),
      '@tui': path.resolve(__dirname, 'src/tui'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.js'],
    exclude: [
      'test/**/*.ts',
      'test/cli.test.js',
      'test/providers/tool-calling-e2e.test.js',
      'test/manual/**',
    ],
    globals: true,
    environment: 'node',
  },
});
