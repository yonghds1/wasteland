/**
 * i18n.ts - 国际化模块
 *
 * 管理多语言翻译
 */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type Language = "en" | "zh";

type TranslationData = Record<string, unknown>;

const translations: Record<Language, TranslationData> = {
  en: {},
  zh: {},
};

let currentLanguage: Language = "en";
let isLoaded = false;

/**
 * 加载翻译文件
 */
async function loadTranslations(lang: Language): Promise<TranslationData> {
  const filePath = join(__dirname, `${lang}.json`);
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content);
}

/**
 * 初始化 i18n 模块
 */
export async function initI18n(lang: Language = "en"): Promise<void> {
  currentLanguage = lang;

  if (!isLoaded) {
    translations.en = await loadTranslations("en");
    translations.zh = await loadTranslations("zh");
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

/**
 * 获取翻译值（支持嵌套路径和插值）
 *
 * @param key - 翻译键（如 "skin.name"）
 * @param params - 插值参数（如 { name: "Joe" }）
 * @param lang - 语言代码（可选，默认使用当前语言）
 * @returns 翻译后的字符串
 */
export function t(key: string, params?: Record<string, string>, lang?: Language): string {
  const data = translations[lang ?? currentLanguage];
  const keys = key.split(".");

  let value: unknown = data;
  for (const k of keys) {
    if (value === null || value === undefined || typeof value !== "object") {
      return key;
    }
    value = (value as Record<string, unknown>)[k];
  }

  if (typeof value !== "string") {
    return key;
  }

  // 支持插值 {{param}}
  if (params) {
    return value.replace(/\{\{(\w+)\}\}/g, (_, paramKey: string) => {
      return params[paramKey] ?? `{{${paramKey}}}`;
    });
  }

  return value;
}

/**
 * 获取嵌套对象
 *
 * @param key - 翻译键（如 "skin.roles.main"）
 * @returns 翻译后的对象
 */
export function tObject<T = Record<string, unknown>>(key: string): T {
  const data = translations[currentLanguage];
  const keys = key.split(".");

  let value: unknown = data;
  for (const k of keys) {
    if (value === null || value === undefined || typeof value !== "object") {
      return {} as T;
    }
    value = (value as Record<string, unknown>)[k];
  }

  return value as T;
}

/**
 * 获取数组
 *
 * @param key - 翻译键（如 "skin.roles.main.catchphrases"）
 * @param lang - 语言代码（可选，默认使用当前语言）
 * @returns 翻译后的数组
 */
export function tArray(key: string, lang?: Language): string[] {
  const data = translations[lang ?? currentLanguage];
  const keys = key.split(".");

  let value: unknown = data;
  for (const k of keys) {
    if (value === null || value === undefined || typeof value !== "object") {
      return [];
    }
    value = (value as Record<string, unknown>)[k];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}
