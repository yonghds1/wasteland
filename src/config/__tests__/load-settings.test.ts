import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadWastelandSettings, parseSettings } from '../load-settings.js';

// ============================================================
// parseSettings: a2a 配置块
// ============================================================

describe('parseSettings a2a', () => {
  it('parses a valid a2a block with agents and servers', async () => {
    const settings = await parseSettings(
      {
        a2a: {
          agents: [
            {
              name: 'codex',
              url: 'http://localhost:9200',
              description: 'remote coding agent',
              token: 'secret-token',
            },
          ],
          servers: {
            'claude-code': {
              enabled: true,
              port: 9200,
              command: 'claude',
              description: 'local hosted server',
            },
          },
        },
      },
      'test-settings.json'
    );

    expect(settings.a2a).toEqual({
      agents: [
        {
          name: 'codex',
          url: 'http://localhost:9200',
          description: 'remote coding agent',
          token: 'secret-token',
        },
      ],
      servers: {
        'claude-code': {
          enabled: true,
          port: 9200,
          command: 'claude',
          description: 'local hosted server',
        },
      },
    });
  });

  it('defaults missing agents/servers to empty collections', async () => {
    const settings = await parseSettings({ a2a: {} }, 'test-settings.json');
    expect(settings.a2a).toEqual({ agents: [], servers: {} });
  });

  it('throws when a2a is not an object', async () => {
    await expect(parseSettings({ a2a: [] }, 'test-settings.json')).rejects.toThrow(
      'a2a 必须是对象'
    );
  });

  it('throws when an agent is missing a non-empty url', async () => {
    await expect(
      parseSettings({ a2a: { agents: [{ name: 'x' }] } }, 'test-settings.json')
    ).rejects.toThrow('a2a.agents[0].url 必须是非空字符串');
  });

  it('throws when a server port is not a positive integer', async () => {
    await expect(
      parseSettings(
        { a2a: { servers: { s: { enabled: true, port: -1, command: 'c' } } } },
        'test-settings.json'
      )
    ).rejects.toThrow('a2a.servers.s.port 必须是正整数');
  });

  it('throws when a server enabled flag is not boolean', async () => {
    await expect(
      parseSettings(
        { a2a: { servers: { s: { enabled: 'yes', port: 1, command: 'c' } } } },
        'test-settings.json'
      )
    ).rejects.toThrow('a2a.servers.s.enabled 必须是布尔值');
  });
});

// ============================================================
// parseSettings: mcpServers（此前缺失 parse 分支，会被静默丢弃）
// ============================================================

describe('parseSettings mcpServers', () => {
  it('parses valid mcpServers', async () => {
    const settings = await parseSettings(
      {
        mcpServers: {
          fs: {
            command: 'npx',
            args: ['-y', 'fs-server'],
            env: { API_KEY: 'val' },
            requestTimeout: 5000,
          },
        },
      },
      'test-settings.json'
    );

    expect(settings.mcpServers?.fs).toMatchObject({
      command: 'npx',
      args: ['-y', 'fs-server'],
      requestTimeout: 5000,
    });
  });

  it('throws when command is missing', async () => {
    await expect(
      parseSettings({ mcpServers: { fs: { args: [] } } }, 'test-settings.json')
    ).rejects.toThrow('mcpServers.fs.command 必须是非空字符串');
  });

  it('throws when args is not a string array', async () => {
    await expect(
      parseSettings({ mcpServers: { fs: { command: 'x', args: [1] } } }, 'test-settings.json')
    ).rejects.toThrow('mcpServers.fs.args 必须是字符串数组');
  });
});

// ============================================================
// parseSettings: multiAgent 不再校验 mode/a2aServer
// ============================================================

describe('parseSettings multiAgent (mode/a2aServer removed)', () => {
  it('allows a sub agent without model (model is now optional)', async () => {
    const settings = await parseSettings(
      {
        multiAgent: {
          researcher: { promptTemplate: 'role-worker' },
        },
      },
      'test-settings.json'
    );

    expect(settings.multiAgent?.researcher).toMatchObject({ promptTemplate: 'role-worker' });
    expect(settings.multiAgent?.researcher.model).toBeUndefined();
  });

  it('ignores and strips legacy mode/a2aServer fields', async () => {
    const settings = await parseSettings(
      {
        multiAgent: {
          researcher: {
            mode: 'a2a',
            a2aServer: 'claude-code',
            promptTemplate: 'role-worker',
          },
        },
      },
      'test-settings.json'
    );

    const researcher = settings.multiAgent?.researcher;
    expect(researcher).toMatchObject({ promptTemplate: 'role-worker' });
    expect(researcher).not.toHaveProperty('mode');
    expect(researcher).not.toHaveProperty('a2aServer');
  });

  it('still validates non-empty skin', async () => {
    await expect(
      parseSettings({ multiAgent: { dev: { skin: '   ' } } }, 'test-settings.json')
    ).rejects.toThrow('multiAgent.dev.skin 必须是非空字符串');
  });
});

