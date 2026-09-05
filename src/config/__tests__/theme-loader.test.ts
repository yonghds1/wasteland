import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadThemeWithPriority } from '../theme-loader.js';
import { wastelandColors } from '@theme/wasteland/colors.js';

// ============================================================
// 仅 base：无 user / project 覆盖时返回代码默认值副本
// ============================================================

describe('loadThemeWithPriority 仅 base', () => {
  it('无 user/project 目录时返回全部默认值', async () => {
    const theme = await loadThemeWithPriority();

    expect(theme).toEqual({ ...wastelandColors });
  });

  it('返回副本而非原引用（新对象，修改不影响模块常量）', async () => {
    const theme = await loadThemeWithPriority();

    expect(theme).not.toBe(wastelandColors);
    expect(theme.primary).toBe(wastelandColors.primary);
    expect(theme).toEqual({ ...wastelandColors });
  });

  it('空串目录按无覆盖处理（falsy 分支）', async () => {
    const theme = await loadThemeWithPriority('', '');

    expect(theme).toEqual({ ...wastelandColors });
  });
});

// ============================================================
// 用户级覆盖：user theme.json 覆盖同名 key，其余保留默认
// ============================================================

describe('loadThemeWithPriority 用户级覆盖', () => {
  let userDir: string;

  beforeEach(async () => {
    userDir = await mkdtemp(join(tmpdir(), 'wasteland-theme-user-'));
  });

  afterEach(async () => {
    await rm(userDir, { recursive: true, force: true });
  });

  async function writeUserTheme(content: unknown): Promise<void> {
    await writeFile(join(userDir, 'theme.json'), JSON.stringify(content), 'utf8');
  }

  it('user 覆盖同名 key，未覆盖的 key 保留默认值', async () => {
    await writeUserTheme({ primary: '#000000', accent: '#123456' });

    const theme = await loadThemeWithPriority(userDir);

    expect(theme.primary).toBe('#000000');
    expect(theme.accent).toBe('#123456');
    // 未覆盖的 key 保留默认
    expect(theme.secondary).toBe(wastelandColors.secondary);
    expect(theme.background).toBe(wastelandColors.background);
  });

  it('user 覆盖任意 key 且类型与原字段无关（浅合并语义）', async () => {
    await writeUserTheme({ text: 'not-a-color' });

    const theme = await loadThemeWithPriority(userDir);

    expect(theme.text).toBe('not-a-color');
  });

  it('空对象 theme.json 不改变任何值', async () => {
    await writeUserTheme({});

    const theme = await loadThemeWithPriority(userDir);

    expect(theme).toEqual({ ...wastelandColors });
  });
});

// ============================================================
// 项目级优先级：project > user > 默认
// ============================================================

