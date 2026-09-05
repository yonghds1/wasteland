import { wastelandColors } from './wasteland/colors.js';

/**
 * 可供皮肤引用的共享调色板 token。
 *
 * 基础 token 直接复用 wastelandColors；role.* token 只补充角色标签需要的
 * 高对比度色值，避免在各皮肤文件中重复 hex 字面量。
 */
export const paletteTokens = {
  primary: wastelandColors.primary,
  secondary: wastelandColors.secondary,
  accent: wastelandColors.accent,
  muted: wastelandColors.muted,
  border: wastelandColors.border,
  success: wastelandColors.success,
  error: wastelandColors.error,
  warning: wastelandColors.warning,
  info: wastelandColors.info,
  tool: wastelandColors.tool,
  text: wastelandColors.text,
  'role.label.gold': '#F0CB72',
  'role.label.amber': '#F5C878',
  'role.label.green': '#B9D889',
  'role.label.teal': '#B8DFDB',
  'role.label.violet': '#DACAF5',
  'role.label.taupe': '#E5CDB8',
  'role.thinking.muted': '#A3998C',
  'role.thinking.warm': '#B09A84',
  'role.thinking.teal': '#74A6A1',
} as const;

/** 共享调色板中可被皮肤引用的 token 名称。 */
export type PaletteToken = keyof typeof paletteTokens;

/** `#RGB` 或 `#RRGGBB` 格式的十六进制颜色。 */
export type HexString = `#${string}`;

/**
 * 皮肤的可选颜色覆盖。
 *
 * 每个字段既可使用 PaletteToken，也可用 hex 作为定制 escape hatch。
 */
export type SkinPalette = {
  /** 角色标签颜色。 */
  label?: PaletteToken | HexString;
  /** Assistant 回复正文颜色。 */
  text?: PaletteToken | HexString;
  /** 思考状态和思考块颜色。 */
  thinking?: PaletteToken | HexString;
};

/** 解析后的皮肤颜色，所有字段均为 Ink 可直接消费的 hex 字符串。 */
export type ResolvedSkinPalette = {
  /** 角色标签颜色。 */
  label: string;
  /** Assistant 回复正文颜色。 */
  text: string;
  /** 思考状态和思考块颜色。 */
  thinking: string;
};

const HEX_COLOR_PATTERN = /^#[\da-f]{3}(?:[\da-f]{3})?$/i;

/** 将单个 token 或 hex 覆盖解析为最终颜色。 */
function resolveColor(value: PaletteToken | HexString | undefined, fallback: string): string {
  if (value && Object.hasOwn(paletteTokens, value)) {
    return paletteTokens[value as PaletteToken];
  }

  if (value && HEX_COLOR_PATTERN.test(value)) {
    return value;
  }

  return fallback;
}

/**
 * 把皮肤的 token / hex 覆盖解析成完整调色板。
 *
 * 缺失值或运行时传入的无效值会安全回退到 wasteland 主题默认色。
 */
export function resolvePalette(skin: { colors?: SkinPalette }): ResolvedSkinPalette {
  return {
    label: resolveColor(skin.colors?.label, wastelandColors.primary),
    text: resolveColor(skin.colors?.text, wastelandColors.text),
    thinking: resolveColor(skin.colors?.thinking, wastelandColors.muted),
  };
}