// ============================================================
// loadWastelandSettings: merge singleAgent + a2a（经完整管线）
// ============================================================

describe('loadWastelandSettings merge (singleAgent + a2a)', () => {
  let workDir: string;
  let userHome: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'wasteland-settings-project-'));
    userHome = await mkdtemp(join(tmpdir(), 'wasteland-settings-home-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
    await rm(userHome, { recursive: true, force: true });
  });

  async function writeProjectSettings(settings: unknown): Promise<void> {
    const dir = join(workDir, '.wasteland');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'settings.json'), JSON.stringify(settings), 'utf8');
  }

  async function writeUserSettings(settings: unknown): Promise<void> {
    await writeFile(join(userHome, 'settings.json'), JSON.stringify(settings), 'utf8');
  }

  function envForTest(): NodeJS.ProcessEnv {
    // 隔离用户全局配置目录，避免读取真实 ~/.wasteland
    return { WASTELAND_HOME: userHome };
  }

  it('singleAgent survives the full load pipeline (previously dropped)', async () => {
    await writeProjectSettings({
      singleAgent: { skin: 'solo-skin', model: 'solo-model', promptTemplate: 'orchestrator' },
    });

    const { settings } = await loadWastelandSettings({ cwd: workDir, env: envForTest() });

    expect(settings.singleAgent).toMatchObject({
      skin: 'solo-skin',
      model: 'solo-model',
      promptTemplate: 'orchestrator',
    });
  });

  it('merges singleAgent field-wise across user and project layers', async () => {
    await writeUserSettings({ singleAgent: { skin: 'user-skin', model: 'user-model' } });
    await writeProjectSettings({ singleAgent: { skin: 'project-skin' } });

    const { settings } = await loadWastelandSettings({ cwd: workDir, env: envForTest() });

    // project skin 覆盖 user skin；user model 保留
    expect(settings.singleAgent).toEqual({ skin: 'project-skin', model: 'user-model' });
  });

  it('merges a2a servers by name and agents by name across layers', async () => {
    await writeUserSettings({
      a2a: {
        agents: [{ name: 'alpha', url: 'http://alpha:1' }],
        servers: { s1: { enabled: true, port: 100, command: 'cmd-user' } },
      },
    });
    await writeProjectSettings({
      a2a: {
        agents: [
          { name: 'alpha', url: 'http://alpha:2', description: 'overridden' },
          { name: 'beta', url: 'http://beta:1' },
        ],
        servers: {
          s1: { enabled: false, port: 200, command: 'cmd-project' },
          s2: { enabled: true, port: 300, command: 'cmd-s2' },
        },
      },
    });

    const { settings } = await loadWastelandSettings({ cwd: workDir, env: envForTest() });

    // agents：alpha 按 name 去重（project 整体覆盖），beta 追加
    expect(settings.a2a.agents).toEqual([
      { name: 'alpha', url: 'http://alpha:2', description: 'overridden' },
      { name: 'beta', url: 'http://beta:1' },
    ]);

    // servers：s1 按名浅合并（project 字段覆盖），s2 新增
    expect(settings.a2a.servers).toEqual({
      s1: { enabled: false, port: 200, command: 'cmd-project' },
      s2: { enabled: true, port: 300, command: 'cmd-s2' },
    });
  });

  it('resolves $auth ref in a2a agent token', async () => {
    const dir = join(workDir, '.wasteland');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({
        a2a: { agents: [{ name: 'secure', url: 'http://s:1', token: { $auth: 'A2A_TOKEN' } }] },
      }),
      'utf8'
    );
    await writeFile(join(dir, 'auth.json'), JSON.stringify({ A2A_TOKEN: 'resolved-secret' }), 'utf8');

    const { settings } = await loadWastelandSettings({ cwd: workDir, env: envForTest() });

    expect(settings.a2a.agents[0]?.token).toBe('resolved-secret');
  });
});

// ============================================================
// 角色引用展开（roles.json → multiAgent[name].role）
// ============================================================

