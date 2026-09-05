import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadI18nWithPriority } from '../i18n-loader.js';
import type { I18nStrings } from '../i18n-loader.js';

// ============================================================
// 仅 base：无 user / project 覆盖时原样返回
// ============================================================

describe('loadI18nWithPriority 仅 base', () => {
  it('无 user/project 目录时返回 base 内容', async () => {
    const base: Record<string, I18nStrings> = {
      en: {
        cli: { description: 'base cli desc' },
        version: '1.0.0',
      },
      zh: {
        cli: { description: '基地 CLI 描述' },
      },
    };

    const result = await loadI18nWithPriority(base);

    expect(result.en).toEqual(base.en);
    expect(result.zh).toEqual(base.zh);
  });

  it('返回副本而非原引用（后续覆盖不影响 base）', async () => {
    const base: Record<string, I18nStrings> = {
      en: { cli: { description: 'base' } },
    };

    const result = await loadI18nWithPriority(base);

    expect(result).not.toBe(base);
    expect(result.en).not.toBe(base.en);
  });
});

// ============================================================
// 用户级覆盖：user 文件覆盖 base，key 级合并
// ============================================================

describe('loadI18nWithPriority 用户级覆盖', () => {
  let userDir: string;

  beforeEach(async () => {
    userDir = await mkdtemp(join(tmpdir(), 'wasteland-i18n-user-'));
  });

  afterEach(async () => {
    await rm(userDir, { recursive: true, force: true });
  });

  async function writeUserI18n(lang: string, content: unknown): Promise<void> {
    await writeFile(join(userDir, `${lang}.json`), JSON.stringify(content), 'utf8');
  }

  it('user 覆盖同名 key，base 独有 key 保留', async () => {
    const base: Record<string, I18nStrings> = {
      en: {
        cli: { description: 'base cli desc' },
        version: '1.0.0',
      },
    };
    await writeUserI18n('en', { cli: { description: 'user cli desc' } });

    const result = await loadI18nWithPriority(base, userDir);

    expect(result.en).toEqual({
      cli: { description: 'user cli desc' },
      version: '1.0.0',
    });
  });

  it('user 新增 key 会写入结果', async () => {
    const base: Record<string, I18nStrings> = {
      en: { cli: { description: 'base' } },
    };
    await writeUserI18n('en', { cli: { newKey: 'user new key' } });

    const result = await loadI18nWithPriority(base, userDir);

    expect(result.en).toEqual({ cli: { description: 'base', newKey: 'user new key' } });
  });

  it('嵌套对象深度合并', async () => {
    const base: Record<string, I18nStrings> = {
      en: {
        skins: { system: { labels: { user: 'User', system: 'System' } } },
      },
    };
    await writeUserI18n('en', { skins: { system: { labels: { user: 'Rider' } } } });

    const result = await loadI18nWithPriority(base, userDir);

    expect(result.en).toEqual({
      skins: { system: { labels: { user: 'Rider', system: 'System' } } },
    });
  });
});

// ============================================================
// 项目级优先级：project > user > base
// ============================================================

describe('loadI18nWithPriority 项目级优先级', () => {
  let userDir: string;
  let projectDir: string;

  beforeEach(async () => {
    userDir = await mkdtemp(join(tmpdir(), 'wasteland-i18n-user-'));
    projectDir = await mkdtemp(join(tmpdir(), 'wasteland-i18n-project-'));
  });

  afterEach(async () => {
    await rm(userDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  });

  async function writeI18n(dir: string, lang: string, content: unknown): Promise<void> {
    await writeFile(join(dir, `${lang}.json`), JSON.stringify(content), 'utf8');
  }

  it('project 覆盖 user 覆盖 base 的完整优先级链', async () => {
    const base: Record<string, I18nStrings> = {
      en: {
        cli: { description: 'base desc', devDescription: 'base dev desc' },
        version: '1.0.0',
      },
    };
    await writeI18n(userDir, 'en', { cli: { description: 'user desc' } });
    await writeI18n(projectDir, 'en', { cli: { description: 'project desc' } });

    const result = await loadI18nWithPriority(base, userDir, projectDir);

    expect(result.en).toEqual({
      cli: { description: 'project desc', devDescription: 'base dev desc' },
      version: '1.0.0',
    });
  });

  it('project 未覆盖的 key 保留 user / base 值', async () => {
    const base: Record<string, I18nStrings> = {
      en: { keyA: 'base a', keyB: 'base b' },
    };
    await writeI18n(userDir, 'en', { keyA: 'user a' });
    await writeI18n(projectDir, 'en', { keyB: 'project b' });

    const result = await loadI18nWithPriority(base, userDir, projectDir);

    expect(result.en).toEqual({ keyA: 'user a', keyB: 'project b' });
  });
});

// ============================================================
// 深度合并语义：对象递归合并，数组整体替换
// ============================================================

describe('loadI18nWithPriority 深度合并语义', () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'wasteland-i18n-merge-'));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  async function writeProjectI18n(lang: string, content: unknown): Promise<void> {
    await writeFile(join(projectDir, `${lang}.json`), JSON.stringify(content), 'utf8');
  }

  it('嵌套对象递归合并到任意深度', async () => {
    const base: Record<string, I18nStrings> = {
      en: {
        a: { b: { c: 'base c', keep: 'keep' } },
      },
    };
    await writeProjectI18n('en', { a: { b: { c: 'project c', deep: 'deep' } } });

    const result = await loadI18nWithPriority(base, undefined, projectDir);

    expect(result.en).toEqual({ a: { b: { c: 'project c', keep: 'keep', deep: 'deep' } } });
  });

  it('数组整体替换而非合并', async () => {
    const base: Record<string, I18nStrings> = {
      en: { colors: ['red', 'blue'] },
    };
    await writeProjectI18n('en', { colors: ['green'] });

    const result = await loadI18nWithPriority(base, undefined, projectDir);

    expect(result.en).toEqual({ colors: ['green'] });
  });

  it('null 值替换 base 值', async () => {
    const base: Record<string, I18nStrings> = {
      en: { nullable: 'base value' },
    };
    await writeProjectI18n('en', { nullable: null });

    const result = await loadI18nWithPriority(base, undefined, projectDir);

    expect(result.en).toEqual({ nullable: null });
  });
});

