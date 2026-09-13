/**
 * chat.test.ts - 统一 chat 命令集成测试
 */

import { describe, it, expect, vi } from 'vitest';
import { createChatCommand } from './chat.js';

// Mock 依赖
vi.mock('@core/shared/initialize-runtime.js', () => ({
  // --mode 启动参数收窄；测试不传 --mode 时返回 undefined
  resolveAgentMode: vi.fn((value: string | undefined) => value),
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
  MAIN_AGENT_TOOL_NAMES: ['spawn_agent', 'read-file', 'list-directory', 'glob', 'grep', 'bash'],
  filterToolRegistry: vi.fn((registry: any) => registry),
}));

vi.mock('../ui/terminal-renderer.js', () => ({
  renderRuntimeEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../ui/debug-renderer.js', () => ({
  renderDebugTrace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../ui/readline-input.js', () => ({
  createSingleTurnInput: vi.fn().mockReturnValue({ subscribe: vi.fn() }),
  readPipedInput: vi.fn().mockResolvedValue(null),
}));

vi.mock('../ui/tty-detect.js', () => ({
  detectTTY: vi.fn().mockReturnValue({
    stdinIsTTY: true,
    stdoutIsTTY: true,
  }),
}));

vi.mock('@core/runtime/debug-logger.js', () => ({
  initializeFileSinkFromEnv: vi.fn(),
  enableDebugLog: vi.fn(),
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
    expect(options.find((o) => o.long === '--dangerously-skip-permissions')).toBeDefined();
    expect(options.find((o) => o.long === '--permission-mode')).toBeDefined();
    expect(options.find((o) => o.long === '--mode')).toBeDefined();
  });

  it('启动时调用 initializeFileSinkFromEnv 装配 FileSink', async () => {
    const debugMod = await import('@core/runtime/debug-logger.js');
    const initSpy = vi.spyOn(debugMod, 'initializeFileSinkFromEnv').mockImplementation(() => undefined);
    try {
      await createChatCommand().parseAsync(['--message', 'hi'], { from: 'user' });
    } catch {
      // parseAsync 在某些情况下会 exit；忽略
    }
    expect(initSpy).toHaveBeenCalledTimes(1);
    initSpy.mockRestore();
  });

  it('--debug 触发时调用 enableDebugLog 升 level', async () => {
    const debugMod = await import('@core/runtime/debug-logger.js');
    const enableSpy = vi.spyOn(debugMod, 'enableDebugLog').mockImplementation(() => undefined);
    try {
      await createChatCommand().parseAsync(['--debug', '--message', 'hi'], { from: 'user' });
    } catch {
      // ignore
    }
    expect(enableSpy).toHaveBeenCalledTimes(1);
    enableSpy.mockRestore();
  });
});
