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
    include: ['src/**/*.test.ts', 'test/**/*.test.js'],
    exclude: [
      'test/**/*.ts',
      'test/cli.test.js',
      'test/interactive-ui.test.js',
      'test/tool-runtime.test.js',
      'test/commands/session-index.test.js',
      'test/commands/sessions.test.js',
      'test/mcp/mcp-client.test.js',
      'test/providers/tool-calling-e2e.test.js',
      'test/runtime/agent-loop.test.js',
      'test/runtime/multi-agent-e2e.test.js',
      'test/tools/new-tools.test.js',
    ],
  },
});