describe('role reference expansion (roles.json)', () => {
  let workDir: string;
  let userHome: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'wasteland-roles-project-'));
    userHome = await mkdtemp(join(tmpdir(), 'wasteland-roles-home-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
    await rm(userHome, { recursive: true, force: true });
  });

  async function writeProjectSettings(settings: unknown): Promise<void> {
    const dir = join(workDir, '.wasteland');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'settings.json'), JSON.stringify(settings), 'utf8');
  }

  async function writeProjectRoles(roles: unknown): Promise<void> {
    const dir = join(workDir, '.wasteland');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'roles.json'), JSON.stringify(roles), 'utf8');
  }

  function envForTest(): NodeJS.ProcessEnv {
    return { WASTELAND_HOME: userHome };
  }

  it('expands multiAgent[name].role from roles.json', async () => {
    await writeProjectRoles({
      roles: {
        researcher: { promptTemplate: 'role-worker', tools: 'read-file, glob', skins: ['scout'] },
      },
    });
    await writeProjectSettings({
      multiAgent: { researcher: { role: 'researcher', model: 'smart', skin: 'scout' } },
    });

    const { settings } = await loadWastelandSettings({ cwd: workDir, env: envForTest() });

    const expanded = settings.multiAgent?.researcher;
    // 角色定义展开：promptTemplate / tools / skins 来自 roles.json
    expect(expanded).toMatchObject({
      role: 'researcher',
      promptTemplate: 'role-worker',
      tools: 'read-file, glob',
      skins: ['scout'],
      model: 'smart', // 条目显式字段覆盖
      skin: 'scout',
    });
  });

  it('entry explicit fields override role definition', async () => {
    await writeProjectRoles({
      roles: {
        developer: { promptTemplate: 'role-worker', tools: 'bash', model: 'role-model' },
      },
    });
    await writeProjectSettings({
      multiAgent: { developer: { role: 'developer', model: 'instance-model' } },
    });

    const { settings } = await loadWastelandSettings({ cwd: workDir, env: envForTest() });

    expect(settings.multiAgent?.developer).toMatchObject({
      model: 'instance-model', // 条目显式覆盖角色定义
      promptTemplate: 'role-worker',
      tools: 'bash',
    });
  });

  it('keeps inline multiAgent entries without role untouched (backward compat)', async () => {
    await writeProjectSettings({
      multiAgent: { custom: { promptTemplate: 'role-worker', tools: 'read-file' } },
    });

    const { settings } = await loadWastelandSettings({ cwd: workDir, env: envForTest() });

    expect(settings.multiAgent?.custom).toMatchObject({
      promptTemplate: 'role-worker',
      tools: 'read-file',
    });
    expect(settings.multiAgent?.custom.role).toBeUndefined();
  });

  it('loads builtin default roles even without roles.json', async () => {
    const { settings } = await loadWastelandSettings({ cwd: workDir, env: envForTest() });

    expect(Object.keys(settings.roles ?? {})).toEqual(
      expect.arrayContaining(['orchestrator', 'researcher', 'developer', 'analyst', 'tester'])
    );
  });
});

// ============================================================
// parseSettings: runtime.compactionThreshold
// ============================================================

describe('parseSettings runtime.compactionThreshold', () => {
  it('parses a valid compactionThreshold', async () => {
    const settings = await parseSettings(
      { runtime: { compactionThreshold: 0.6 } },
      'test-settings.json'
    );
    expect(settings.runtime?.compactionThreshold).toBe(0.6);
  });

  it('rejects non-numeric compactionThreshold', async () => {
    await expect(
      parseSettings({ runtime: { compactionThreshold: 'high' } }, 'test-settings.json')
    ).rejects.toThrow(/compactionThreshold/);
  });

  it('rejects compactionThreshold <= 0', async () => {
    await expect(
      parseSettings({ runtime: { compactionThreshold: 0 } }, 'test-settings.json')
    ).rejects.toThrow(/compactionThreshold/);
  });

  it('rejects compactionThreshold > 1', async () => {
    await expect(
      parseSettings({ runtime: { compactionThreshold: 1.5 } }, 'test-settings.json')
    ).rejects.toThrow(/compactionThreshold/);
  });

  it('accepts compactionThreshold = 1 (boundary)', async () => {
    const settings = await parseSettings(
      { runtime: { compactionThreshold: 1 } },
      'test-settings.json'
    );
    expect(settings.runtime?.compactionThreshold).toBe(1);
  });
});

// ============================================================
// parseSettings: runtime.summarizationThreshold
// ============================================================

