/**
 * usage-normalization.ts - OpenAI 兼容供应商 usage 字段归一化
 *
 * 从 `providers/openai.ts` 拆出，用于控制单文件行数（CLAUDE.md: 单文件 ≤500 行）。
 * 各厂商缓存 token 字段名不统一（OpenAI 用嵌套 `prompt_tokens_details.cached_tokens`，
 * DeepSeek 用扁平 `prompt_cache_hit_tokens`），由 profile.usageFields 声明候选路径，
 * 这里统一读成 `cachedTokens`，供应商原始字段名不向上泄漏。
 */

import type { ProviderProfile } from '../profiles.js';
import type { OpenAIStreamChunk } from '../openai-compatible/stream-types.js';

/**
 * 按点号路径读取嵌套字段
 *
 * 供应商缓存字段可能是嵌套路径（"prompt_tokens_details.cached_tokens"）
 * 或扁平路径（"prompt_cache_hit_tokens"），统一用点号路径读取。
 */
function readNestedPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current === undefined || current === null) return undefined;
    if (typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, obj);
}

/**
 * 从 usage 中读取缓存 token 数
 *
 * 按 profile.usageFields 候选顺序，取第一个非空值归一化。
 *
 * @param usage - provider 返回的原始 usage
 * @param profile - 命中的供应商 profile
 * @returns 归一化后的缓存 token 数；所有字段缺失时为 undefined
 */
export function readCachedTokens(
  usage: OpenAIStreamChunk['usage'] | undefined,
  profile: ProviderProfile
): number | undefined {
  if (!usage) return undefined;
  for (const field of profile.usageFields) {
    const value = readNestedPath(usage, field);
    if (typeof value === 'number' && value >= 0) {
      return value;
    }
  }
  return undefined;
}
