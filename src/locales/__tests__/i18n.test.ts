import { describe, it, expect, beforeAll } from 'vitest';
import { initI18n, setLanguage, t, tRandom } from '../i18n.js';

describe('i18n module', () => {
  beforeAll(async () => {
    await initI18n('zh');
  });

  describe('interpolation', () => {
    it('replaces double curly brace placeholders {{key}}', () => {
      setLanguage('zh');
      const result = t('commands.init.wizard.provider.keyLabel', { provider: 'deepseek' });
      expect(result).toBe('请输入 deepseek 的 API Key');
    });

    it('replaces single curly brace placeholders {key} if present in string', () => {
      setLanguage('zh');
      const result = t('commands.init.wizard.provider.fetchingModels', { provider: 'openai' });
      expect(result).toBe('正在连接 openai 探测可用模型列表...');
    });

    it('replaces {count} placeholder in loopTitle', () => {
      setLanguage('zh');
      const result = t('commands.init.wizard.provider.loopTitle', { count: '3' });
      expect(result).toBe('当前已配置的供应商 (3 个)');
    });

    it('replaces placeholders in English locale', () => {
      setLanguage('en');
      const result = t('commands.init.wizard.provider.keyLabel', { provider: 'openai' });
      expect(result).toBe('Enter API Key for openai');
    });

    it('replaces placeholders in tRandom', () => {
      setLanguage('zh');
      const result = tRandom('commands.init.wizard.provider.keyLabel', { provider: 'qwen' });
      expect(result).toBe('请输入 qwen 的 API Key');
    });
  });
});
