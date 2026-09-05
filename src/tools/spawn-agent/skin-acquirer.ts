/**
 * spawn-agent/skin-acquirer.ts - Skin 候选收集与占用
 *
 * 集中处理 spawn_agent 选 skin 的关注点（自 07-28-skinoccupancy）：
 * 1. collectSubAgentSkins - 从 subAgentConfig.skins[] / skin 提取候选
 * 2. selectAndAcquireSkin - 调用 SkinOccupancy.acquireRandom 占用
 *
 * 行为与 spawn-agent.ts 旧实现完全一致（最小外部可见改动）。
 */

import * as skinOccupancy from '@core/runtime/skin-occupancy.js';
import { defaultSkin as defaultRoleSkin } from '@skins/index.js';
import type { SubAgentSettings } from '@config/settings-types.js';

/**
 * 收集子 agent 的 skin 候选列表。
 *
 * 加载时判断，单值优先于数组：
 * - 单值 `skin` 存在 → 返回 `[skin]`（固定皮肤，不随机）
 * - 否则返回 `skins[]` 数组（候选列表，随机选择一个）
 *
 * 单值优先保证「显式固定」语义：只要配置了 `skin`，就忽略 `skins` 数组。
 * 重复项去重 + 顺序保持稳定（用于随机选择的可预测性）。
 *
 * @param subAgentConfig - 子 agent 配置
 * @returns skin 候选列表（单值固定时长度 1；无配置时为空）
 */
export function collectSubAgentSkins(subAgentConfig: SubAgentSettings | undefined): string[] {
  if (!subAgentConfig) return [];

  // 单值优先：显式固定皮肤
  if (typeof subAgentConfig.skin === 'string' && subAgentConfig.skin.trim().length > 0) {
    return [subAgentConfig.skin.trim()];
  }

  const candidates: string[] = [];
  if (Array.isArray(subAgentConfig.skins)) {
    for (const s of subAgentConfig.skins) {
      if (typeof s === 'string' && s.trim().length > 0) {
        const trimmed = s.trim();
        if (!candidates.includes(trimmed)) candidates.push(trimmed);
      }
    }
  }
  return candidates;
}

/**
 * 为子 agent 选择并占用一个 skin。
 *
 * 行为：
 * - 候选列表为空时直接 fallback 到 defaultRoleSkin（不占用）
 * - 候选列表非空时调用 SkinOccupancy.acquireRandom 选可用 skin 并占用
 * - 全部候选被占用时 fallback 到 defaultRoleSkin（不占用，避免占用泄漏）
 *
 * @param candidates - 候选 skin 列表
 * @param sessionId - 子 agent session ID（用于占用）
 * @returns 选中的 skinId（保证非空：候选空时返回 defaultRoleSkin）
 */
export function selectAndAcquireSkin(candidates: string[], sessionId: string): string {
  if (candidates.length === 0) {
    return defaultRoleSkin;
  }

  const picked = skinOccupancy.acquireRandom(candidates, sessionId);
  if (picked) {
    return picked;
  }

  // 全部候选被占用 → fallback defaultRoleSkin（不占用，避免占用泄漏）
  return defaultRoleSkin;
}