describe('parseSettings runtime.summarizationThreshold', () => {
  it('parses a valid summarizationThreshold', async () => {
    const settings = await parseSettings(
      { runtime: { summarizationThreshold: 0.9 } },
      'test-settings.json'
    );
    expect(settings.runtime?.summarizationThreshold).toBe(0.9);
  });

  it('rejects non-numeric summarizationThreshold', async () => {
    await expect(
      parseSettings({ runtime: { summarizationThreshold: 'high' } }, 'test-settings.json')
    ).rejects.toThrow(/summarizationThreshold/);
  });

  it('rejects summarizationThreshold <= 0', async () => {
    await expect(
      parseSettings({ runtime: { summarizationThreshold: 0 } }, 'test-settings.json')
    ).rejects.toThrow(/summarizationThreshold/);
  });

  it('rejects summarizationThreshold > 1', async () => {
    await expect(
      parseSettings({ runtime: { summarizationThreshold: 1.5 } }, 'test-settings.json')
    ).rejects.toThrow(/summarizationThreshold/);
  });

  it('rejects summarizationThreshold below compactionThreshold', async () => {
    await expect(
      parseSettings(
        { runtime: { compactionThreshold: 0.8, summarizationThreshold: 0.5 } },
        'test-settings.json'
      )
    ).rejects.toThrow(/summarizationThreshold/);
  });

  it('accepts summarizationThreshold equal to compactionThreshold (boundary)', async () => {
    const settings = await parseSettings(
      { runtime: { compactionThreshold: 0.8, summarizationThreshold: 0.8 } },
      'test-settings.json'
    );
    expect(settings.runtime?.summarizationThreshold).toBe(0.8);
  });
});

// ============================================================
// parseSettings: runtime.compactionBudgetRatio
// ============================================================

describe('parseSettings runtime.compactionBudgetRatio', () => {
  it('parses a valid compactionBudgetRatio', async () => {
    const settings = await parseSettings(
      { runtime: { compactionBudgetRatio: 0.5 } },
      'test-settings.json'
    );
    expect(settings.runtime?.compactionBudgetRatio).toBe(0.5);
  });

  it('rejects non-numeric compactionBudgetRatio', async () => {
    await expect(
      parseSettings({ runtime: { compactionBudgetRatio: 'half' } }, 'test-settings.json')
    ).rejects.toThrow(/compactionBudgetRatio/);
  });

  it('rejects compactionBudgetRatio = 0', async () => {
    await expect(
      parseSettings({ runtime: { compactionBudgetRatio: 0 } }, 'test-settings.json')
    ).rejects.toThrow(/compactionBudgetRatio/);
  });

  it('rejects compactionBudgetRatio < 0', async () => {
    await expect(
      parseSettings({ runtime: { compactionBudgetRatio: -1 } }, 'test-settings.json')
    ).rejects.toThrow(/compactionBudgetRatio/);
  });

  it('rejects compactionBudgetRatio > 1', async () => {
    await expect(
      parseSettings({ runtime: { compactionBudgetRatio: 1.5 } }, 'test-settings.json')
    ).rejects.toThrow(/compactionBudgetRatio/);
  });

  it('accepts compactionBudgetRatio = 1 (boundary)', async () => {
    const settings = await parseSettings(
      { runtime: { compactionBudgetRatio: 1 } },
      'test-settings.json'
    );
    expect(settings.runtime?.compactionBudgetRatio).toBe(1);
  });
});

// ============================================================
// loadWastelandSettings: compactionBudgetRatio 默认值 + 合并优先级
// ============================================================

describe('loadWastelandSettings compactionBudgetRatio merge', () => {
  let workDir: string;
  let userHome: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'wasteland-cbr-project-'));
    userHome = await mkdtemp(join(tmpdir(), 'wasteland-cbr-home-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
    await rm(userHome, { recursive: true, force: true });
  });

  async function writeProjectSettings(settings: unknown): Promise<void> {
    const dir = join(workDir, '.wasteland');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'settings.json'), JSON.stringify(settings), 'utf8');
  }

  async function writeUserSettings(settings: unknown): Promise<void> {
    await writeFile(join(userHome, 'settings.json'), JSON.stringify(settings), 'utf8');
  }

  function envForTest(): NodeJS.ProcessEnv {
    return { WASTELAND_HOME: userHome };
  }

  it('未配置时默认 0.6', async () => {
    const { settings } = await loadWastelandSettings({ cwd: workDir, env: envForTest() });
    expect(settings.runtime.compactionBudgetRatio).toBe(0.6);
  });

  it('项目配置覆盖默认值', async () => {
    await writeProjectSettings({ runtime: { compactionBudgetRatio: 0.5 } });
    const { settings } = await loadWastelandSettings({ cwd: workDir, env: envForTest() });
    expect(settings.runtime.compactionBudgetRatio).toBe(0.5);
  });

  it('项目配置覆盖用户配置（层间优先级）', async () => {
    await writeUserSettings({ runtime: { compactionBudgetRatio: 0.4 } });
    await writeProjectSettings({ runtime: { compactionBudgetRatio: 0.7 } });
    const { settings } = await loadWastelandSettings({ cwd: workDir, env: envForTest() });
    expect(settings.runtime.compactionBudgetRatio).toBe(0.7);
  });

  it('用户配置保留（项目未配置时）', async () => {
    await writeUserSettings({ runtime: { compactionBudgetRatio: 0.3 } });
    const { settings } = await loadWastelandSettings({ cwd: workDir, env: envForTest() });
    expect(settings.runtime.compactionBudgetRatio).toBe(0.3);
  });
});

