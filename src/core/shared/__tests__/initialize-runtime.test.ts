/**
 * initialize-runtime.test.ts - initializeRuntime 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  initializeRuntime,
  resolveAgentMode,
  type RuntimeEnvironment,
} from '../initialize-runtime.js';

// Mock 依赖
vi.mock('../../../config/load-settings.js', () => ({
  loadWastelandSettings: vi.fn().mockResolvedValue({
    settings: {
      runtime: {
        permissionMode: 'default',
        maxStepsPerTurn: 8,
        debug: false,
      },
      providers: {},
      models: {},
      multiAgent: {},
      mcpServers: {},
      acp: { agents: [] },
    },
    projectConfigDir: null,
    sources: [],
  }),
}));

vi.mock('../../../config/resolve-chat-runtime.js', () => ({
  resolveChatRuntime: vi.fn().mockReturnValue({
    providerName: 'local',
    modelName: 'local',
    providerConfig: {},
    permissionMode: 'default',
    prompt: undefined,
  }),
}));

vi.mock('../../../providers/provider-registry.js', () => ({
  createDefaultProviderRegistry: vi.fn().mockReturnValue({
    resolve: vi.fn().mockReturnValue({ id: 'local', runStep: vi.fn() }),
    list: vi.fn().mockReturnValue(['local']),
  }),
}));

vi.mock('../../runtime/session-manager.js', () => ({
  SessionManager: vi.fn().mockImplementation(function (this: any) {
    this.startSession = vi.fn().mockResolvedValue({ id: 'test-session' });
    this.closeAll = vi.fn();
  }),
}));

vi.mock('../../runtime/permission-gate.js', () => ({
  createPermissionGate: vi.fn().mockReturnValue({
    check: vi.fn().mockResolvedValue({ decision: 'allow', mode: 'default' }),
  }),
}));

vi.mock('../../../tools/default-registry.js', () => ({
  createDefaultToolRegistry: vi.fn().mockReturnValue({
    toolRegistry: { get: vi.fn(), list: vi.fn() },
    startMCP: vi.fn().mockResolvedValue(undefined),
    stopMCP: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../../../skills/skill-discovery.js', () => ({
  createSkillRegistry: vi.fn().mockResolvedValue({
    list: vi.fn().mockReturnValue([]),
    get: vi.fn(),
  }),
}));

vi.mock('../../../skills/skill-executor.js', () => ({
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
    expect(result).toHaveProperty('skin');
    expect(result.skin).toHaveProperty('label');
    expect(result).toHaveProperty('mcpManager');
    expect(result).toHaveProperty('loadedSettings');
  });

  it('应该创建 SkillExecutor', async () => {
    const { SkillExecutor } = await import('../../../skills/skill-executor.js');
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
    const { loadWastelandSettings } = await import('../../../config/load-settings.js');

    await initializeRuntime({ cwd: '/test' });

    expect(loadWastelandSettings).toHaveBeenCalledWith({
      cwd: '/test',
      env: process.env,
    });
  });

  it('应该支持自定义环境变量', async () => {
    const { loadWastelandSettings } = await import('../../../config/load-settings.js');
    const customEnv = { ...process.env, CUSTOM: 'value' };

    await initializeRuntime({ cwd: '/test', env: customEnv });

    expect(loadWastelandSettings).toHaveBeenCalledWith({
      cwd: '/test',
      env: customEnv,
    });
  });

  it('应该传递 roleName 和 providerName', async () => {
    const { resolveChatRuntime } = await import('../../../config/resolve-chat-runtime.js');

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
      agentMode: 'single',
      skin: {} as any,
      mcpManager: { startMCP: async () => {}, stopMCP: async () => {} },
      loadedSettings: {} as any,
    };

    expect(env).toBeDefined();
  });
});

/**
 * single 模式主 Agent 皮肤解析
 *
 * single 模式的皮肤真源是 skins.json 的 `singleAgent.skin`（内置默认 road-nomad）；
 * `settings.runtime.skinId` 只驱动 multi 模式 main 皮肤与角色别名，不参与 single 解析。
 *
 * 注：本块此前名为「runtime.skinId 校验（H3）」，测的是「非法 skinId 打 warning」这一
 * 已被移除的行为；且 helper 未设 singleAgent，断言走的是 getSkin(undefined) →
 * defaultSkin 的回退链——skinId 实际从未被读取，测试只是碰巧通过。
 */
