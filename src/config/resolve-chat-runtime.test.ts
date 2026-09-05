import { describe, it, expect } from 'vitest';
import { redactSensitiveConfig, resolveChatRuntime } from './resolve-chat-runtime.js';
import { DEFAULT_WASTELAND_SETTINGS, type ResolvedWastelandSettings } from './settings-types.js';

/**
 * 构造一个最小可用的 ResolvedWastelandSettings
 * （基于 DEFAULT_WASTELAND_SETTINGS，补上 local provider 与两个 model）
 */
function makeSettings(
  overrides: Partial<ResolvedWastelandSettings> = {}
): ResolvedWastelandSettings {
  return {
    ...DEFAULT_WASTELAND_SETTINGS,
    providers: { local: {} },
    models: {
      'solo-model': { provider: 'local', model: 'solo-llm' },
      'orch-model': { provider: 'local', model: 'orch-llm' },
    },
    // 提供默认 model，避免角色无 model 时 resolveModel 抛错（既有行为）
    runtime: { ...DEFAULT_WASTELAND_SETTINGS.runtime, defaultModel: 'orch-model' },
    ...overrides,
  };
}

describe('redactSensitiveConfig', () => {
  it('redacts apiKey key', () => {
    const result = redactSensitiveConfig({ apiKey: 'sk-123' });
    expect(result).toEqual({ apiKey: '***' });
  });

  it('redacts api_key key', () => {
    const result = redactSensitiveConfig({ api_key: 'secret' });
    expect(result).toEqual({ api_key: '***' });
  });

  it('redacts token key', () => {
    const result = redactSensitiveConfig({ token: 'abc' });
    expect(result).toEqual({ token: '***' });
  });

  it('redacts secret key', () => {
    const result = redactSensitiveConfig({ secret: 'xyz' });
    expect(result).toEqual({ secret: '***' });
  });

  it('redacts password key', () => {
    const result = redactSensitiveConfig({ password: 'pw123' });
    expect(result).toEqual({ password: '***' });
  });

  it('case insensitive', () => {
    const result = redactSensitiveConfig({
      ApiKey: 'a',
      API_KEY: 'b',
      Secret: 'c',
      TOKEN: 'd',
    });
    expect(result).toEqual({ ApiKey: '***', API_KEY: '***', Secret: '***', TOKEN: '***' });
  });

  it('preserves non-sensitive keys', () => {
    const result = redactSensitiveConfig({ name: 'test', count: 42 });
    expect(result).toEqual({ name: 'test', count: 42 });
  });

  it('redacts nested objects', () => {
    const result = redactSensitiveConfig({
      provider: { apiKey: 'sk-123', baseUrl: 'https://api.com' },
    });
    expect(result).toEqual({
      provider: { apiKey: '***', baseUrl: 'https://api.com' },
    });
  });

  it('redacts in arrays', () => {
    const result = redactSensitiveConfig([
      { token: 'a' },
      { name: 'b' },
    ]);
    expect(result).toEqual([{ token: '***' }, { name: 'b' }]);
  });

  it('returns primitives as-is', () => {
    expect(redactSensitiveConfig('hello')).toBe('hello');
    expect(redactSensitiveConfig(42)).toBe(42);
    expect(redactSensitiveConfig(true)).toBe(true);
  });

  it('returns null as-is', () => {
    expect(redactSensitiveConfig(null)).toBe(null);
  });

  it('returns empty object', () => {
    expect(redactSensitiveConfig({})).toEqual({});
  });
});

/**
 * resolveChatRuntime mode-aware（Phase 4 single 语义）
 *
 * - single 模式优先取 singleAgent.model
 * - single 模式优先取 singleAgent.promptTemplate
 * - single 模式去掉多角色清单（injectOrchestratorAgents 不注入）
 * - multi 模式注入 multiAgent 角色清单
 */
