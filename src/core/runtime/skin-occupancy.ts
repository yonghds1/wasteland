/**
 * skin-occupancy.ts - 子 Agent 皮肤占用管理
 *
 * 多个 subAgent 同时运行时，避免它们使用同一个 persona
 * （minimax 看到"两个人格同进"会出现混乱）。
 * 简单的 in-memory Map 注册表：
 * - 同 skin 可支持多个 session（多 subAgent 复用同一 persona 的合法场景）
 * - 每次 spawn 完成后必须 release，否则占用会泄漏
 * - 进程崩溃时状态自然丢失（acceptable —— 占用只是 spawn 期间的临时锁）
 *
 * 设计约束：
 * - 纯内存，进程级 singleton
 * - API 极简：tryAcquire / release / getAvailable
 * - 所有方法都是同步 O(1)
 */

import { Logger } from '@core/logger/index.js';

/**
 * 皮肤占用条目：皮肤 ID → 持有该皮肤的 session ID 集合。
 *
 * 内部存储结构 —— 不导出，避免外部 map 状态被破坏。
 */
type OccupancyMap = Map<string, Set<string>>;

/**
 * 内置全局占用注册表（进程级 singleton）。
 *
 * lazy 创建 —— 首次访问 SkinOccupancy 静态方法时初始化。
 */
const occupancy: OccupancyMap = new Map();

/**
 * 尝试为给定 session 占用指定 skin。
 *
 * 行为：
 * - 同一 skin 可支持多个 session（返回 true）
 * - 不同 skin 可同时被同一 session 占用（未限制）
 * - 如果内部状态损坏（Set 不存在），自动重建并继续
 *
 * @param skinId - 皮肤 ID（如 "scout"）
 * @param sessionId - 子 Agent session ID
 * @returns true 表示占用成功
 */
export function tryAcquire(skinId: string, sessionId: string): boolean {
  if (!skinId || !sessionId) {
    Logger.warn({
      sessionId: sessionId || 'unknown',
      scope: 'skill',
      message: 'skin_occupancy_invalid',
      data: {
        kind: 'skin_occupancy_invalid',
        skinId,
        sessionId,
        reason: 'empty skinId or sessionId',
      },
    });
    return false;
  }

  let holders = occupancy.get(skinId);
  if (!holders) {
    holders = new Set();
    occupancy.set(skinId, holders);
  }
  holders.add(sessionId);
  return true;
}

/**
 * 释放给定 session 对指定 skin 的占用。
 *
 * 幂等：重复 release 同一对 (skinId, sessionId) 不会抛错。
 * 释放后如果该 skin 持有者集合为空，自动从注册表移除以避免内存泄漏。
 *
 * @param skinId - 皮肤 ID
 * @param sessionId - 子 Agent session ID
 */
export function release(skinId: string, sessionId: string): void {
  const holders = occupancy.get(skinId);
  if (!holders) return;
  holders.delete(sessionId);
  if (holders.size === 0) {
    occupancy.delete(skinId);
  }
}

/**
 * 给定候选皮肤列表，过滤出当前可用的（未被任何 session 占用）。
 *
 * 行为：
 * - 候选列表中所有 skin 都被占用时返回空数组（caller 决定 fallback）
 * - 候选列表里包含未注册的 skin 时 —— 仍然返回，调用方会自己 fallback
 *   （getRoleSkin() 已经做了 fallback，这里不需要再过滤）
 *
 * @param skins - 候选皮肤 ID 列表
 * @returns 当前未被占用的子集（保持原顺序）
 */
export function getAvailable(skins: readonly string[]): string[] {
  const available: string[] = [];
  for (const skin of skins) {
    const holders = occupancy.get(skin);
    if (!holders || holders.size === 0) {
      available.push(skin);
    }
  }
  return available;
}

/**
 * 从候选皮肤列表里随机选一个可用 skin 并占用。
 *
 * 行为：
 * - 候选列表为空 / 全部被占用时返回 null（caller fallback 到 defaultRoleSkin）
 * - 占用成功返回选中的 skinId；占用失败返回 null（极少见）
 *
 * @param skins - 候选皮肤 ID 列表
 * @param sessionId - 需要占用皮肤的 session ID
 * @returns 选中的 skinId，或 null 表示无候选可用
 */
export function acquireRandom(skins: readonly string[], sessionId: string): string | null {
  const available = getAvailable(skins);
  if (available.length === 0) return null;

  const picked = available[Math.floor(Math.random() * available.length)];
  if (!tryAcquire(picked, sessionId)) {
    return null;
  }
  return picked;
}

/**
 * 列出当前所有被占用的皮肤 ID（用于调试 / 测试）。
 *
 * @returns 被占用的皮肤 ID 数组（顺序按 Map 插入顺序）
 */
export function listOccupied(): string[] {
  return Array.from(occupancy.keys());
}

/**
 * 列出持有某皮肤的所有 session ID（用于调试 / 测试）。
 *
 * @param skinId - 皮肤 ID
 * @returns session ID 数组（空数组表示该皮肤未被占用）
 */
export function getHolders(skinId: string): string[] {
  const holders = occupancy.get(skinId);
  return holders ? Array.from(holders) : [];
}

/**
 * 清空所有占用（仅用于测试 / 进程退出）。
 */
export function clearAll(): void {
  occupancy.clear();
}
