import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: [
      // More specific aliases first
      { find: '@core/shared', replacement: path.resolve(__dirname, 'src/core/shared') },
      { find: '@core/runtime', replacement: path.resolve(__dirname, 'src/core/runtime') },
      { find: '@core/skills', replacement: path.resolve(__dirname, 'src/skills') },
      { find: '@core/logger', replacement: path.resolve(__dirname, 'src/core/logger') },
      { find: '@core', replacement: path.resolve(__dirname, 'src/core') },
      { find: '@config', replacement: path.resolve(__dirname, 'src/config') },
      { find: '@providers', replacement: path.resolve(__dirname, 'src/providers') },
      { find: '@tools', replacement: path.resolve(__dirname, 'src/tools') },
      { find: '@locales', replacement: path.resolve(__dirname, 'src/locales') },
      { find: '@skins', replacement: path.resolve(__dirname, 'src/skins') },
      { find: '@acp', replacement: path.resolve(__dirname, 'src/acp') },
      { find: '@theme', replacement: path.resolve(__dirname, 'src/theme') },
      { find: '@ui', replacement: path.resolve(__dirname, 'src/ui') },
      { find: '@tui', replacement: path.resolve(__dirname, 'src/tui') },
    ],
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globals: true,
    environment: 'node',
  },
});
