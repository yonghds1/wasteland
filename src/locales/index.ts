/**
 * locales/index.ts - 国际化模块导出
 */

export {
  initI18n,
  setLanguage,
  getLanguage,
  getSupportedLanguages,
  t,
  tObject,
  tArray,
  getLocalizedValue,
} from "./i18n.js";

export type { Language } from "./i18n.js";
