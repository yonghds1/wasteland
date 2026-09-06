/**
 * session-index.test.ts - Session 索引检索单元测试
 *
 * 覆盖：
 * - getSession：从记录聚合上下文压缩统计（compactionStats）
 *   （可观测性：压缩次数 / 摘要 vs 同步 / 累计节省 token）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SessionIndex } from '../session-index.js';
import type { SessionRecord } from '../../runtime/event-types.js';

let dir: string;
let index: SessionIndex;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wasteland-session-test-'));
  index = new SessionIndex(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeSession(id: string, records: SessionRecord[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  const lines = records.map((r) => JSON.stringify(r)).join('\n');
  await writeFile(join(dir, `${id}.jsonl`), `${lines}\n`);
}

function startRecord(id: string): SessionRecord {
  return {
    type: 'session',
    sessionId: id,
    mode: 'single',
    cwd: '/tmp',
    provider: 'anthropic',
    timestamp: '2026-08-08T00:00:00.000Z',
  };
}

function messageRecord(role: 'user' | 'assistant', content: string): SessionRecord {
  return {
    type: 'message',
    turn: 1,
    role,
    content,
    timestamp: '2026-08-08T00:00:00.000Z',
  };
}

function compactionRecord(
  id: string,
  turn: number,
  removedCount: number,
  tokensSaved: number,
  summarized: boolean
): SessionRecord {
  return {
    type: 'compaction',
    sessionId: id,
    turn,
    removedCount,
    tokensSaved,
    summarized,
    timestamp: '2026-08-08T00:00:00.000Z',
  };
}

describe('getSession compactionStats', () => {
  it('有压缩记录时聚合统计（摘要 + 同步）', async () => {
    const id = 'test-session-1';
    await writeSession(id, [
      startRecord(id),
      messageRecord('user', 'hello'),
      messageRecord('assistant', 'hi'),
      compactionRecord(id, 1, 10, 5000, true), // 摘要压缩
      compactionRecord(id, 2, 5, 2000, false), // 同步切割
    ]);

    const detail = await index.getSession(id);
    expect(detail).not.toBeNull();
    expect(detail!.compactionStats).toEqual({
      count: 2,
      summarizedCount: 1,
      syncCount: 1,
      tokensSaved: 7000,
    });
  });

  it('无压缩记录时 compactionStats 为 undefined', async () => {
    const id = 'test-session-2';
    await writeSession(id, [
      startRecord(id),
      messageRecord('user', 'hello'),
      messageRecord('assistant', 'hi'),
    ]);

    const detail = await index.getSession(id);
    expect(detail).not.toBeNull();
    expect(detail!.compactionStats).toBeUndefined();
  });

  it('未知 session 返回 null', async () => {
    expect(await index.getSession('does-not-exist')).toBeNull();
  });
});