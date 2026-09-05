/**
 * config/i18n-loader.ts - i18n 配置加载器
 *
 * 支持从 `i18n/` 目录加载文案配置，覆盖代码默认值。
 *
 * ## 加载优先级
 * 1. 代码默认值（src/locales/*.json）
 * 2. 用户级 ~/.wasteland/i18n/*.json
 * 3. 项目级 <cwd>/.wasteland/i18n/*.json
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** i18n 文案格式 */
export type I18nStrings = Record<string, unknown>;

/**
 * 加载单个语言的文案
 */
async function loadI18nFile(dir: string, lang: string): Promise<I18nStrings | null> {
  try {
    const content = await readFile(join(dir, `${lang}.json`), 'utf-8');
    return JSON.parse(content) as I18nStrings;
  } catch {
    return null;
  }
}

/**
 * 深度合并 i18n 文案（高优先覆盖低优先）
 */
function deepMerge(base: I18nStrings, override: I18nStrings): I18nStrings {
  const merged: I18nStrings = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      merged[key] = deepMerge(merged[key] as I18nStrings ?? {}, value as I18nStrings);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * 加载所有语言的文案（带优先级）
 */
export async function loadI18nWithPriority(
  baseStrings: Record<string, I18nStrings>,
  userDir?: string,
  projectDir?: string
): Promise<Record<string, I18nStrings>> {
  const result: Record<string, I18nStrings> = {};

  for (const [lang, base] of Object.entries(baseStrings)) {
    let strings = { ...base };

    if (userDir) {
      const userStrings = await loadI18nFile(userDir, lang);
      if (userStrings) strings = deepMerge(strings, userStrings);
    }

    if (projectDir) {
      const projectStrings = await loadI18nFile(projectDir, lang);
      if (projectStrings) strings = deepMerge(strings, projectStrings);
    }

    result[lang] = strings;
  }

  return result;
}