// ============================================================
// 缺失 locale 回退：文件不存在时保留低优先级值
// ============================================================

describe('loadI18nWithPriority 缺失 locale 回退', () => {
  let userDir: string;
  let projectDir: string;

  beforeEach(async () => {
    userDir = await mkdtemp(join(tmpdir(), 'wasteland-i18n-fallback-'));
    projectDir = await mkdtemp(join(tmpdir(), 'wasteland-i18n-fallback-'));
  });

  afterEach(async () => {
    await rm(userDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  });

  async function writeI18n(dir: string, lang: string, content: unknown): Promise<void> {
    await writeFile(join(dir, `${lang}.json`), JSON.stringify(content), 'utf8');
  }

  it('user 目录缺失某语言文件时回退到 base', async () => {
    const base: Record<string, I18nStrings> = {
      en: { cli: { description: 'base desc' } },
      zh: { cli: { description: '基地描述' } },
    };
    // 只有 en 有 user 文件，zh 缺失
    await writeI18n(userDir, 'en', { cli: { description: 'user en desc' } });

    const result = await loadI18nWithPriority(base, userDir);

    expect(result.en).toEqual({ cli: { description: 'user en desc' } });
    expect(result.zh).toEqual({ cli: { description: '基地描述' } }); // 回退 base
  });

  it('project 目录缺失某语言文件时保留 user / base 值', async () => {
    const base: Record<string, I18nStrings> = {
      en: { keyA: 'base a' },
      zh: { keyZ: 'base z' },
    };
    await writeI18n(userDir, 'en', { keyA: 'user a' });
    await writeI18n(userDir, 'zh', { keyZ: 'user z' });
    // project 只有 en 文件，zh 缺失
    await writeI18n(projectDir, 'en', { keyA: 'project a' });

    const result = await loadI18nWithPriority(base, userDir, projectDir);

    expect(result.en).toEqual({ keyA: 'project a' });
    expect(result.zh).toEqual({ keyZ: 'user z' }); // 保留 user 值
  });

  it('空目录（无任何文件）时全部回退到 base', async () => {
    const base: Record<string, I18nStrings> = {
      en: { cli: { description: 'base desc' } },
    };

    const result = await loadI18nWithPriority(base, userDir, projectDir);

    expect(result.en).toEqual({ cli: { description: 'base desc' } });
  });
});

// ============================================================
// 无效 JSON 回退 + 只处理 base 中的语言
// ============================================================

describe('loadI18nWithPriority 边界行为', () => {
  let userDir: string;
  let projectDir: string;

  beforeEach(async () => {
    userDir = await mkdtemp(join(tmpdir(), 'wasteland-i18n-edge-'));
    projectDir = await mkdtemp(join(tmpdir(), 'wasteland-i18n-edge-'));
  });

  afterEach(async () => {
    await rm(userDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  });

  it('user 文件是非法 JSON 时忽略该文件并回退 base', async () => {
    const base: Record<string, I18nStrings> = {
      en: { cli: { description: 'base desc' } },
    };
    await writeFile(join(userDir, 'en.json'), '{ not valid json', 'utf8');

    const result = await loadI18nWithPriority(base, userDir);

    expect(result.en).toEqual({ cli: { description: 'base desc' } });
  });

  it('project 文件是非法 JSON 时忽略并保留 user 值', async () => {
    const base: Record<string, I18nStrings> = {
      en: { keyA: 'base a' },
    };
    await writeFile(join(userDir, 'en.json'), JSON.stringify({ keyA: 'user a' }), 'utf8');
    await writeFile(join(projectDir, 'en.json'), '{ nope', 'utf8');

    const result = await loadI18nWithPriority(base, userDir, projectDir);

    expect(result.en).toEqual({ keyA: 'user a' });
  });

  it('只处理 base 中存在的语言，忽略 user 目录的额外语言', async () => {
    const base: Record<string, I18nStrings> = {
      en: { cli: { description: 'base desc' } },
    };
    await writeFile(join(userDir, 'fr.json'), JSON.stringify({ cli: { description: 'bonjour' } }), 'utf8');

    const result = await loadI18nWithPriority(base, userDir);

    expect(Object.keys(result)).toEqual(['en']);
    expect(result.en).toEqual({ cli: { description: 'base desc' } });
  });
});
