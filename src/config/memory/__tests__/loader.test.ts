/**
 * memory/loader.test.ts - 项目记忆加载器单元测试
 *
 * 覆盖：
 * - 读用户级/项目级 memory.md 并合并
 * - 文件不存在时容错返回空
 * - 合并顺序：用户级在前、项目级在后
 * - 项目级特化覆盖/追加语义
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadMemoryWithPriority, MEMORY_FILENAME } from '../loader.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wasteland-memory-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeMemory(subdir: string, content: string): Promise<string> {
  const target = join(dir, subdir);
  await mkdir(target, { recursive: true });
  await writeFile(join(target, MEMORY_FILENAME), content, 'utf8');
  return target;
}

describe('loadMemoryWithPriority', () => {
  it('无任何 memory 文件时返回空字符串', async () => {
    const { memory } = await loadMemoryWithPriority(
      join(dir, 'user'),
      join(dir, 'project')
    );
    expect(memory).toBe('');
  });

  it('只有用户级时返回用户级内容', async () => {
    const userDir = await writeMemory('user', '全局约定：代码注释用英文');
    const { memory } = await loadMemoryWithPriority(userDir, undefined);
    expect(memory).toBe('全局约定：代码注释用英文');
  });

  it('只有项目级时返回项目级内容', async () => {
    const projectDir = await writeMemory('project', '本项目用 Vitest');
    const { memory } = await loadMemoryWithPriority(undefined, projectDir);
    expect(memory).toBe('本项目用 Vitest');
  });

  it('用户级在前、项目级在后合并，用分隔符隔开', async () => {
    const userDir = await writeMemory('user', '全局约定：注释用英文');
    const projectDir = await writeMemory('project', '本项目用 Vitest');
    const { memory } = await loadMemoryWithPriority(userDir, projectDir);
    expect(memory).toBe('全局约定：注释用英文\n\n---\n\n本项目用 Vitest');
  });

  it('读失败（非目录）容错返回空', async () => {
    await writeFile(join(dir, 'not-dir'), 'x', 'utf8');
    const { memory } = await loadMemoryWithPriority(join(dir, 'not-dir'), undefined);
    expect(memory).toBe('');
  });
});