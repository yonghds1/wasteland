/**
 * wizard/validation.ts - 向导输入校验器
 *
 * 从 `InitWizard.tsx` 拆出：5 个纯校验函数（返回错误文案或 null）。
 * 对外仍由 `InitWizard.tsx` re-export，单测以此为真源。
 */

import { t } from '@locales/index.js';

export function validateProviderName(name: string): string | null {
  if (!name || name.trim().length === 0) {
    return t('commands.init.wizard.errors.emptyProviderName');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name.trim())) {
    return t('commands.init.wizard.errors.invalidProviderName');
  }
  return null;
}

export function validateBaseUrl(url: string): string | null {
  if (!url || url.trim().length === 0) {
    return t('commands.init.wizard.errors.emptyBaseUrl');
  }
  if (!/^https?:\/\//i.test(url.trim())) {
    return t('commands.init.wizard.errors.invalidBaseUrl');
  }
  return null;
}

export function validateApiKey(key: string, optional = false): string | null {
  if (optional) return null;
  if (!key || key.trim().length === 0) {
    return t('commands.init.wizard.errors.emptyApiKey');
  }
  return null;
}

export function validateModelId(model: string): string | null {
  if (!model || model.trim().length === 0) {
    return t('commands.init.wizard.errors.emptyModelId');
  }
  return null;
}

export function validateSubAgentModelId(model: string): string | null {
  if (!model || model.trim().length === 0) {
    return t('commands.init.wizard.errors.emptySubAgentModelId');
  }
  return null;
}
