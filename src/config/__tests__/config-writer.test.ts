import { describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildInitialAuth,
  buildInitialRolesFile,
  buildInitialSettings,
  buildInitialSkinsFile,
  deriveAuthKey,
  INITIAL_MODEL_KEY,
  isConfigEmpty,
  updateRuntimeMode,
  writeInitialConfig,
} from '../config-writer.js';
import { DEFAULT_WASTELAND_SETTINGS } from '../settings-types.js';

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
      expect(settings.runtime).toEqual({
        defaultModel: INITIAL_MODEL_KEY,
        mode: 'multi',
        skinId: 'warlord-immortal',
        maxStepsPerTurn: 30,
        language: 'zh',
      });
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

    it('supports custom sub-agent strategy and custom skin', () => {
      const settings = buildInitialSettings({
        ...SAMPLE_INPUT,
        subAgentStrategy: 'custom',
        subAgentModelId: 'deepseek-coder',
        skinId: 'scout',
      });
      expect(settings.runtime?.skinId).toBe('scout');
      expect(settings.models?.sub_worker).toEqual({
        provider: 'deepseek',
        model: 'deepseek-coder',
      });
      expect(settings.multiAgent?.researcher?.model).toBe('sub_worker');
      expect(settings.singleAgent?.skin).toBe('scout');
    });

    it('supports single agent mode', () => {
      const settings = buildInitialSettings({
        ...SAMPLE_INPUT,
        subAgentStrategy: 'single',
      });
      expect(settings.runtime?.mode).toBe('single');
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

    it('includes singleAgent and multiAgent blocks referencing the default model', () => {
      const settings = buildInitialSettings(SAMPLE_INPUT);

      expect(settings.singleAgent).toEqual({
        model: INITIAL_MODEL_KEY,
        skin: 'warlord-immortal',
        promptTemplate: 'orchestrator',
      });

      expect(settings.multiAgent).toEqual({
        main: { role: 'orchestrator', model: INITIAL_MODEL_KEY, skin: 'warlord-immortal' },
        researcher: { role: 'researcher', model: INITIAL_MODEL_KEY },
        developer: { role: 'developer', model: INITIAL_MODEL_KEY },
        analyst: { role: 'analyst', model: INITIAL_MODEL_KEY },
        tester: { role: 'tester', model: INITIAL_MODEL_KEY },
      });
    });

    it('supports multi-provider and unified sub-agent strategy', () => {
      const multiInput = {
        mode: 'multi' as const,
        providers: [
          {
            name: 'anthropic',
            type: 'anthropic' as const,
            baseUrl: 'https://api.anthropic.com',
            apiKey: 'sk-ant-xxx',
            defaultModel: 'claude-3-7-sonnet',
          },
          {
            name: 'deepseek',
            type: 'openai-compatible' as const,
            baseUrl: 'https://api.deepseek.com/v1',
            apiKey: 'sk-ds-xxx',
            defaultModel: 'deepseek-chat',
          },
        ],
        mainAgent: {
          providerName: 'anthropic',
          modelId: 'claude-3-7-sonnet',
        },
        subAgentStrategy: 'unified' as const,
        unifiedSubAgent: {
          providerName: 'deepseek',
          modelId: 'deepseek-chat',
        },
        skinId: 'warlord-stern',
      };

      const settings = buildInitialSettings(multiInput);
      expect(Object.keys(settings.providers ?? {})).toEqual(['anthropic', 'deepseek']);
      expect(settings.models?.[INITIAL_MODEL_KEY]).toEqual({
        provider: 'anthropic',
        model: 'claude-3-7-sonnet',
        contextWindow: 200000,
      });
      expect(settings.models?.sub_worker).toEqual({
        provider: 'deepseek',
        model: 'deepseek-chat',
        contextWindow: 64000,
      });
      expect(settings.multiAgent?.main?.model).toBe(INITIAL_MODEL_KEY);
      expect(settings.multiAgent?.developer?.model).toBe('sub_worker');
      expect(settings.multiAgent?.tester?.model).toBe('sub_worker');

      const auth = buildInitialAuth(multiInput);
      expect(auth).toEqual({
        anthropic_api_key: 'sk-ant-xxx',
        deepseek_api_key: 'sk-ds-xxx',
      });
    });

    it('supports multi-provider and role_by_role strategy', () => {
      const roleInput = {
        mode: 'multi' as const,
        providers: [
          {
            name: 'anthropic',
            type: 'anthropic' as const,
            baseUrl: 'https://api.anthropic.com',
            apiKey: 'sk-ant-xxx',
            defaultModel: 'claude-3-7-sonnet',
          },
          {
            name: 'deepseek',
            type: 'openai-compatible' as const,
            baseUrl: 'https://api.deepseek.com/v1',
            apiKey: 'sk-ds-xxx',
            defaultModel: 'deepseek-chat',
          },
          {
            name: 'qwen',
            type: 'openai-compatible' as const,
            baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            apiKey: 'sk-qw-xxx',
            defaultModel: 'qwen-plus',
          },
        ],
        mainAgent: {
          providerName: 'anthropic',
          modelId: 'claude-3-7-sonnet',
        },
        subAgentStrategy: 'role_by_role' as const,
        roleBindings: {
          developer: { providerName: 'deepseek', modelId: 'deepseek-chat' },
          researcher: { providerName: 'qwen', modelId: 'qwen-plus' },
          tester: { providerName: 'deepseek', modelId: 'deepseek-coder' },
          analyst: { providerName: 'anthropic', modelId: 'claude-3-5-haiku' },
        },
        skinId: 'scout',
      };

      const settings = buildInitialSettings(roleInput);
      expect(settings.models?.dev_worker).toEqual({ provider: 'deepseek', model: 'deepseek-chat', contextWindow: 64000 });
      expect(settings.models?.res_worker).toEqual({ provider: 'qwen', model: 'qwen-plus', contextWindow: 131072 });
      expect(settings.models?.test_worker).toEqual({ provider: 'deepseek', model: 'deepseek-coder', contextWindow: 128000 });
      expect(settings.models?.ana_worker).toEqual({ provider: 'anthropic', model: 'claude-3-5-haiku', contextWindow: 200000 });
      expect(settings.multiAgent?.developer?.model).toBe('dev_worker');
      expect(settings.multiAgent?.researcher?.model).toBe('res_worker');
      expect(settings.multiAgent?.tester?.model).toBe('test_worker');
      expect(settings.multiAgent?.analyst?.model).toBe('ana_worker');
    });
  });

  describe('buildInitialSkinsFile', () => {
    it('returns a valid skins skeleton with singleAgent pointing to default skin', () => {
      const file = buildInitialSkinsFile();
      expect(file.singleAgent).toEqual({ skin: 'road-nomad' });
      expect(file.skins['road-nomad']).toBeDefined();
      expect(file.skins['road-nomad'].id).toBe('road-nomad');
      expect(file.skins['road-nomad'].label).toBeTruthy();
    });
  });

  describe('buildInitialRolesFile', () => {
    it('returns a valid roles skeleton with the four worker roles', () => {
      const file = buildInitialRolesFile();
      expect(Object.keys(file.roles)).toEqual(['researcher', 'developer', 'analyst', 'tester']);
      expect(file.roles.researcher).toMatchObject({
        promptTemplate: 'role-worker',
        skins: ['sand-scout', 'fury-vanguard'],
      });
      expect(file.roles.tester).toMatchObject({ promptTemplate: 'role-worker' });
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
    it('writes settings.json, auth.json, skins.json and roles.json under WASTELAND_HOME', async () => {
      const home = await mkdtemp(join(tmpdir(), 'wasteland-init-'));
      try {
        const env = { WASTELAND_HOME: home } as NodeJS.ProcessEnv;
        const result = await writeInitialConfig(SAMPLE_INPUT, env);

        expect(result.settingsPath).toBe(join(home, 'settings.json'));
        expect(result.authPath).toBe(join(home, 'auth.json'));
        expect(result.skinsPath).toBe(join(home, 'skins.json'));
        expect(result.rolesPath).toBe(join(home, 'roles.json'));

        const settings = JSON.parse(await readFile(result.settingsPath, 'utf8'));
        expect(settings.providers.deepseek.apiKey).toEqual({ $auth: 'deepseek_api_key' });
        expect(settings.models[INITIAL_MODEL_KEY].model).toBe('deepseek-chat');
        expect(settings.runtime.defaultModel).toBe(INITIAL_MODEL_KEY);
        expect(settings.multiAgent.main.role).toBe('orchestrator');
        expect(settings.singleAgent.model).toBe(INITIAL_MODEL_KEY);

        const auth = JSON.parse(await readFile(result.authPath, 'utf8'));
        expect(auth).toEqual({ deepseek_api_key: 'sk-xxx' });

        // skins.json / roles.json 必须可被 JSON.parse（合法可加载）
        const skins = JSON.parse(await readFile(result.skinsPath, 'utf8'));
        expect(skins.singleAgent.skin).toBe('road-nomad');
        expect(skins.skins['road-nomad']).toBeDefined();

        const roles = JSON.parse(await readFile(result.rolesPath, 'utf8'));
        expect(roles.roles.researcher).toBeDefined();
        expect(roles.roles.developer).toBeDefined();
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

  describe('updateRuntimeMode', () => {
    // 用一个不含 .wasteland 的临时 cwd,确保 resolveMutableSettingsPath 回退到用户级
    // (WASTELAND_HOME),而不会命中仓库根目录的项目级配置。
    async function makeTempCwd(): Promise<string> {
      return mkdtemp(join(tmpdir(), 'wasteland-mode-cwd-'));
    }

    it('creates settings.json with runtime.mode when file is absent', async () => {
      const cwd = await makeTempCwd();
      const home = await mkdtemp(join(tmpdir(), 'wasteland-mode-home-'));
      try {
        const env = { WASTELAND_HOME: home } as NodeJS.ProcessEnv;
        await updateRuntimeMode('multi', { cwd, env });

        const settings = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'));
        expect(settings.runtime.mode).toBe('multi');
      } finally {
        await rm(cwd, { recursive: true, force: true });
        await rm(home, { recursive: true, force: true });
      }
    });

    it('preserves other runtime fields and top-level keys (shallow merge)', async () => {
      const cwd = await makeTempCwd();
      const home = await mkdtemp(join(tmpdir(), 'wasteland-mode-home-'));
      try {
        const env = { WASTELAND_HOME: home } as NodeJS.ProcessEnv;
        await writeFile(
          join(home, 'settings.json'),
          JSON.stringify({
            runtime: { skinId: 'warlord-stern', language: 'zh' },
            models: { m: { provider: 'p', model: 'x' } },
          }),
          'utf8'
        );

        await updateRuntimeMode('single', { cwd, env });

        const settings = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'));
        expect(settings.runtime.mode).toBe('single');
        // 既有 runtime 字段不被抹掉
        expect(settings.runtime.skinId).toBe('warlord-stern');
        expect(settings.runtime.language).toBe('zh');
        // 其它顶层 key 保持原样
        expect(settings.models.m).toEqual({ provider: 'p', model: 'x' });
      } finally {
        await rm(cwd, { recursive: true, force: true });
        await rm(home, { recursive: true, force: true });
      }
    });

    it('overwrites an existing runtime.mode value', async () => {
      const cwd = await makeTempCwd();
      const home = await mkdtemp(join(tmpdir(), 'wasteland-mode-home-'));
      try {
        const env = { WASTELAND_HOME: home } as NodeJS.ProcessEnv;
        await writeFile(
          join(home, 'settings.json'),
          JSON.stringify({ runtime: { mode: 'multi' } }),
          'utf8'
        );

        await updateRuntimeMode('single', { cwd, env });

        const settings = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'));
        expect(settings.runtime.mode).toBe('single');
      } finally {
        await rm(cwd, { recursive: true, force: true });
        await rm(home, { recursive: true, force: true });
      }
    });

    it('prefers project-level settings.json when cwd has .wasteland/settings.json', async () => {
      const cwd = await mkdtemp(join(tmpdir(), 'wasteland-mode-proj-'));
      const home = await mkdtemp(join(tmpdir(), 'wasteland-mode-home-'));
      try {
        // findProjectConfigDir 要求 .wasteland 内已存在 settings.json/auth.json
        await mkdir(join(cwd, '.wasteland'), { recursive: true });
        await writeFile(
          join(cwd, '.wasteland', 'settings.json'),
          JSON.stringify({ runtime: { skinId: 'warlord-stern' } }),
          'utf8'
        );
        const env = { WASTELAND_HOME: home } as NodeJS.ProcessEnv;

        await updateRuntimeMode('multi', { cwd, env });

        // 写入项目级,而非用户级;且既有字段保留
        const projSettings = JSON.parse(
          await readFile(join(cwd, '.wasteland', 'settings.json'), 'utf8')
        );
        expect(projSettings.runtime.mode).toBe('multi');
        expect(projSettings.runtime.skinId).toBe('warlord-stern');
        // 用户级不应被创建
        await expect(access(join(home, 'settings.json'))).rejects.toThrow();
      } finally {
        await rm(cwd, { recursive: true, force: true });
        await rm(home, { recursive: true, force: true });
      }
    });
  });

  describe('ACP support in init config', () => {
    it('展开 preset 为 acp.agents（command/args，无端口/URL）', () => {
      const settings = buildInitialSettings({
        ...SAMPLE_INPUT,
        acp: { enabledPresetIds: ['claude_code', 'codex'] },
      });

      expect(settings.acp?.agents).toEqual([
        {
          name: 'claude_code',
          command: 'npx',
          args: ['-y', '@agentclientprotocol/claude-agent-acp'],
          description: '调用本地 Claude Code 智能体执行全工程检索、重构与跨文件编码任务',
        },
        {
          name: 'codex',
          command: 'npx',
          args: ['-y', '@zed-industries/codex-acp'],
          description: '调用本地 Codex CLI 智能体执行原子化代码生成、修补与测试编写',
        },
      ]);
    });

    it('customAgents 与 preset 合并、无选择时省略块', () => {
      const settings = buildInitialSettings({
        ...SAMPLE_INPUT,
        acp: {
          enabledPresetIds: ['claude_code'],
          customAgents: [{ name: 'my_agent', command: 'my-acp-server', args: ['--stdio'] }],
        },
      });
      expect(settings.acp?.agents).toHaveLength(2);
      expect(settings.acp?.agents?.[1]).toEqual({
        name: 'my_agent',
        command: 'my-acp-server',
        args: ['--stdio'],
      });

      const empty = buildInitialSettings({ ...SAMPLE_INPUT, acp: { enabledPresetIds: [] } });
      expect(empty.acp).toBeUndefined();
    });
  });
});
