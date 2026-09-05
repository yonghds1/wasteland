/**
 * skins/types.ts - 皮肤系统类型定义
 *
 * 皮肤定义了 TUI 中每个角色的视觉和文案。
 * 皮肤与 LLM 角色（roles/）正交，只负责 UI 层。
 *
 * ## 架构
 *
 * - 皮肤定义在 `.wasteland/skins.json` 中
 * - agent 分配在 `.wasteland/settings.json` 的 `multiAgent.*.skins` 中
 * - 核心代码不包含任何角色名
 */
import type { SkinPalette } from '../theme/palette.js';

/**
 * 单个皮肤定义
 *
 * 一个皮肤包含角色的视觉元素：显示名、思考文案、欢迎语、口头禅等。
 * JSON 中写什么显示什么，无 i18n 翻译。
 */
export interface Skin {
  /** 皮肤唯一标识 */
  id: string;
  /** 皮肤显示名 */
  label: string;
  /** 思考状态文案（随机选取） */
  thinking: string[];
  /** 欢迎语（随机选取） */
  greeting: string[];
  /** 口头禅（随机选取） */
  catchphrases: string[];
  /** 颜色配置（可选） */
  colors?: SkinPalette;
}
