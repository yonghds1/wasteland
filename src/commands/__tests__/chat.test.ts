/**
 * chat.test.ts - 统一 chat 命令集成测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createChatCommand, resolveExitCode } from '../chat.js';
import { StreamJsonOutputAdapter } from '@ui/stream-json-output-adapter.js';

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

vi.mock('../../runtime/agent-loop.js', () => ({
  runAgentLoop: vi.fn().mockReturnValue({
    events$: { subscribe: vi.fn() },
    debug$: { subscribe: vi.fn() },
  }),
  MAIN_AGENT_TOOL_NAMES: ['spawn_agent', 'read-file', 'list-directory', 'glob', 'grep', 'bash'],
  filterToolRegistry: vi.fn((registry: any) => registry),
}));

vi.mock('../../ui/terminal-renderer.js', () => ({
  renderRuntimeEvents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../ui/debug-renderer.js', () => ({
  renderDebugTrace: vi.fn().mockResolvedValue(undefined),
}));

const mockCreateSingleTurnInput = vi.fn().mockReturnValue({
  pipe: vi.fn().mockReturnValue({ subscribe: vi.fn() }),
  subscribe: vi.fn(),
});

vi.mock('../../ui/readline-input.js', () => ({
  createSingleTurnInput: (...args: any[]) => mockCreateSingleTurnInput(...args),
  readPipedInput: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../ui/tty-detect.js', () => ({
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应该创建 chat 命令', () => {
    const command = createChatCommand();

    expect(command).toBeDefined();
    expect(command.name()).toBe('chat');
  });

  it('应该有正确的选项与参数定义', () => {
    const command = createChatCommand();
    const options = command.options;

    // -p 归还给 prompt，--provider 移除 -p 短参数
    const promptOpt = options.find((o) => o.long === '--prompt');
    expect(promptOpt).toBeDefined();
    expect(promptOpt?.short).toBe('-p');

    const messageOpt = options.find((o) => o.long === '--message');
    expect(messageOpt).toBeDefined();
    expect(messageOpt?.short).toBe('-m');

    const providerOpt = options.find((o) => o.long === '--provider');
    expect(providerOpt).toBeDefined();
    expect(providerOpt?.short).toBeUndefined();

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

  it('使用 -p / --prompt 时触发单轮消息执行', async () => {
    await createChatCommand().parseAsync(['-p', 'hello prompt'], { from: 'user' });
    expect(mockCreateSingleTurnInput).toHaveBeenCalledWith('hello prompt', 'message');
  });

  it('--prompt 与 --message 同时提供时优先使用 --prompt', async () => {
    await createChatCommand().parseAsync(['--message', 'old msg', '--prompt', 'new prompt'], { from: 'user' });
    expect(mockCreateSingleTurnInput).toHaveBeenCalledWith('new prompt', 'message');
  });

  it('使用位置参数 [prompt] 时触发单轮消息执行', async () => {
    await createChatCommand().parseAsync(['positional prompt'], { from: 'user' });
    expect(mockCreateSingleTurnInput).toHaveBeenCalledWith('positional prompt', 'message');
  });
  it('指定 --output-format stream-json 时调用 StreamJsonOutputAdapter', async () => {
    const handleSpy = vi.spyOn(StreamJsonOutputAdapter.prototype, 'handleEvents').mockResolvedValue(undefined);
    try {
      await createChatCommand().parseAsync(['-p', 'hi', '--output-format', 'stream-json'], { from: 'user' });
      expect(handleSpy).toHaveBeenCalledTimes(1);
    } finally {
      handleSpy.mockRestore();
    }
  });

  it('应该支持 --output-format 与 --json 选项', () => {
    const command = createChatCommand();
    const options = command.options;

    expect(options.find((o) => o.long === '--output-format')).toBeDefined();
    expect(options.find((o) => o.long === '--json')).toBeDefined();
  });

  describe('resolveExitCode', () => {
    it('stop 映射为 0', () => {
      expect(resolveExitCode('stop')).toBe(0);
    });

    it('error 映射为 2', () => {
      expect(resolveExitCode('error')).toBe(2);
    });

    it('max_steps 映射为 3', () => {
      expect(resolveExitCode('max_steps')).toBe(3);
    });

    it('abort 映射为 130', () => {
      expect(resolveExitCode('abort')).toBe(130);
    });

    it('其他未知原因映射为 1', () => {
      expect(resolveExitCode('unknown' as any)).toBe(1);
    });
  });
});
