/**
 * initialize-runtime.test.ts - initializeRuntime 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initializeRuntime, type RuntimeEnvironment } from './initialize-runtime.js';

// Mock 依赖
vi.mock('../../config/load-settings.js', () => ({
  loadWastelandSettings: vi.fn().mockResolvedValue({
    settings: {
      runtime: {
        permissionMode: 'default',
        maxStepsPerTurn: 8,
        debug: false,
      },
      providers: {},
      models: {},
    },
    projectConfigDir: null,
    sources: [],
  }),
}));

vi.mock('../../config/resolve-chat-runtime.js', () => ({
  resolveChatRuntime: vi.fn().mockReturnValue({
    providerName: 'local',
    modelName: 'local',
    providerConfig: {},
    permissionMode: 'default',
    prompt: undefined,
  }),
}));

vi.mock('../../providers/provider-registry.js', () => ({
  createDefaultProviderRegistry: vi.fn().mockReturnValue({
    resolve: vi.fn().mockReturnValue({ id: 'local', runStep: vi.fn() }),
    list: vi.fn().mockReturnValue(['local']),
  }),
}));

vi.mock('../runtime/session-manager.js', () => ({
  SessionManager: vi.fn().mockImplementation(function (this: any) {
    this.startSession = vi.fn().mockResolvedValue({ id: 'test-session' });
    this.closeAll = vi.fn();
  }),
}));

vi.mock('../runtime/permission-gate.js', () => ({
  createPermissionGate: vi.fn().mockReturnValue({
    check: vi.fn().mockResolvedValue({ decision: 'allow', mode: 'default' }),
  }),
}));

vi.mock('../../tools/default-registry.js', () => ({
  createDefaultToolRegistry: vi.fn().mockReturnValue({
    toolRegistry: { get: vi.fn(), list: vi.fn() },
    startMCP: vi.fn().mockResolvedValue(undefined),
    stopMCP: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../skills/skill-discovery.js', () => ({
  createSkillRegistry: vi.fn().mockResolvedValue({
    list: vi.fn().mockReturnValue([]),
    get: vi.fn(),
  }),
}));

vi.mock('../../skills/skill-executor.js', () => ({
  SkillExecutor: vi.fn().mockImplementation(function (this: any) {
    this.execute = vi.fn();
    this.list = vi.fn().mockReturnValue([]);
  }),
}));

describe('initializeRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应该返回完整的 RuntimeEnvironment', async () => {
    const result = await initializeRuntime({ cwd: '/test' });

    expect(result).toHaveProperty('sessionManager');
    expect(result).toHaveProperty('skillExecutor');
    expect(result).toHaveProperty('providerRegistry');
    expect(result).toHaveProperty('provider');
    expect(result).toHaveProperty('toolRegistry');
    expect(result).toHaveProperty('permissionGate');
    expect(result).toHaveProperty('resolvedRuntime');
    expect(result).toHaveProperty('mcpManager');
    expect(result).toHaveProperty('loadedSettings');
  });

  it('应该创建 SkillExecutor', async () => {
    const { SkillExecutor } = await import('../../skills/skill-executor.js');
    const result = await initializeRuntime({ cwd: '/test' });

    expect(SkillExecutor).toHaveBeenCalled();
    expect(result.skillExecutor).toBeDefined();
  });

  it('应该返回 mcpManager 包含 startMCP 和 stopMCP', async () => {
    const result = await initializeRuntime({ cwd: '/test' });

    expect(result.mcpManager).toHaveProperty('startMCP');
    expect(result.mcpManager).toHaveProperty('stopMCP');
    expect(typeof result.mcpManager.startMCP).toBe('function');
    expect(typeof result.mcpManager.stopMCP).toBe('function');
  });

  it('应该使用默认环境变量', async () => {
    const { loadWastelandSettings } = await import('../../config/load-settings.js');

    await initializeRuntime({ cwd: '/test' });

    expect(loadWastelandSettings).toHaveBeenCalledWith({
      cwd: '/test',
      env: process.env,
    });
  });

  it('应该支持自定义环境变量', async () => {
    const { loadWastelandSettings } = await import('../../config/load-settings.js');
    const customEnv = { ...process.env, CUSTOM: 'value' };

    await initializeRuntime({ cwd: '/test', env: customEnv });

    expect(loadWastelandSettings).toHaveBeenCalledWith({
      cwd: '/test',
      env: customEnv,
    });
  });

  it('应该传递 roleName 和 providerName', async () => {
    const { resolveChatRuntime } = await import('../../config/resolve-chat-runtime.js');

    await initializeRuntime({
      cwd: '/test',
      roleName: 'developer',
      providerName: 'openai',
    });

    expect(resolveChatRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        roleName: 'developer',
        providerName: 'openai',
      })
    );
  });
});

describe('RuntimeEnvironment type', () => {
  it('应该包含所有必需字段', () => {
    // 类型检查 - 编译时验证
    const env: RuntimeEnvironment = {
      sessionManager: {} as any,
      skillExecutor: {} as any,
      providerRegistry: {} as any,
      provider: {} as any,
      toolRegistry: {} as any,
      permissionGate: {} as any,
      resolvedRuntime: {} as any,
      mcpManager: { startMCP: async () => {}, stopMCP: async () => {} },
      loadedSettings: {} as any,
    };

    expect(env).toBeDefined();
  });
});