describe('loadThemeWithPriority 项目级优先级', () => {
  let userDir: string;
  let projectDir: string;

  beforeEach(async () => {
    userDir = await mkdtemp(join(tmpdir(), 'wasteland-theme-user-'));
    projectDir = await mkdtemp(join(tmpdir(), 'wasteland-theme-project-'));
  });

  afterEach(async () => {
    await rm(userDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  });

  async function writeTheme(dir: string, content: unknown): Promise<void> {
    await writeFile(join(dir, 'theme.json'), JSON.stringify(content), 'utf8');
  }

  it('project 覆盖 user 覆盖默认的完整优先级链', async () => {
    await writeTheme(userDir, { primary: 'user-primary', secondary: 'user-secondary' });
    await writeTheme(projectDir, { primary: 'project-primary' });

    const theme = await loadThemeWithPriority(userDir, projectDir);

    expect(theme.primary).toBe('project-primary');
    expect(theme.secondary).toBe('user-secondary'); // user 值在 project 未覆盖时保留
    expect(theme.accent).toBe(wastelandColors.accent); // 默认值保留
  });

  it('user 与 project 各自覆盖不同 key 时互补合并', async () => {
    await writeTheme(userDir, { primary: 'user-primary' });
    await writeTheme(projectDir, { accent: 'project-accent' });

    const theme = await loadThemeWithPriority(userDir, projectDir);

    expect(theme.primary).toBe('user-primary');
    expect(theme.accent).toBe('project-accent');
    expect(theme.secondary).toBe(wastelandColors.secondary);
  });

  it('只传 project 时 project 直接覆盖默认值', async () => {
    await writeTheme(projectDir, { warning: 'project-warning' });

    const theme = await loadThemeWithPriority(undefined, projectDir);

    expect(theme.warning).toBe('project-warning');
    expect(theme.primary).toBe(wastelandColors.primary);
  });
});

// ============================================================
// 缺失 fallback：目录 / theme.json 缺失时忽略并保留低优先级值
// ============================================================

describe('loadThemeWithPriority 缺失 fallback', () => {
  it('不存在的目录被忽略，返回默认值', async () => {
    const theme = await loadThemeWithPriority(
      join(tmpdir(), 'no-such-user-dir'),
      join(tmpdir(), 'no-such-project-dir')
    );

    expect(theme).toEqual({ ...wastelandColors });
  });

  it('目录存在但无 theme.json 时忽略，保留低优先级值', async () => {
    const userDir = await mkdtemp(join(tmpdir(), 'wasteland-theme-empty-'));
    const projectDir = await mkdtemp(join(tmpdir(), 'wasteland-theme-empty-'));
    try {
      // 空目录，不写任何文件
      const theme = await loadThemeWithPriority(userDir, projectDir);

      expect(theme).toEqual({ ...wastelandColors });
    } finally {
      await rm(userDir, { recursive: true, force: true });
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('user 缺失时 project 值仍生效（按层级跳过 user）', async () => {
    const userDir = join(tmpdir(), `no-such-user-${Date.now()}`);
    const projectDir = await mkdtemp(join(tmpdir(), 'wasteland-theme-project-'));
    try {
      await writeFile(join(projectDir, 'theme.json'), JSON.stringify({ primary: 'project-primary' }), 'utf8');

      const theme = await loadThemeWithPriority(userDir, projectDir);

      expect(theme.primary).toBe('project-primary');
      expect(theme.secondary).toBe(wastelandColors.secondary);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('theme.json 是目录（readFile 失败）时被忽略', async () => {
    const userDir = await mkdtemp(join(tmpdir(), 'wasteland-theme-dirfile-'));
    try {
      // 把 theme.json 建为目录，readFile 会抛错
      await mkdir(join(userDir, 'theme.json'), { recursive: true });

      const theme = await loadThemeWithPriority(userDir);

      expect(theme).toEqual({ ...wastelandColors });
    } finally {
      await rm(userDir, { recursive: true, force: true });
    }
  });
});

// ============================================================
// 无效配置：非法 JSON / null 内容时忽略该文件
// ============================================================

describe('loadThemeWithPriority 无效配置处理', () => {
  let userDir: string;
  let projectDir: string;

  beforeEach(async () => {
    userDir = await mkdtemp(join(tmpdir(), 'wasteland-theme-invalid-'));
    projectDir = await mkdtemp(join(tmpdir(), 'wasteland-theme-invalid-'));
  });

  afterEach(async () => {
    await rm(userDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  });

  it('user theme.json 是非法 JSON 时忽略该文件并回退默认', async () => {
    await writeFile(join(userDir, 'theme.json'), '{ not valid json', 'utf8');

    const theme = await loadThemeWithPriority(userDir);

    expect(theme).toEqual({ ...wastelandColors });
  });

  it('project theme.json 是非法 JSON 时忽略并保留 user 值', async () => {
    await writeFile(join(userDir, 'theme.json'), JSON.stringify({ primary: 'user-primary' }), 'utf8');
    await writeFile(join(projectDir, 'theme.json'), '{ nope', 'utf8');

    const theme = await loadThemeWithPriority(userDir, projectDir);

    expect(theme.primary).toBe('user-primary');
  });

  it('内容为字面量 null 时按无效处理（falsy 跳过合并）', async () => {
    await writeFile(join(userDir, 'theme.json'), 'null', 'utf8');

    const theme = await loadThemeWithPriority(userDir);

    expect(theme).toEqual({ ...wastelandColors });
  });

  it('JSON 是数字等非对象时按浅合并实际行为处理（不抛错）', async () => {
    // 实现是 {...base, ...override}：数字 spread 为空对象，等价于无覆盖
    await writeFile(join(userDir, 'theme.json'), '42', 'utf8');

    const theme = await loadThemeWithPriority(userDir);

    expect(theme).toEqual({ ...wastelandColors });
  });
});
