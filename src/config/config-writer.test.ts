import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildInitialAuth,
  buildInitialSettings,
  deriveAuthKey,
  INITIAL_MODEL_KEY,
  isConfigEmpty,
  writeInitialConfig,
} from './config-writer.js';
import { DEFAULT_WASTELAND_SETTINGS } from './settings-types.js';

const SAMPLE_INPUT = {
  providerName: 'deepseek',
  providerType: 'openai-compatible' as const,
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-xxx',
  modelId: 'deepseek-chat',
};

describe('config-writer', () => {
  describe('deriveAuthKey', () => {
    it('appends _api_key suffix', () => {
      expect(deriveAuthKey('deepseek')).toBe('deepseek_api_key');
      expect(deriveAuthKey('my-anthropic')).toBe('my-anthropic_api_key');
    });
  });

  describe('buildInitialSettings', () => {
    it('produces a minimal settings structure with $auth reference', () => {
      const settings = buildInitialSettings(SAMPLE_INPUT);
      expect(settings.runtime).toEqual({ defaultModel: INITIAL_MODEL_KEY });
      expect(settings.providers).toEqual({
        deepseek: {
          type: 'openai-compatible',
          baseUrl: 'https://api.deepseek.com/v1',
          apiKey: { $auth: 'deepseek_api_key' },
        },
      });
      expect(settings.models).toEqual({
        [INITIAL_MODEL_KEY]: {
          provider: 'deepseek',
          model: 'deepseek-chat',
        },
      });
    });

    it('supports anthropic type', () => {
      const settings = buildInitialSettings({
        ...SAMPLE_INPUT,
        providerName: 'claude',
        providerType: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        modelId: 'claude-sonnet-4-6',
      });
      expect(settings.providers?.claude?.type).toBe('anthropic');
      expect(settings.providers?.claude?.apiKey).toEqual({ $auth: 'claude_api_key' });
    });
  });

  describe('buildInitialAuth', () => {
    it('creates a single-key auth map', () => {
      expect(buildInitialAuth(SAMPLE_INPUT)).toEqual({ deepseek_api_key: 'sk-xxx' });
    });
  });

  describe('isConfigEmpty', () => {
    it('returns true for DEFAULT_WASTELAND_SETTINGS', () => {
      expect(isConfigEmpty(DEFAULT_WASTELAND_SETTINGS)).toBe(true);
    });

    it('returns false when providers is populated', () => {
      expect(
        isConfigEmpty({
          ...DEFAULT_WASTELAND_SETTINGS,
          providers: { foo: { type: 'openai-compatible' } },
        })
      ).toBe(false);
    });

    it('returns false when models is populated', () => {
      expect(
        isConfigEmpty({
          ...DEFAULT_WASTELAND_SETTINGS,
          models: { m: { provider: 'foo', model: 'bar' } },
        })
      ).toBe(false);
    });
  });

  describe('writeInitialConfig', () => {
    it('atomically writes settings.json and auth.json under WASTELAND_HOME', async () => {
      const home = await mkdtemp(join(tmpdir(), 'wasteland-init-'));
      try {
        const env = { WASTELAND_HOME: home } as NodeJS.ProcessEnv;
        const result = await writeInitialConfig(SAMPLE_INPUT, env);

        expect(result.settingsPath).toBe(join(home, 'settings.json'));
        expect(result.authPath).toBe(join(home, 'auth.json'));

        const settings = JSON.parse(await readFile(result.settingsPath, 'utf8'));
        expect(settings.providers.deepseek.apiKey).toEqual({ $auth: 'deepseek_api_key' });
        expect(settings.models[INITIAL_MODEL_KEY].model).toBe('deepseek-chat');
        expect(settings.runtime.defaultModel).toBe(INITIAL_MODEL_KEY);

        const auth = JSON.parse(await readFile(result.authPath, 'utf8'));
        expect(auth).toEqual({ deepseek_api_key: 'sk-xxx' });
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    });

    it('overwrites existing files when re-run', async () => {
      const home = await mkdtemp(join(tmpdir(), 'wasteland-init-'));
      try {
        const env = { WASTELAND_HOME: home } as NodeJS.ProcessEnv;

        // First run: stale content
        await writeFile(join(home, 'settings.json'), '{"stale":true}', 'utf8');
        await writeFile(join(home, 'auth.json'), '{"stale":true}', 'utf8');

        await writeInitialConfig(SAMPLE_INPUT, env);

        const settings = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'));
        expect(settings.stale).toBeUndefined();
        expect(settings.providers.deepseek).toBeDefined();
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    });
  });
});