describe('resolveChatRuntime — agentMode', () => {
  it('single 模式优先使用 singleAgent.model', () => {
    const settings = makeSettings({ singleAgent: { model: 'solo-model' } });

    const result = resolveChatRuntime({ settings, agentMode: 'single' });

    expect(result.model?.name).toBe('solo-model');
    expect(result.providerConfig).toMatchObject({ model: 'solo-llm' });
  });

  it('single 模式引用未定义 model 时抛错', () => {
    const settings = makeSettings({ singleAgent: { model: 'ghost-model' } });

    expect(() => resolveChatRuntime({ settings, agentMode: 'single' })).toThrow();
  });

  it('single 模式无 singleAgent.model 时回退角色/默认 model 解析', () => {
    const settings = makeSettings({ singleAgent: { skin: 'warlord-casual' } });

    // 无 singleAgent.model → 回退 runtime.defaultModel（orch-model）
    const result = resolveChatRuntime({ settings, agentMode: 'single' });
    expect(result.model?.name).toBe('orch-model');
    expect(result.providerName).toBe('local');
  });

  it('single 模式优先使用 singleAgent.promptTemplate', () => {
    const settings = makeSettings({
      singleAgent: { promptTemplate: 'role-worker' },
    });

    const result = resolveChatRuntime({ settings, agentMode: 'single' });

    // role-worker 模板特征段
    expect(result.prompt).toContain('Available tools');
    // 不应包含 orchestrator 的多角色清单段
    expect(result.prompt).not.toContain('## Available Agents');
  });

  it('single 模式（无 singleAgent.promptTemplate）去掉多角色清单段', () => {
    const settings = makeSettings({
      multiAgent: { researcher: { description: 'finds stuff' } },
    });

    const result = resolveChatRuntime({ settings, agentMode: 'single' });

    // 默认 orchestrator persona，但 single 模式省略 agents 段
    expect(result.prompt).not.toContain('## Available Agents');
    expect(result.prompt).not.toContain('Deploy them via spawn_agent');
  });

  it('multi 模式注入 multiAgent 角色清单', () => {
    const settings = makeSettings({
      multiAgent: { researcher: { description: 'finds stuff' } },
    });

    const result = resolveChatRuntime({ settings, agentMode: 'multi' });

    expect(result.prompt).toContain('## Available Agents');
    expect(result.prompt).toContain('- researcher: finds stuff');
    expect(result.prompt).toContain('Deploy them via spawn_agent');
  });

  it('multi 模式无 multiAgent 配置时使用模板默认 agents 块', () => {
    const settings = makeSettings({ multiAgent: {} });

    const result = resolveChatRuntime({ settings, agentMode: 'multi' });

    expect(result.prompt).toContain('## Available Agents');
    // 模板默认清单中的内置角色
    expect(result.prompt).toContain('- researcher: information gathering');
  });

  it('agentMode 缺省时回退 settings.runtime.mode', () => {
    // DEFAULT_WASTELAND_SETTINGS.runtime.mode === 'single'
    const settings = makeSettings({
      multiAgent: { researcher: { description: 'finds stuff' } },
    });

    const result = resolveChatRuntime({ settings });

    // runtime.mode 默认 single → 去掉多角色清单
    expect(result.prompt).not.toContain('## Available Agents');
  });
});

// ============================================================
// resolveChatRuntime — 项目记忆注入
// ============================================================

describe('resolveChatRuntime — project memory', () => {
  it('memory 非空时前置注入到 prompt 最前面', () => {
    const settings = makeSettings();
    const result = resolveChatRuntime({
      settings,
      agentMode: 'single',
      memory: '本项目用 Vitest，注释用中文。',
    });

    expect(result.prompt).toMatch(
      /^## Project Memory\n\n本项目用 Vitest，注释用中文。/
    );
  });

  it('memory 为空时不改变 prompt', () => {
    const settings = makeSettings();
    const withMemory = resolveChatRuntime({ settings, agentMode: 'single', memory: '' });
    const withoutParam = resolveChatRuntime({ settings, agentMode: 'single' });

    expect(withMemory.prompt).toBe(withoutParam.prompt);
    expect(withoutParam.prompt).not.toContain('## Project Memory');
  });

  it('memory 为空白字符串（仅空格）时不注入', () => {
    const settings = makeSettings();
    const result = resolveChatRuntime({ settings, agentMode: 'single', memory: '   ' });

    expect(result.prompt).not.toContain('## Project Memory');
  });

  it('multi 模式同样注入 memory（与模式正交）', () => {
    const settings = makeSettings({ multiAgent: { researcher: { role: 'researcher' } } });
    const result = resolveChatRuntime({
      settings,
      agentMode: 'multi',
      roleName: 'orchestrator',
      memory: '遵守项目约定。',
    });

    expect(result.prompt).toMatch(/^## Project Memory\n\n遵守项目约定。/);
    expect(result.prompt).toContain('## Available Agents');
  });
});
