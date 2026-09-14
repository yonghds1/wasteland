import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  clearLoadedSettings,
  getLoadedSettings,
  getOrLoadSettings,
  setLoadedSettings,
} from '../loaded-settings.js';
import { DEFAULT_WASTELAND_SETTINGS } from '../settings-types.js';
import type { LoadedWastelandSettings } from '../settings-types.js';

// ============================================================
// 缓存生命周期：setLoadedSettings / getLoadedSettings / clearLoadedSettings
// ============================================================

describe('loaded-settings 缓存生命周期', () => {
  const sampleSettings: LoadedWastelandSettings = {
    settings: DEFAULT_WASTELAND_SETTINGS,
    sources: { user: '/tmp/wasteland-sample-user/settings.json' },
    projectConfigDir: null,
    userConfigDir: '/tmp/wasteland-sample-user',
    memory: '',
  };

  afterEach(() => {
    clearLoadedSettings();
  });

  it('初始状态缓存为空', () => {
    expect(getLoadedSettings()).toBeUndefined();
  });

  it('setLoadedSettings 后 getLoadedSettings 返回同一对象', () => {
    setLoadedSettings(sampleSettings);
    expect(getLoadedSettings()).toBe(sampleSettings);
  });

  it('setLoadedSettings(undefined) 会清空缓存', () => {
    setLoadedSettings(sampleSettings);
    setLoadedSettings(undefined);
    expect(getLoadedSettings()).toBeUndefined();
  });

  it('clearLoadedSettings 会清空缓存', () => {
    setLoadedSettings(sampleSettings);
    clearLoadedSettings();
    expect(getLoadedSettings()).toBeUndefined();
  });
});

// ============================================================
// getOrLoadSettings：缓存为空时从磁盘加载，缓存命中时复用
// ============================================================

describe('getOrLoadSettings 缓存与加载', () => {
  let workDir: string;
  let userHome: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'wasteland-loaded-project-'));
    userHome = await mkdtemp(join(tmpdir(), 'wasteland-loaded-home-'));
  });

  afterEach(async () => {
    clearLoadedSettings();
    await rm(workDir, { recursive: true, force: true });
    await rm(userHome, { recursive: true, force: true });
  });

  function envForTest(): NodeJS.ProcessEnv {
    return { WASTELAND_HOME: userHome };
  }

  async function writeProjectSettings(settings: unknown): Promise<void> {
    const dir = join(workDir, '.wasteland');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'settings.json'), JSON.stringify(settings), 'utf8');
  }

  it('缓存为空时从磁盘加载配置', async () => {
    await writeProjectSettings({ defaultProvider: 'disk-provider' });

    const loaded = await getOrLoadSettings(workDir, envForTest());

    expect(loaded.settings.defaultProvider).toBe('disk-provider');
    expect(loaded.projectConfigDir).toBe(join(workDir, '.wasteland'));
    // 磁盘上的项目 settings.json 已消费，无需额外写入磁盘
    expect(loaded.sources.project).toBe(join(workDir, '.wasteland', 'settings.json'));
  });

  it('setLoadedSettings 预置缓存后，getOrLoadSettings 复用而不重新读盘', async () => {
    await writeProjectSettings({ defaultProvider: 'disk-provider' });

    // 首次加载（模拟 cli.ts 启动时预热缓存）
    const first = await getOrLoadSettings(workDir, envForTest());
    expect(first.settings.defaultProvider).toBe('disk-provider');
    setLoadedSettings(first);

    // 改掉磁盘上的文件，若重新读盘会得到不同结果
    await writeProjectSettings({ defaultProvider: 'newer-disk-provider' });

    const second = await getOrLoadSettings(workDir, envForTest());
    expect(second).toBe(first);
    expect(second.settings.defaultProvider).toBe('disk-provider');
  });

  it('getOrLoadSettings 本身不写缓存；clearLoadedSettings 后重新读盘', async () => {
    await writeProjectSettings({ defaultProvider: 'a-provider' });

    const first = await getOrLoadSettings(workDir, envForTest());
    expect(first.settings.defaultProvider).toBe('a-provider');
    // getOrLoadSettings 只复用缓存、不负责写入：加载后缓存仍为空
    expect(getLoadedSettings()).toBeUndefined();

    // 预热缓存后清除，验证会重新从磁盘加载最新配置
    setLoadedSettings(first);
    clearLoadedSettings();
    await writeProjectSettings({ defaultProvider: 'b-provider' });

    const second = await getOrLoadSettings(workDir, envForTest());
    expect(second).not.toBe(first);
    expect(second.settings.defaultProvider).toBe('b-provider');
  });
});

