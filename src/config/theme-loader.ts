/**
 * config/theme-loader.ts - 主题配置加载器
 *
 * 支持从 `theme.json` 加载主题颜色配置，覆盖代码默认值。
 *
 * ## 加载优先级
 * 1. 代码默认值（wastelandColors）
 * 2. 用户级 ~/.wasteland/theme.json
 * 3. 项目级 <cwd>/.wasteland/theme.json
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { wastelandColors } from '@theme/wasteland/colors.js';

/** theme.json 格式 */
export type ThemeConfig = Partial<typeof wastelandColors>;

/**
 * 加载 theme.json
 */
async function loadThemeFile(dir: string): Promise<ThemeConfig | null> {
  try {
    const content = await readFile(join(dir, 'theme.json'), 'utf-8');
    return JSON.parse(content) as ThemeConfig;
  } catch {
    return null;
  }
}

/**
 * 合并主题配置（高优先覆盖低优先）
 */
function mergeTheme(base: typeof wastelandColors, override: ThemeConfig): typeof wastelandColors {
  return { ...base, ...override };
}

/**
 * 带优先级的主题加载
 */
export async function loadThemeWithPriority(
  userDir?: string,
  projectDir?: string
): Promise<typeof wastelandColors> {
  let theme = { ...wastelandColors };

  if (userDir) {
    const userTheme = await loadThemeFile(userDir);
    if (userTheme) theme = mergeTheme(theme, userTheme);
  }

  if (projectDir) {
    const projectTheme = await loadThemeFile(projectDir);
    if (projectTheme) theme = mergeTheme(theme, projectTheme);
  }

  return theme;
}
