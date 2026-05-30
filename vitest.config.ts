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
    include: ['src/**/*.test.ts'],
    exclude: ['test/**/*.ts'],
  },
});
