/**
 * skins/registry.ts - 动态皮肤注册表
 *
 * 管理所有已加载的皮肤，支持 singleAgent 模式。
 * 多 agent 皮肤分配已移除：皮肤候选由 `settings.json multiAgent[name].skins` 驱动，
 * 而非 skins.json 的 multiAgent 分配（无消费者）。
 */
import type { Skin } from './types.js';

/**
 * 皮肤注册表
 */
export class SkinRegistry {
  /** 皮肤 ID → 皮肤定义 */
  private skins = new Map<string, Skin>();

  /** 单 agent 皮肤 ID */
  private singleAgentSkin: string = '';

  /**
   * 注册皮肤定义
   */
  registerSkins(skins: Record<string, Skin>): void {
    for (const [id, skin] of Object.entries(skins)) {
      this.skins.set(id, { ...skin, id });
    }
  }

  /**
   * 注册单 agent 皮肤
   */
  registerSingleAgent(skinId: string): void {
    this.singleAgentSkin = skinId;
  }

  /**
   * 按 ID 查询皮肤
   */
  getSkin(skinId: string): Skin | null {
    return this.skins.get(skinId) ?? null;
  }

  /**
   * 列出所有可用皮肤
   */
  listSkins(): Skin[] {
    return [...this.skins.values()];
  }

  /**
   * 获取单 agent 皮肤 ID
   */
  getSingleAgentSkin(): string {
    return this.singleAgentSkin;
  }

  /**
   * 检查皮肤 ID 是否存在
   */
  hasSkin(skinId: string): boolean {
    return this.skins.has(skinId);
  }

  /**
   * 清空注册表
   */
  clear(): void {
    this.skins.clear();
    this.singleAgentSkin = '';
  }
}