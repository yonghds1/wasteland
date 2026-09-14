/**
 * spawn-agent/context-builder.test.ts - 子 agent 上下文组装单元测试
 *
 * 覆盖：
 * - resolveChildProviderSettings：子 agent context window 按自身模型解析
 *   （有独立模型 → 含子模型名；无独立模型 → 继承父 settings）
 */
import { describe, it, expect } from 'vitest';

import { resolveChildProviderSettings } from '../context-builder.js';
import type { SpawnAgentContext, ResolvedSubAgentInput } from '../types.js';

function makeContext(overrides?: Partial<SpawnAgentContext>): SpawnAgentContext {
  return {
    sessionId: 's1',
    turn: 1,
    cwd: '/tmp',
    session: {} as SpawnAgentContext['session'],
    sessionManager: {} as SpawnAgentContext['sessionManager'],
    provider: { id: 'anthropic' } as SpawnAgentContext['provider'],
    providerSettings: {
      type: 'anthropic' as const,
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'k',
      model: 'claude-sonnet-4-6',
    },
    history: [],
    ...overrides,
  };
}

function makeResolved(overrides?: Partial<ResolvedSubAgentInput>): ResolvedSubAgentInput {
  return {
    subAgentConfig: undefined,
    maxRetries: 0,
    retryDelayMs: 1000,
    effectiveTools: undefined,
    effectiveModel: undefined,
    resolvedModelAlias: undefined,
    subAgentConfigModelUsed: false,
    depth: 1,
    ...overrides,
  };
}

describe('resolveChildProviderSettings', () => {
  it('有独立模型时返回含子模型名的 settings', () => {
    const context = makeContext();
    const resolved = makeResolved({
      resolvedModelAlias: 'child-model',
      subAgentConfigModelUsed: true,
    });

    const settings = resolveChildProviderSettings(context, resolved);
    expect(settings).toEqual({
      type: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'k',
      model: 'child-model',
    });
  });

  it('通用名映射路径（subAgentConfigModelUsed=false）映射到实际模型', () => {
    const context = makeContext();
    const resolved = makeResolved({
      resolvedModelAlias: 'sonnet',
      subAgentConfigModelUsed: false,
    });

    const settings = resolveChildProviderSettings(context, resolved);
    expect(settings?.model).toBe('claude-sonnet-4-6');
  });

  it('无独立模型时返回父 settings（继承）', () => {
    const context = makeContext();
    const resolved = makeResolved({ resolvedModelAlias: undefined });

    const settings = resolveChildProviderSettings(context, resolved);
    expect(settings).toBe(context.providerSettings);
    expect(settings?.model).toBe('claude-sonnet-4-6');
  });

  it('父 providerSettings 不存在时返回 undefined', () => {
    const context = makeContext({ providerSettings: undefined });
    const resolved = makeResolved({
      resolvedModelAlias: 'child-model',
      subAgentConfigModelUsed: true,
    });

    expect(resolveChildProviderSettings(context, resolved)).toBeUndefined();
  });

  it('映射不命中时保留原模型名', () => {
    const context = makeContext();
    const resolved = makeResolved({
      resolvedModelAlias: 'custom-model',
      subAgentConfigModelUsed: false,
    });

    const settings = resolveChildProviderSettings(context, resolved);
    expect(settings?.model).toBe('custom-model');
  });
});