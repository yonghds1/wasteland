/**
 * useRuntime.test.ts - 统一 TUI Runtime 单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import { createTuiRuntime, cleanupTuiRuntime } from './useRuntime.js';

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
    skin: {
      id: 'immortan-joe',
      persona: { fullPrompt: 'Immortan Joe persona' },
      roleUi: { labelKey: 'skins.immortan-joe.label' },
    },
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
    a2aManager: {
      startA2A: vi.fn().mockResolvedValue(undefined),
      stopA2A: vi.fn().mockResolvedValue(undefined),
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
          defaultRole: 'orchestrator',
          skinId: 'immortan-joe',
        },
        providers: {},
        models: {},
        subAgents: {},
        defaultProvider: 'local',
      },
      projectConfigDir: null,
      sources: {},
    },
  }),
}));

vi.mock('@core/runtime/agent-loop.js', () => ({
  runAgentLoop: vi.fn().mockReturnValue({
    events$: { subscribe: vi.fn() },
    debug$: { subscribe: vi.fn() },
  }),
  MAIN_AGENT_TOOL_NAMES: ['spawn_agent', 'read-file', 'bash'],
  filterToolRegistry: vi.fn((registry: any) => registry),
}));

vi.mock('../../skins/index.js', () => ({
  composeAgentPrompt: vi.fn((_skin: unknown, prompt?: string) =>
    prompt ? `Immortan Joe persona\n\n${prompt}` : 'Immortan Joe persona'
  ),
}));

vi.mock('../../locales/index.js', () => ({
  initI18n: vi.fn().mockResolvedValue(undefined),
  t: vi.fn((key: string) => key),
}));

describe('createTuiRuntime', () => {
  it('应该创建 TUI 运行时上下文', async () => {
    const context = await createTuiRuntime('/test');

    expect(context).toBeDefined();
    expect(context.events$).toBeDefined();
    expect(context.debug$).toBeDefined();
    expect(context.input$).toBeDefined();
    expect(context.session).toBeDefined();
    expect(context.config).toBeDefined();
    expect(context.fullConfig).toBeDefined();
  });

  it('应该包含 providerId', async () => {
    const context = await createTuiRuntime('/test');

    expect(context.providerId).toBe('local');
  });

  it('应该把主角色英文 persona 注入 system prompt', async () => {
    const { runAgentLoop } = await import('@core/runtime/agent-loop.js');

    await createTuiRuntime('/test');

    expect(runAgentLoop).toHaveBeenLastCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Immortan Joe persona'),
      })
    );
  });

  it('应该支持 roleName 和 providerName 参数', async () => {
    const { initializeRuntime } = await import('@core/shared/initialize-runtime.js');

    await createTuiRuntime('/test', 'developer', 'ollama');

    expect(initializeRuntime).toHaveBeenCalledWith({
      cwd: '/test',
      roleName: 'developer',
      providerName: 'ollama',
    });
  });
});

describe('cleanupTuiRuntime', () => {
  it('应该清理资源', async () => {
    const context = await createTuiRuntime('/test');
    const mockStopMCP = vi.fn().mockResolvedValue(undefined);
    const mockCloseAll = vi.fn().mockResolvedValue(undefined);

    (context as any).stopMCP = mockStopMCP;
    (context as any).sessionManager = { closeAll: mockCloseAll };

    await cleanupTuiRuntime(context);

    expect(mockStopMCP).toHaveBeenCalled();
    expect(mockCloseAll).toHaveBeenCalled();
  });
});