// ============================================================
// 加载管线：默认值回退 + 合并优先级（默认 < 用户文件 < 项目文件 < 环境变量）
// ============================================================

describe('加载管线 合并优先级', () => {
  let workDir: string;
  let userHome: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'wasteland-priority-project-'));
    userHome = await mkdtemp(join(tmpdir(), 'wasteland-priority-home-'));
  });

  afterEach(async () => {
    clearLoadedSettings();
    await rm(workDir, { recursive: true, force: true });
    await rm(userHome, { recursive: true, force: true });
  });

  function envForTest(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return { WASTELAND_HOME: userHome, ...extra };
  }

  async function writeProjectSettings(settings: unknown): Promise<void> {
    const dir = join(workDir, '.wasteland');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'settings.json'), JSON.stringify(settings), 'utf8');
  }

  async function writeUserSettings(settings: unknown): Promise<void> {
    await mkdir(userHome, { recursive: true });
    await writeFile(join(userHome, 'settings.json'), JSON.stringify(settings), 'utf8');
  }

  it('无任何配置文件时回退到内置默认值', async () => {
    const { settings } = await getOrLoadSettings(workDir, envForTest());

    expect(settings.defaultProvider).toBe('local');
    expect(settings.runtime.permissionMode).toBe('default');
    expect(settings.runtime.maxStepsPerTurn).toBe(30);
    expect(settings.runtime.skinId).toBe('warlord-immortal');
    expect(settings.runtime.language).toBe('en');
    expect(settings.runtime.debug).toBe(false);
    expect(settings.parallel.maxConcurrency).toBe(-1);
    expect(settings.mcpServers).toEqual({});
    expect(settings.acp).toEqual({ agents: [] });
  });

  it('用户文件覆盖默认值，其余字段保留默认', async () => {
    await writeUserSettings({ defaultProvider: 'user-provider' });

    const { settings } = await getOrLoadSettings(workDir, envForTest());

    expect(settings.defaultProvider).toBe('user-provider');
    expect(settings.runtime.maxStepsPerTurn).toBe(30); // 默认值保留
  });

  it('项目文件覆盖用户文件', async () => {
    await writeUserSettings({ defaultProvider: 'user-provider', runtime: { debug: true } });
    await writeProjectSettings({ defaultProvider: 'project-provider' });

    const { settings } = await getOrLoadSettings(workDir, envForTest());

    // 项目级 defaultProvider 覆盖用户级；用户级的 runtime.debug 保留（字段级合并）
    expect(settings.defaultProvider).toBe('project-provider');
    expect(settings.runtime.debug).toBe(true);
  });

  it('用户级与项目级按字段合并（不同字段互补）', async () => {
    await writeUserSettings({ singleAgent: { skin: 'user-skin' } });
    await writeProjectSettings({ singleAgent: { model: 'project-model' } });

    const { settings } = await getOrLoadSettings(workDir, envForTest());

    expect(settings.singleAgent).toEqual({ skin: 'user-skin', model: 'project-model' });
  });

  it('环境变量覆盖文件配置（布尔解析）', async () => {
    await writeProjectSettings({ runtime: { debug: false, permissionMode: 'default' } });

    const { settings } = await getOrLoadSettings(
      workDir,
      envForTest({ WASTELAND_DEBUG: '1', WASTELAND_PERMISSION_MODE: 'bypass_permissions' })
    );

    expect(settings.runtime.debug).toBe(true);
    expect(settings.runtime.permissionMode).toBe('bypass_permissions');
  });

  it('环境变量覆盖语言设置', async () => {
    const { settings } = await getOrLoadSettings(workDir, envForTest({ WASTELAND_LANGUAGE: 'zh' }));

    expect(settings.runtime.language).toBe('zh');
  });

  it('非法环境变量值抛出错误', async () => {
    await expect(
      getOrLoadSettings(workDir, envForTest({ WASTELAND_PERMISSION_MODE: 'bogus' }))
    ).rejects.toThrow(/permissionMode/);

    await expect(
      getOrLoadSettings(workDir, envForTest({ WASTELAND_MAX_STEPS_PER_TURN: 'abc' }))
    ).rejects.toThrow(/正整数/);
  });

  it('doomLoopThreshold 默认值为 3', async () => {
    const { settings } = await getOrLoadSettings(workDir, envForTest());

    expect(settings.runtime.doomLoopThreshold).toBe(3);
  });

  it('项目文件覆盖 doomLoopThreshold', async () => {
    await writeProjectSettings({ runtime: { doomLoopThreshold: 5 } });

    const { settings } = await getOrLoadSettings(workDir, envForTest());

    expect(settings.runtime.doomLoopThreshold).toBe(5);
  });

  it('环境变量覆盖文件的 doomLoopThreshold', async () => {
    await writeProjectSettings({ runtime: { doomLoopThreshold: 5 } });

    const { settings } = await getOrLoadSettings(
      workDir,
      envForTest({ WASTELAND_DOOM_LOOP_THRESHOLD: '7' })
    );

    expect(settings.runtime.doomLoopThreshold).toBe(7);
  });

  it('WASTELAND_DOOM_LOOP_THRESHOLD=0 关闭检测', async () => {
    const { settings } = await getOrLoadSettings(
      workDir,
      envForTest({ WASTELAND_DOOM_LOOP_THRESHOLD: '0' })
    );

    expect(settings.runtime.doomLoopThreshold).toBe(0);
  });

  it('文件里的非法 doomLoopThreshold 报错并含配置项名与来源', async () => {
    const settingsPath = join(workDir, '.wasteland', 'settings.json');

    // 负数 / 非整数 / 非数字类型（字符串）三种非法输入，错误信息均须含配置项名与来源路径
    for (const bad of [-1, 2.5, '3']) {
      await writeProjectSettings({ runtime: { doomLoopThreshold: bad } });

      let err: unknown;
      try {
        await getOrLoadSettings(workDir, envForTest());
      } catch (e) {
        err = e;
      }

      expect(err).toBeInstanceOf(Error);
      const message = (err as Error).message;
      expect(message).toContain('doomLoopThreshold');
      expect(message).toContain(settingsPath);
    }
  });

  it('非法的 doomLoopThreshold 环境变量报错', async () => {
    for (const bad of ['abc', '-1', '2.5']) {
      await expect(
        getOrLoadSettings(workDir, envForTest({ WASTELAND_DOOM_LOOP_THRESHOLD: bad }))
      ).rejects.toThrow(/WASTELAND_DOOM_LOOP_THRESHOLD/);
    }
  });

  it('sources 记录实际读到的用户/项目文件', async () => {
    await writeUserSettings({ defaultProvider: 'user-provider' });
    await writeProjectSettings({ defaultProvider: 'project-provider' });

    const loaded = await getOrLoadSettings(workDir, envForTest());

    expect(loaded.sources.user).toBe(join(userHome, 'settings.json'));
    expect(loaded.sources.project).toBe(join(workDir, '.wasteland', 'settings.json'));
    expect(loaded.projectConfigDir).toBe(join(workDir, '.wasteland'));
  });
});