describe('initializeRuntime — single 模式皮肤解析', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function makeLoadedSettings(skinId: string | undefined) {
    return {
      settings: {
        runtime: {
          permissionMode: 'default',
          maxStepsPerTurn: 8,
          debug: false,
          skinId,
        },
        providers: {},
        models: {},
        multiAgent: {},
        mcpServers: {},
        acp: { agents: [] },
      },
      projectConfigDir: null,
      sources: [],
    };
  }

  it('取 skins.json 的 singleAgent.skin（内置默认 road-nomad）', async () => {
    const { loadWastelandSettings } = await import('../../../config/load-settings.js');
    vi.mocked(loadWastelandSettings).mockResolvedValueOnce(
      makeLoadedSettings('warlord-immortal') as any
    );

    const result = await initializeRuntime({ cwd: '/test' });
    expect(warnSpy).not.toHaveBeenCalled();
    // 配置里写的是 warlord-immortal，但 single 模式不读 runtime.skinId
    expect((result.skin as { id?: string }).id).toBe('road-nomad');
  });

  it('runtime.skinId 拼错不影响 single 模式皮肤', async () => {
    const { loadWastelandSettings } = await import('../../../config/load-settings.js');
    vi.mocked(loadWastelandSettings).mockResolvedValueOnce(
      makeLoadedSettings('nonexistent-skin-typo') as any
    );

    const result = await initializeRuntime({ cwd: '/test' });
    expect((result.skin as { id?: string }).id).toBe('road-nomad');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('runtime.skinId 缺省同样取 skins.json 的 singleAgent.skin', async () => {
    const { loadWastelandSettings } = await import('../../../config/load-settings.js');
    vi.mocked(loadWastelandSettings).mockResolvedValueOnce(makeLoadedSettings(undefined) as any);

    const result = await initializeRuntime({ cwd: '/test' });
    expect(warnSpy).not.toHaveBeenCalled();
    expect((result.skin as { id?: string }).id).toBe('road-nomad');
  });
});

/**
 * resolveAgentMode：--mode 启动参数收窄为 'single' | 'multi'
 */
describe('resolveAgentMode', () => {
  it("透传合法值 'single'", () => {
    expect(resolveAgentMode('single')).toBe('single');
  });

  it("透传合法值 'multi'", () => {
    expect(resolveAgentMode('multi')).toBe('multi');
  });

  it('undefined → undefined（交由配置/默认值兜底）', () => {
    expect(resolveAgentMode(undefined)).toBeUndefined();
  });

  it('非法值进入运行时前抛错', () => {
    expect(() => resolveAgentMode('triple')).toThrow();
  });
});

/**
 * --mode 启动参数：agentMode 选择 + 主 skin 切换 + 透传 resolveChatRuntime
 *
 * agentMode 来源优先级：params.mode > settings.runtime.mode > 'single'
 * skin：single → singleAgent.skin，multi → multiAgent.main.skin
 */
describe('initializeRuntime — --mode 覆盖（agentMode）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeModeSettings(overrides: {
    mode?: 'single' | 'multi';
    singleAgent?: { skin?: string; model?: string; promptTemplate?: string };
    multiAgent?: Record<string, { skin?: string }>;
  }) {
    return {
      settings: {
        runtime: {
          permissionMode: 'default',
          maxStepsPerTurn: 8,
          debug: false,
          mode: overrides.mode,
        },
        providers: {},
        models: {},
        multiAgent: overrides.multiAgent ?? {},
        singleAgent: overrides.singleAgent,
        mcpServers: {},
        acp: { agents: [] },
      },
      projectConfigDir: null,
      sources: [],
    };
  }

  it('params.mode=multi 覆盖 settings.runtime.mode=single', async () => {
    const { loadWastelandSettings } = await import('../../../config/load-settings.js');
    vi.mocked(loadWastelandSettings).mockResolvedValueOnce(
      makeModeSettings({ mode: 'single' }) as any
    );

    const result = await initializeRuntime({ cwd: '/test', mode: 'multi' });
    expect(result.agentMode).toBe('multi');
  });

  it('未传 params.mode 时回退 settings.runtime.mode', async () => {
    const { loadWastelandSettings } = await import('../../../config/load-settings.js');
    vi.mocked(loadWastelandSettings).mockResolvedValueOnce(
      makeModeSettings({ mode: 'multi' }) as any
    );

    const result = await initializeRuntime({ cwd: '/test' });
    expect(result.agentMode).toBe('multi');
  });

  it('两者都缺省时回退 single', async () => {
    const { loadWastelandSettings } = await import('../../../config/load-settings.js');
    vi.mocked(loadWastelandSettings).mockResolvedValueOnce(makeModeSettings({}) as any);

    const result = await initializeRuntime({ cwd: '/test' });
    expect(result.agentMode).toBe('single');
  });

  it('single 模式取 singleAgent.skin', async () => {
    const { loadWastelandSettings } = await import('../../../config/load-settings.js');
    vi.mocked(loadWastelandSettings).mockResolvedValueOnce(
      makeModeSettings({
        mode: 'single',
        singleAgent: { skin: 'road-nomad' },
        multiAgent: { main: { skin: 'fury-vanguard' } },
      }) as any
    );

    const result = await initializeRuntime({ cwd: '/test' });
    expect(result.agentMode).toBe('single');
    expect((result.skin as { id?: string }).id).toBe('road-nomad');
  });

  it('multi 模式取 multiAgent.main.skin', async () => {
    const { loadWastelandSettings } = await import('../../../config/load-settings.js');
    vi.mocked(loadWastelandSettings).mockResolvedValueOnce(
      makeModeSettings({
        mode: 'multi',
        singleAgent: { skin: 'road-nomad' },
        multiAgent: { main: { skin: 'fury-vanguard' } },
      }) as any
    );

    const result = await initializeRuntime({ cwd: '/test' });
    expect(result.agentMode).toBe('multi');
    expect((result.skin as { id?: string }).id).toBe('fury-vanguard');
  });

  it('agentMode 透传给 resolveChatRuntime', async () => {
    const { loadWastelandSettings } = await import('../../../config/load-settings.js');
    const { resolveChatRuntime } = await import('../../../config/resolve-chat-runtime.js');
    vi.mocked(loadWastelandSettings).mockResolvedValueOnce(
      makeModeSettings({ mode: 'single' }) as any
    );

    await initializeRuntime({ cwd: '/test', mode: 'multi' });
    expect(resolveChatRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ agentMode: 'multi' })
    );
  });
});
