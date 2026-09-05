/**
 * rotation.test.ts - cleanupDirectory 目录级清理单元测试
 *
 * 覆盖：
 * - 无上限 → no-op
 * - maxTotalFiles 超限 → 删除最旧文件直到收敛
 * - maxTotalSizeBytes 超限 → 删除最旧文件直到总大小收敛
 * - 两个上限叠加 → 同时满足后停止删除
 * - 目录不存在 → 返回 0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cleanupDirectory } from '../rotation.js';

describe('cleanupDirectory', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wasteland-rotation-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** 创建文件，可指定相对 mtime 年龄（ms）与内容大小（bytes）。 */
  async function makeFile(name: string, ageMs: number, size = 100): Promise<void> {
    const p = join(dir, name);
    await writeFile(p, 'x'.repeat(size));
    const t = new Date(Date.now() - ageMs);
    await utimes(p, t, t);
  }

  it('无上限（maxTotalSizeBytes/maxTotalFiles 均为 0）时 no-op', async () => {
    await makeFile('a.jsonl', 60_000);
    await makeFile('b.jsonl', 0);
    const removed = await cleanupDirectory({ dir });
    expect(removed).toBe(0);
    expect((await readdir(dir)).sort()).toEqual(['a.jsonl', 'b.jsonl']);
  });

  it('超过 maxTotalFiles 时删除最旧文件直到收敛', async () => {
    await makeFile('a.jsonl', 60_000);
    await makeFile('b.jsonl', 30_000);
    await makeFile('c.jsonl', 0);
    const removed = await cleanupDirectory({ dir, maxTotalFiles: 2 });
    expect(removed).toBe(1);
    expect((await readdir(dir)).sort()).toEqual(['b.jsonl', 'c.jsonl']);
  });

  it('超过 maxTotalSizeBytes 时删除最旧文件直到总大小收敛', async () => {
    await makeFile('a.jsonl', 60_000, 500);
    await makeFile('b.jsonl', 30_000, 500);
    await makeFile('c.jsonl', 0, 500);
    // 总 1500 > 1100：删 a（500）→ 1000 ≤ 1100 → 停止
    const removed = await cleanupDirectory({ dir, maxTotalSizeBytes: 1100 });
    expect(removed).toBe(1);
    expect((await readdir(dir)).sort()).toEqual(['b.jsonl', 'c.jsonl']);
  });

  it('同时满足两个上限后停止删除', async () => {
    await makeFile('a.jsonl', 60_000, 1000);
    await makeFile('b.jsonl', 30_000, 1000);
    await makeFile('c.jsonl', 0, 1000);
    // 3 文件 / 3000 bytes；maxTotalFiles=2, maxTotalSizeBytes=1500
    // 删 a → 剩 b,c（2000 bytes, 2 files）仍超 size → 删 b → 剩 c（1000, 1）
    const removed = await cleanupDirectory({
      dir,
      maxTotalFiles: 2,
      maxTotalSizeBytes: 1500,
    });
    expect(removed).toBe(2);
    expect(await readdir(dir)).toEqual(['c.jsonl']);
  });

  it('目录不存在时返回 0（不抛错）', async () => {
    const removed = await cleanupDirectory({ dir: join(dir, 'missing'), maxTotalFiles: 5 });
    expect(removed).toBe(0);
  });

  it('空目录返回 0', async () => {
    const removed = await cleanupDirectory({ dir, maxTotalFiles: 5 });
    expect(removed).toBe(0);
  });
});
