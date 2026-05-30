/**
 * chat.test.ts - 统一 chat 命令集成测试
 */

import { describe, it, expect, vi } from 'vitest';
import { createChatCommand } from './chat.js';

// Mock 依赖
vi.mock('@core/shared/initialize-runtime.js', () => ({
  initializeRuntime: vi.fn().mockResolvedValue({
    sessionManager: {
      startSession: vi.fn().mockResolvedValue({ id: 'test-session' }),
      closeAll: vi.fn(),
    },
    skillExecutor: {
      execute: vi.fn(),
      list: vi.fn().mockReturnValue([]),
      createSkillsHelp: vi.fn().mockReturnValue('No skills'),
    },
    providerRegistry: {
      resolve: vi.fn().mockReturnValue({ id: 'local', runStep: vi.fn() }),
      list: vi.fn().mockReturnValue(['local']),
    },
    provider: { id: 'local', runStep: vi.fn() },
    toolRegistry: { get: vi.fn(), list: vi.fn() },
    permissionGate: {
      check: vi.fn().mockResolvedValue({ decision: 'allow', mode: 'default' }),
    },
    resolvedRuntime: {
      providerName: 'local',
      modelName: 'local',
      providerConfig: {},
      permissionMode: 'default',
      prompt: undefined,
    },
    mcpManager: {
      startMCP: vi.fn().mockResolvedValue(undefined),
      stopMCP: vi.fn().mockResolvedValue(undefined),
    },
    loadedSettings: {
      settings: {
        runtime: {
          permissionMode: 'default',
          maxStepsPerTurn: 8,
          maxTurns: 20,
          childAgentTimeout: 120000,
          debug: false,
          language: 'en',
        },
      },
      projectConfigDir: null,
    },
  }),
}));

vi.mock('../runtime/agent-loop.js', () => ({
  runAgentLoop: vi.fn().mockReturnValue({
    events$: { subscribe: vi.fn() },
    debug$: { subscribe: vi.fn() },
  }),
}));

vi.mock('../ui/terminal-renderer.js', () => ({
  renderRuntimeEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../ui/debug-renderer.js', () => ({
  renderDebugTrace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../ui/readline-input.js', () => ({
  createInteractiveTurnStream: vi.fn().mockReturnValue({
    turns$: { subscribe: vi.fn() },
    prompt: vi.fn(),
    close: vi.fn(),
    done: Promise.resolve(),
  }),
  createSingleTurnInput: vi.fn().mockReturnValue({ subscribe: vi.fn() }),
  readPipedInput: vi.fn().mockResolvedValue(null),
}));

vi.mock('../ui/tty-detect.js', () => ({
  detectTTY: vi.fn().mockReturnValue({
    stdinIsTTY: true,
    stdoutIsTTY: true,
  }),
}));

describe('createChatCommand', () => {
  it('应该创建 chat 命令', () => {
    const command = createChatCommand();

    expect(command).toBeDefined();
    expect(command.name()).toBe('chat');
  });

  it('应该有正确的选项', () => {
    const command = createChatCommand();
    const options = command.options;

    expect(options.find((o) => o.long === '--message')).toBeDefined();
    expect(options.find((o) => o.long === '--provider')).toBeDefined();
    expect(options.find((o) => o.long === '--role')).toBeDefined();
    expect(options.find((o) => o.long === '--debug')).toBeDefined();
    expect(options.find((o) => o.long === '--permission-mode')).toBeDefined();
  });
});
