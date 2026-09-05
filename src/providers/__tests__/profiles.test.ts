/**
 * profiles.test.ts - ProviderProfile 声明式表单元测试
 *
 * 覆盖：
 * - 内置供应商表（deepseek/minimax/xiaomi/jdcloud/openai 等）存在且结构正确
 * - resolveProviderProfile：baseUrl / model 判定供应商、默认兜底、settings 局部覆盖
 * - resolveModelContextWindow：精确 / 模糊 / 大小写不敏感 / 默认值
 * - contextWindow 数据与原 MODEL_CONTEXT_WINDOWS 行为一致
 */

import { describe, it, expect } from 'vitest';
import {
  PROVIDER_PROFILES,
  DEFAULT_CONTEXT_WINDOW,
  resolveProviderProfile,
  resolveModelContextWindow,
} from '../profiles.js';

// ============================================================
// 内置 Profile 表
// ============================================================

describe('PROVIDER_PROFILES', () => {
  it('包含当前配置涉及的供应商（minimax/jdcloud/xiaomi）', () => {
    expect(PROVIDER_PROFILES['minimax']).toBeDefined();
    expect(PROVIDER_PROFILES['jdcloud']).toBeDefined();
    expect(PROVIDER_PROFILES['xiaomi']).toBeDefined();
  });

  it('deepseek profile 声明了 prompt_cache_hit_tokens 缓存字段', () => {
    expect(PROVIDER_PROFILES['deepseek'].usageFields).toContain('prompt_cache_hit_tokens');
  });

  it('openai profile 声明 OpenAI 官方缓存字段', () => {
    expect(PROVIDER_PROFILES['openai'].usageFields).toContain(
      'prompt_tokens_details.cached_tokens'
    );
  });

  it('deepseek-v3 与 deepseek-v2.5 已确认窗口入表', () => {
    expect(PROVIDER_PROFILES['deepseek'].contextWindows).toMatchObject({
      'deepseek-v3': 64000,
      'deepseek-v2.5': 32768,
    });
  });

  it('mimo-v2.5 与 deepseek-r1 等已确认窗口入表', () => {
    const allWindows = Object.values(PROVIDER_PROFILES).flatMap((p) =>
      Object.keys(p.contextWindows ?? {})
    );
    expect(allWindows).toContain('mimo-v2.5');
    expect(allWindows).toContain('deepseek-r1');
    expect(allWindows).not.toContain('deepseek-v4');
  });

  it('stripReasoning / extraBody 为预留字段，不强制存在（仅类型声明）', () => {
    // 预留字段不做实现，仅确认表结构合法（不抛错即可）
    expect(() => JSON.parse(JSON.stringify(PROVIDER_PROFILES))).not.toThrow();
  });
});

// ============================================================
// resolveProviderProfile（供应商归属）
// ============================================================

describe('resolveProviderProfile', () => {
  it('按 baseUrl 判定 deepseek', () => {
    const profile = resolveProviderProfile({
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    });
    expect(profile.id).toBe('deepseek');
  });

  it('按 baseUrl 判定 minimax（minimaxi.com）', () => {
    const profile = resolveProviderProfile({
      baseUrl: 'https://api.minimaxi.com/v1',
    });
    expect(profile.id).toBe('minimax');
  });

  it('按 baseUrl 判定 xiaomi（xiaomimimo.com）', () => {
    const profile = resolveProviderProfile({
      baseUrl: 'https://api.xiaomimimo.com/v1',
    });
    expect(profile.id).toBe('xiaomi');
  });

  it('按 baseUrl 判定 jdcloud', () => {
    const profile = resolveProviderProfile({
      baseUrl: 'https://openai.jdcloud.com/v1',
    });
    expect(profile.id).toBe('jdcloud');
  });

  it('baseUrl 未命中时按 model 名判定（deepseek-chat）', () => {
    const profile = resolveProviderProfile({
      model: 'deepseek-chat',
    });
    expect(profile.id).toBe('deepseek');
  });

  it('baseUrl 与 model 均未命中时兜底为 openai 默认', () => {
    const profile = resolveProviderProfile({});
    expect(profile.id).toBe('openai');
  });

  it('settings 的 usageFields 局部覆盖优先于 profile 内置', () => {
    const profile = resolveProviderProfile({
      baseUrl: 'https://api.deepseek.com/v1',
      usageFields: ['custom_cached_tokens'],
    });
    expect(profile.usageFields[0]).toBe('custom_cached_tokens');
  });

  it('未声明专用缓存字段的供应商仍追加 OpenAI 官方字段兜底', () => {
    const profile = resolveProviderProfile({
      baseUrl: 'https://api.minimaxi.com/v1',
    });
    expect(profile.usageFields).toContain('prompt_tokens_details.cached_tokens');
  });

  it('非法 usageFields 覆盖（非字符串数组）被忽略', () => {
    const profile = resolveProviderProfile({
      baseUrl: 'https://api.deepseek.com/v1',
      usageFields: 'invalid-string',
    });
    expect(profile.usageFields).toContain('prompt_cache_hit_tokens');
  });
});

// ============================================================
// resolveModelContextWindow
// ============================================================

describe('resolveModelContextWindow', () => {
  it('精确匹配返回对应窗口', () => {
    expect(resolveModelContextWindow('gpt-4o')).toBe(128000);
    expect(resolveModelContextWindow('deepseek-v3')).toBe(64000);
    expect(resolveModelContextWindow('deepseek-v2.5')).toBe(32768);
    expect(resolveModelContextWindow('claude-3-5-sonnet')).toBe(200000);
    expect(resolveModelContextWindow('gpt-4')).toBe(8192);
    expect(resolveModelContextWindow('mimo-v2.5')).toBe(262144);
  });

  it('模糊匹配带版本后缀的模型名', () => {
    expect(resolveModelContextWindow('gpt-4o-2024-08-06')).toBe(128000);
  });

  it('大小写不敏感匹配（如 MiniMax-M3 / GLM-5）', () => {
    expect(resolveModelContextWindow('MiniMax-M3')).toBe(128000);
    expect(resolveModelContextWindow('GLM-5')).toBe(128000);
    expect(resolveModelContextWindow('glm-4')).toBe(128000);
  });

  it('未知模型返回默认值', () => {
    expect(resolveModelContextWindow('some-random-model')).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it('无可靠数据模型（deepseek-v4）走默认值', () => {
    expect(resolveModelContextWindow('deepseek-v4')).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it('与原 MODEL_CONTEXT_WINDOWS 表数据一致（逐项核对）', () => {
    const expected: Record<string, number> = {
      'gpt-4o': 128000,
      'gpt-4o-mini': 128000,
      'gpt-4-turbo': 128000,
      'gpt-4': 8192,
      'gpt-3.5-turbo': 16385,
      'claude-3-5-sonnet': 200000,
      'claude-3-5-haiku': 200000,
      'claude-3-opus': 200000,
      'claude-3-sonnet': 200000,
      'claude-3-haiku': 200000,
      'deepseek-v3': 64000,
      'deepseek-v2.5': 32768,
      'minimax-m3': 128000,
      'minimax-m2.7': 128000,
      'qwen-max': 32768,
      'qwen-plus': 131072,
      'qwen-turbo': 131072,
      'glm-5': 128000,
      'glm-4': 128000,
      'mimo-v2.5': 262144,
    };
    for (const [model, window] of Object.entries(expected)) {
      expect(resolveModelContextWindow(model)).toBe(window);
    }
  });
});
