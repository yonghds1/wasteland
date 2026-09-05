/**
 * skins/index.ts - 皮肤系统 API
 *
 * 提供皮肤查询和管理接口。
 * 皮肤数据从 `skins.json` 动态加载，支持 singleAgent/multiAgent 模式。
 */
import type { Skin } from './types.js';
import { resolvePalette } from '../theme/palette.js';
import { wastelandColors } from '../theme/wasteland/colors.js';
import { assertContrast } from '../theme/contrast.js';
import { loadSkinsWithPriority } from './loader.js';
import { SkinRegistry } from './registry.js';

// ============================================================
// 类型导出
// ============================================================

export type { Skin } from './types.js';
export { SkinRegistry } from './registry.js';
export {
  loadSkinsWithPriority,
  type SkinsDefinition,
  type SingleAgentSkinConfig,
} from './loader.js';

/** 皮肤条目 */
export type SkinEntry = { id: string; skin: Skin };

// ============================================================
// 全局注册表
// ============================================================

let globalRegistry: SkinRegistry | null = null;

export function getRegistry(): SkinRegistry | null {
  return globalRegistry;
}

/**
 * 初始化皮肤注册表
 */
export async function initSkinRegistry(
  userDir?: string,
  projectDir?: string
): Promise<SkinRegistry> {
  const registry = new SkinRegistry();

  const { skins, singleAgent } = await loadSkinsWithPriority(userDir, projectDir);
  registry.registerSkins(skins);
  registry.registerSingleAgent(singleAgent.skin);

  globalRegistry = registry;
  return registry;
}

// ============================================================
// API
// ============================================================

export const defaultSkin = 'warlord-immortal';

export function getSkin(name?: string): Skin {
  if (!globalRegistry) throw new Error('Skin registry not initialized.');
  if (name) {
    const skin = globalRegistry.getSkin(name);
    if (skin) return skin;
  }
  return globalRegistry.getSkin(defaultSkin) ?? {
    id: defaultSkin, label: '不死老蕉',
    thinking: ['目击我！主脑战车全速点火，正在重排车队冲锋次序...'], greeting: ['你渴望救赎？把任务塞进主气缸，我来号令车队碾碎障碍！'],
    catchphrases: ['在狂暴之路上，只有交付结果的人才能进入瓦尔哈拉！'],
  };
}

export function listSkins(): SkinEntry[] {
  if (!globalRegistry) throw new Error('Skin registry not initialized.');
  return globalRegistry.listSkins().map((skin) => ({ id: skin.id, skin }));
}

export function validateSkinId(name: unknown): name is string {
  if (typeof name !== 'string' || !globalRegistry) return false;
  return globalRegistry.hasSkin(name);
}

// ============================================================
// 对比度校验
// ============================================================

const contrastThresholds = { label: 75, text: 60, thinking: 45 } as const;

export function getSkinContrastIssue(skin: Skin): string | null {
  if (!skin.colors) return null;
  const palette = resolvePalette({ colors: skin.colors });
  for (const [role, threshold] of Object.entries(contrastThresholds)) {
    const color = palette[role as keyof typeof palette];
    if (color) {
      try {
        assertContrast(color, wastelandColors.background, threshold, role as 'label' | 'text' | 'thinking');
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }
  }
  return null;
}

// ============================================================
// 系统级文案
// ============================================================

export const systemCommon = {
  labels: {
    user: 'skins.system.labels.user', system: 'skins.system.labels.system',
    tool: 'skins.system.labels.tool', error: 'skins.system.labels.error',
    success: 'skins.system.labels.success', warn: 'skins.system.labels.warn',
    userName: 'skins.system.labels.userName', session: 'skins.system.labels.session',
  },
  messages: {
    noResponse: 'skins.system.messages.noResponse',
    executionFailed: 'skins.system.messages.executionFailed',
    executionComplete: 'skins.system.messages.executionComplete',
    spawnAgentHandled: 'skins.system.messages.spawnAgentHandled',
    toolRegistry: 'skins.system.messages.toolRegistry',
    startupFailed: 'skins.system.messages.startupFailed',
  },
} as const;
