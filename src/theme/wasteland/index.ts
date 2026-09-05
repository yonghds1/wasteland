/**
 * 固定的 wasteland TUI 视觉主题。
 *
 * 主题只包含颜色、排版、间距、装饰和动画，不包含 UI 文案或 LLM persona。
 */
import { wastelandAnimations } from './animations.js';
import { wastelandColors } from './colors.js';
import { wastelandDecorations } from './decorations.js';
import { wastelandSpacing } from './spacing.js';
import { wastelandTypography } from './typography.js';

export const wastelandTheme = {
  name: 'wasteland',
  displayName: 'Wasteland',
  description: 'Warm rust accents on a dark terminal canvas',
  colors: wastelandColors,
  typography: wastelandTypography,
  spacing: wastelandSpacing,
  decorations: wastelandDecorations,
  animations: wastelandAnimations,
} as const;

export {
  wastelandAnimations,
  wastelandColors,
  wastelandDecorations,
  wastelandSpacing,
  wastelandTypography,
};
