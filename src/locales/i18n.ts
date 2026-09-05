/**
 * i18n.ts - 国际化模块
 *
 * 管理多语言翻译
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type Language = string;

/**
 * 默认语言（单一来源 SSOT）
 *
 * 全局默认语言由此常量定义，所有「默认语言」均引用它，不散落字面量 'en'。
 */
export const DEFAULT_LANGUAGE: Language = 'en';

type TranslationData = Record<string, unknown>;

const translations: Record<Language, TranslationData> = {};

let currentLanguage: Language = DEFAULT_LANGUAGE;
let isLoaded = false;
const supportedLanguages: Language[] = [];
const warnedMissingKeys = new Set<string>();

/**
 * 加载翻译文件
 */
async function loadTranslations(lang: Language): Promise<TranslationData> {
  const filePath = join(__dirname, `${lang}.json`);
  const content = await readFile(filePath, 'utf8');
  return JSON.parse(content);
}

/**
 * 扫描翻译文件目录，获取支持的语言列表
 */
async function discoverLanguages(): Promise<Language[]> {
  try {
    const files = await readdir(__dirname);
    return files
      .filter((file) => file.endsWith('.json') && file !== 'package.json')
      .map((file) => file.replace('.json', ''));
  } catch {
    return [DEFAULT_LANGUAGE];
  }
}

/**
 * 获取支持的语言列表
 */
export function getSupportedLanguages(): Language[] {
  return supportedLanguages;
}

/**
 * 初始化 i18n 模块
 */
export async function initI18n(lang: Language = DEFAULT_LANGUAGE): Promise<void> {
  currentLanguage = lang;

  if (!isLoaded) {
    // 扫描支持的语言
    const languages = await discoverLanguages();

    // 加载所有支持的语言
    for (const language of languages) {
      try {
        translations[language] = await loadTranslations(language);
        supportedLanguages.push(language);
      } catch {
        // 忽略加载失败的语言
      }
    }

    isLoaded = true;
  }
}

/**
 * 设置当前语言
 */
export function setLanguage(lang: Language): void {
  currentLanguage = lang;
}

/**
 * 获取当前语言
 */
export function getLanguage(): Language {
  return currentLanguage;
}

/** 从指定语言对象读取字符串翻译。 */
function lookupTranslation(data: TranslationData | undefined, key: string): string | undefined {
  let value: unknown = data;
  for (const segment of key.split('.')) {
    if (value === null || value === undefined || typeof value !== 'object') {
      return undefined;
    }
    value = (value as Record<string, unknown>)[segment];
  }

  return typeof value === 'string' ? value : undefined;
}

/** 开发环境中仅首次报告某个 locale/key 的缺失。 */
function warnMissingTranslation(language: Language, key: string): void {
  if (process.env.NODE_ENV === 'production') return;

  const warningId = `${language}:${key}`;
  if (warnedMissingKeys.has(warningId)) return;
  warnedMissingKeys.add(warningId);
  console.warn(`[i18n] Missing translation "${key}" for locale "${language}"; falling back to ${DEFAULT_LANGUAGE}.`);
}

/**
 * 获取翻译值（支持嵌套路径和插值）
 *
 * 查找顺序：指定/当前语言 → DEFAULT_LANGUAGE (en) → key 字符串。
 *
 * @param key - 翻译键（如 "skins.warlord-immortal.label"）
 * @param params - 插值参数（如 { name: "不死军阀" }）
 * @param lang - 语言代码（可选，默认使用当前语言）
 * @returns 翻译后的字符串
 */
export function t(key: string, params?: Record<string, string>, lang?: Language): string {
  const requestedLanguage = lang ?? currentLanguage;
  let value = lookupTranslation(translations[requestedLanguage], key);

  if (value === undefined) {
    warnMissingTranslation(requestedLanguage, key);
    value = lookupTranslation(translations[DEFAULT_LANGUAGE], key);
  }

  if (value === undefined) {
    return key;
  }

  // 支持插值 {{param}} 及 {param}
  if (params) {
    return value.replace(/(?:\{\{|\{)(\w+)(?:\}\}|\})/g, (match, paramKey: string) => {
      return params[paramKey] ?? match;
    });
  }

  return value;
}

/**
 * 获取嵌套对象
 *
 * @param key - 翻译键（如 "skins.system.labels"）
 * @returns 翻译后的对象
 */
export function tObject<T = Record<string, unknown>>(key: string): T {
  const data = translations[currentLanguage];
  const keys = key.split('.');

  let value: unknown = data;
  for (const k of keys) {
    if (value === null || value === undefined || typeof value !== 'object') {
      return {} as T;
    }
    value = (value as Record<string, unknown>)[k];
  }

  return value as T;
}

/**
 * 随机取翻译值（支持 string 或 string[]）。
 *
 * 数组时随机选一项，字符串时与原 t() 等价（向后兼容）。
 * 用同一语言和 locale 文件，不破坏国际化。
 *
 * @param key - 翻译键（如 "skins.warlord-immortal.thinking"）
 * @param params - 插值参数（可选）
 * @param lang - 语言代码（可选，默认使用当前语言）
 * @returns 翻译后的字符串
 */
export function tRandom(key: string, params?: Record<string, string>, lang?: Language): string {
  const data = translations[lang ?? currentLanguage];
  const keys = key.split('.');

  let value: unknown = data;
  for (const k of keys) {
    if (value === null || value === undefined || typeof value !== 'object') {
      return key;
    }
    value = (value as Record<string, unknown>)[k];
  }

  const interpolate = (str: string) =>
    params
      ? str.replace(/(?:\{\{|\{)(\w+)(?:\}\}|\})/g, (match, p: string) => params[p] ?? match)
      : str;

  if (Array.isArray(value)) {
    const filtered = value.filter((item): item is string => typeof item === 'string');
    const item = filtered.length > 0 ? filtered[Math.floor(Math.random() * filtered.length)] : null;
    if (typeof item === 'string') {
      return interpolate(item);
    }
    return key;
  }

  if (typeof value !== 'string') return key;
  return interpolate(value);
}

/**
 * 获取数组
 *
 * @param key - 翻译键（如 "skins.scout.catchphrases"）
 * @param lang - 语言代码（可选，默认使用当前语言）
 * @returns 翻译后的数组
 */
export function tArray(key: string, lang?: Language): string[] {
  const data = translations[lang ?? currentLanguage];
  const keys = key.split('.');

  let value: unknown = data;
  for (const k of keys) {
    if (value === null || value === undefined || typeof value !== 'object') {
      return [];
    }
    value = (value as Record<string, unknown>)[k];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

/**
 * 获取本地化值（支持语言后缀覆盖）
 *
 * 从对象中获取值，优先使用当前语言的后缀版本。
 * 例如：当语言为 "zh" 时，优先查找 "key.zh"，不存在则回退到 "key"。
 *
 * @param obj - 源对象
 * @param key - 键名
 * @returns 本地化后的值
 *
 * @example
 * ```typescript
 * const config = {
 *   description: "Research",
 *   "description.zh": "研究"
 * };
 * getLocalizedValue(config, "description"); // 中文环境返回 "研究"
 * ```
 */
export function getLocalizedValue(obj: Record<string, unknown>, key: string): string {
  const lang = getLanguage();
  const localizedKey = `${key}.${lang}`;

  if (localizedKey in obj && typeof obj[localizedKey] === 'string') {
    return obj[localizedKey] as string;
  }

  if (key in obj && typeof obj[key] === 'string') {
    return obj[key] as string;
  }

  return '';
}