// ============================================================
// parseSettings: runtime.projectMemory
// ============================================================

describe('parseSettings runtime.projectMemory', () => {
  it('parses a valid projectMemory flag', async () => {
    const on = await parseSettings({ runtime: { projectMemory: true } }, 'test-settings.json');
    expect(on.runtime?.projectMemory).toBe(true);
    const off = await parseSettings({ runtime: { projectMemory: false } }, 'test-settings.json');
    expect(off.runtime?.projectMemory).toBe(false);
  });

  it('rejects non-boolean projectMemory', async () => {
    await expect(
      parseSettings({ runtime: { projectMemory: 'yes' } }, 'test-settings.json')
    ).rejects.toThrow(/projectMemory/);
  });
});

// ============================================================
// loadWastelandSettings: 项目记忆加载
// ============================================================

describe('loadWastelandSettings project memory', () => {
  let workDir: string;
  let userHome: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'wasteland-mem-project-'));
    userHome = await mkdtemp(join(tmpdir(), 'wasteland-mem-home-'));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
    await rm(userHome, { recursive: true, force: true });
  });

  function envForTest(): NodeJS.ProcessEnv {
    return { WASTELAND_HOME: userHome };
  }

  async function writeProjectFile(name: string, content: string): Promise<void> {
    const dir = join(workDir, '.wasteland');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), content, 'utf8');
  }

  async function writeUserMemory(content: string): Promise<void> {
    await mkdir(userHome, { recursive: true });
    await writeFile(join(userHome, 'memory.md'), content, 'utf8');
  }

  it('无 memory.md 时返回空字符串', async () => {
    const { memory } = await loadWastelandSettings({ cwd: workDir, env: envForTest() });
    expect(memory).toBe('');
  });

  it('加载项目级 memory.md 到返回结构', async () => {
    // findProjectConfigDir 依据 settings.json/auth.json 识别项目目录，故补一个空 settings.json
    await writeProjectFile('settings.json', JSON.stringify({}));
    await writeProjectFile('memory.md', '本项目用 Vitest');
    const { memory } = await loadWastelandSettings({ cwd: workDir, env: envForTest() });
    expect(memory).toBe('本项目用 Vitest');
  });

  it('合并用户级 + 项目级 memory（用户级在前）', async () => {
    await writeProjectFile('settings.json', JSON.stringify({}));
    await writeProjectFile('memory.md', '项目约定');
    await writeUserMemory('全局约定');
    const { memory } = await loadWastelandSettings({ cwd: workDir, env: envForTest() });
    expect(memory).toBe('全局约定\n\n---\n\n项目约定');
  });

  it('projectMemory: false 时不加载 memory', async () => {
    await writeProjectFile('memory.md', '不应被读取');
    await writeProjectFile('settings.json', JSON.stringify({ runtime: { projectMemory: false } }));
    const { memory } = await loadWastelandSettings({ cwd: workDir, env: envForTest() });
    expect(memory).toBe('');
  });
});

describe('parseSettings runtime.mode', () => {
  it('正确解析 runtime.mode 为 single 或 multi', async () => {
    const s1 = await parseSettings({ runtime: { mode: 'multi' } }, 'test.json');
    expect(s1.runtime?.mode).toBe('multi');

    const s2 = await parseSettings({ runtime: { mode: 'single' } }, 'test.json');
    expect(s2.runtime?.mode).toBe('single');
  });

  it('非法 runtime.mode 抛出异常', async () => {
    await expect(
      parseSettings({ runtime: { mode: 'triple' } }, 'test.json')
    ).rejects.toThrow("runtime.mode 必须是 'single' 或 'multi'");
  });
});
