/**
 * file-log-loader.test.ts - FileLogLoader 单元测试
 */

import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readdirSync, existsSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  loadRecentLogs,
  loadSessionEntries,
  listSessions,
  getCachedSessionEntries,
  clearSessionEntryCache,
  MAX_SESSION_CACHE_ITEMS,
} from '../file-log-loader.js';

function makeEntry(timestamp: string, sessionId: string = 's1', message: string = 'test'): string {
  return JSON.stringify({
    version: 1,
    timestamp,
    level: 'info',
    scope: 'session',
    sessionId,
    message,
  });
}

describe('FileLogLoader.loadRecentLogs', () => {
  let scratchDir: string;
  let sessionsDir: string;

  beforeEach(() => {
    scratchDir = `${tmpdir()}/wasteland-logs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionsDir = join(scratchDir, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(scratchDir)) {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  describe('empty / missing directory', () => {
    it('should return empty array when directory does not exist', async () => {
      const result = await loadRecentLogs({
        dir: `${scratchDir}-nonexistent`,
        limit: 50,
      });
      expect(result).toEqual([]);
    });

    it('should return empty array when sessions directory is empty', async () => {
      const result = await loadRecentLogs({ dir: scratchDir, limit: 50 });
      expect(result).toEqual([]);
    });
  });

  describe('single file', () => {
    it('should parse a JSONL file with valid entries', async () => {
      writeFileSync(
        join(sessionsDir, '2026-08-08_100000-s1.jsonl'),
        [
          makeEntry('2026-08-08T10:00:00.000Z', 's1', 'first'),
          makeEntry('2026-08-08T10:01:00.000Z', 's1', 'second'),
          makeEntry('2026-08-08T10:02:00.000Z', 's2', 'third'),
        ].join('\n')
      );

      const result = await loadRecentLogs({ dir: scratchDir, limit: 50 });
      expect(result).toHaveLength(3);
      expect(result.map((e) => e.message)).toEqual(['third', 'second', 'first']); // 倒序
    });

    it('should skip corrupted lines', async () => {
      writeFileSync(
        join(sessionsDir, '2026-08-08_100000-s1.jsonl'),
        [
          makeEntry('2026-08-08T10:00:00.000Z', 's1', 'valid-1'),
          '{not valid json',
          makeEntry('2026-08-08T10:01:00.000Z', 's1', 'valid-2'),
          '',
          makeEntry('2026-08-08T10:02:00.000Z', 's1', 'valid-3'),
        ].join('\n')
      );

      const result = await loadRecentLogs({ dir: scratchDir, limit: 50 });
      expect(result).toHaveLength(3);
      expect(result.every((e) => e.message.startsWith('valid'))).toBe(true);
    });

    it('should respect limit', async () => {
      const entries = Array.from({ length: 10 }, (_, i) =>
        makeEntry(`2026-08-08T10:0${i}:00.000Z`, 's1', `entry-${i}`)
      );
      writeFileSync(join(sessionsDir, '2026-08-08_100000-s1.jsonl'), entries.join('\n'));

      const result = await loadRecentLogs({ dir: scratchDir, limit: 3 });
      expect(result).toHaveLength(3);
      // 最新 3 条
      expect(result.map((e) => e.message)).toEqual(['entry-9', 'entry-8', 'entry-7']);
    });

    it('should skip files with non-matching naming pattern', async () => {
      writeFileSync(
        join(sessionsDir, '2026-08-08_100000-s1.jsonl'),
        makeEntry('2026-08-08T10:00:00.000Z', 's1', 'good')
      );
      writeFileSync(
        join(sessionsDir, 'error.jsonl'),
        makeEntry('2026-08-08T10:00:00.000Z', 's1', 'error-file')
      );
      writeFileSync(
        join(sessionsDir, '.hidden.jsonl'),
        makeEntry('2026-08-08T10:00:00.000Z', 's1', 'hidden')
      );

      const result = await loadRecentLogs({ dir: scratchDir, limit: 50 });
      expect(result).toHaveLength(1);
      expect(result[0]?.message).toBe('good');
    });

    it('should skip gzip files', async () => {
      writeFileSync(
        join(sessionsDir, '2026-08-08_100000-s1.jsonl'),
        makeEntry('2026-08-08T10:00:00.000Z', 's1', 'jsonl')
      );
      writeFileSync(
        join(sessionsDir, '2026-07-29_100000-old.jsonl.gz'),
        'gzipped content'
      );

      const result = await loadRecentLogs({ dir: scratchDir, limit: 50 });
      expect(result).toHaveLength(1);
    });
  });

  describe('multiple files', () => {
    it('should merge entries from multiple files sorted by mtime desc', async () => {
      // 老 session
      writeFileSync(
        join(sessionsDir, '2026-08-05_100000-old.jsonl'),
        makeEntry('2026-08-05T10:00:00.000Z', 's1', 'oldest')
      );
      // 中等
      writeFileSync(
        join(sessionsDir, '2026-08-08_100000-mid.jsonl'),
        makeEntry('2026-08-08T10:00:00.000Z', 's1', 'middle')
      );
      // 最新
      writeFileSync(
        join(sessionsDir, '2026-08-10_100000-new.jsonl'),
        makeEntry('2026-08-10T10:00:00.000Z', 's1', 'newest')
      );

      const result = await loadRecentLogs({ dir: scratchDir, limit: 50 });
      // 按 mtime 排序，最新创建的文件先读
      expect(result.map((e) => e.message)).toEqual(['newest', 'middle', 'oldest']);
    });

    it('should respect limit across multiple files', async () => {
      // 旧 session 3 条
      writeFileSync(
        join(sessionsDir, '2026-08-05_100000-old.jsonl'),
        Array.from({ length: 3 }, (_, i) =>
          makeEntry(`2026-08-05T10:0${i}:00.000Z`, 's1', `old-${i}`)
        ).join('\n')
      );
      // 新 session 3 条
      writeFileSync(
        join(sessionsDir, '2026-08-10_100000-new.jsonl'),
        Array.from({ length: 3 }, (_, i) =>
          makeEntry(`2026-08-10T10:0${i}:00.000Z`, 's1', `new-${i}`)
        ).join('\n')
      );

      const result = await loadRecentLogs({ dir: scratchDir, limit: 4 });
      expect(result).toHaveLength(4);
      expect(result.map((e) => e.message)).toEqual(['new-2', 'new-1', 'new-0', 'old-2']);
    });
  });

  describe('abort signal', () => {
    it('should support AbortSignal', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        loadRecentLogs({ dir: scratchDir, limit: 50, signal: controller.signal })
      ).rejects.toThrow('Aborted');
    });
  });

  describe('readdir error handling', () => {
    it('should return empty array on ENOENT (handled gracefully)', async () => {
      const result = await loadRecentLogs({
        dir: `${tmpdir()}/this-path-definitely-does-not-exist-${Date.now()}`,
        limit: 50,
      });
      expect(result).toEqual([]);
    });
  });

  describe('integration', () => {
    it('should list sessions directory after load', async () => {
      writeFileSync(
        join(sessionsDir, '2026-08-08_100000-s1.jsonl'),
        makeEntry('2026-08-08T10:00:00.000Z', 's1', 'entry')
      );

      await loadRecentLogs({ dir: scratchDir, limit: 50 });

      const files = readdirSync(sessionsDir);
      expect(files.length).toBe(1);
      expect(files[0]).toBe('2026-08-08_100000-s1.jsonl');
    });
  });
});

// ============================================================
// T14：session 条目 / 列表 加载缓存
// ============================================================

describe('FileLogLoader.session entry cache', () => {
  let scratchDir: string;
  let sessionsDir: string;

  /** 固定的 mtime（整数毫秒），保证指纹字符串确定可比。 */
  const FIXED_MTIME = new Date(1700000000000);

  beforeEach(() => {
    scratchDir = `${tmpdir()}/wasteland-loader-cache-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionsDir = join(scratchDir, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    clearSessionEntryCache();
  });

  afterEach(() => {
    clearSessionEntryCache();
    if (existsSync(scratchDir)) {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  describe('loadSessionEntries 缓存', () => {
    it('从 dir/sessions/<sessionId>.jsonl 读取指定 session 条目（正序）', async () => {
      writeFileSync(
        join(sessionsDir, 's1.jsonl'),
        [
          makeEntry('2026-08-08T10:00:00.000Z', 's1', 'a'),
          makeEntry('2026-08-08T10:01:00.000Z', 's1', 'b'),
        ].join('\n') + '\n'
      );
      const entries = await loadSessionEntries({ dir: scratchDir, sessionId: 's1' });
      expect(entries.map((e) => e.message)).toEqual(['a', 'b']);
    });

    it('缓存命中不重复读盘（等长垃圾 + 同 mtime 覆盖后仍返回缓存内容）', async () => {
      const file = join(sessionsDir, 's1.jsonl');
      const line = makeEntry('2026-08-08T10:00:00.000Z', 's1', 'cached-ok') + '\n';
      writeFileSync(file, line);
      utimesSync(file, FIXED_MTIME, FIXED_MTIME);

      const first = await loadSessionEntries({ dir: scratchDir, sessionId: 's1' });
      expect(first.map((e) => e.message)).toEqual(['cached-ok']);

      // 用等长垃圾覆盖 + 恢复相同 mtime：指纹（mtimeMs:size）不变 → 命中缓存。
      // 若真的重读盘，会读到垃圾 → 返回空数组，测试即失败。
      writeFileSync(file, 'G'.repeat(line.length));
      utimesSync(file, FIXED_MTIME, FIXED_MTIME);
      const stats = statSync(file);
      expect(stats.size).toBe(line.length);

      const second = await loadSessionEntries({ dir: scratchDir, sessionId: 's1' });
      expect(second.map((e) => e.message)).toEqual(['cached-ok']);
    });

    it('日志写入（文件 mtime/size 变化）后缓存失效并重读', async () => {
      const file = join(sessionsDir, 's1.jsonl');
      writeFileSync(file, makeEntry('2026-08-08T10:00:00.000Z', 's1', 'a') + '\n');
      await loadSessionEntries({ dir: scratchDir, sessionId: 's1' });

      // 追加一条新日志：size/mtime 变化 → 缓存失效 → 重读
      writeFileSync(
        file,
        [
          makeEntry('2026-08-08T10:00:00.000Z', 's1', 'a'),
          makeEntry('2026-08-08T10:01:00.000Z', 's1', 'b'),
        ].join('\n') + '\n'
      );
      const entries = await loadSessionEntries({ dir: scratchDir, sessionId: 's1' });
      expect(entries.map((e) => e.message)).toEqual(['a', 'b']);
    });

    it('getCachedSessionEntries：加载前 undefined，加载后可同步读取，clear 后失效', async () => {
      const file = join(sessionsDir, 's1.jsonl');
      writeFileSync(file, makeEntry('2026-08-08T10:00:00.000Z', 's1', 'a') + '\n');
      expect(getCachedSessionEntries(scratchDir, 's1')).toBeUndefined();

      await loadSessionEntries({ dir: scratchDir, sessionId: 's1' });
      expect(getCachedSessionEntries(scratchDir, 's1')?.map((e) => e.message)).toEqual(['a']);

      clearSessionEntryCache();
      expect(getCachedSessionEntries(scratchDir, 's1')).toBeUndefined();
    });

    it('session 文件不存在返回空数组', async () => {
      const entries = await loadSessionEntries({ dir: scratchDir, sessionId: 'nope' });
      expect(entries).toEqual([]);
    });

    it('条目缓存有界：超过上限后按插入序淘汰最旧，最新仍可命中', async () => {
      const total = MAX_SESSION_CACHE_ITEMS + 5;
      const ids = Array.from({ length: total }, (_, i) => `s${String(i).padStart(3, '0')}`);
      for (const id of ids) {
        writeFileSync(
          join(sessionsDir, `${id}.jsonl`),
          makeEntry('2026-08-08T10:00:00.000Z', id, `msg-${id}`) + '\n'
        );
      }
      for (const id of ids) {
        await loadSessionEntries({ dir: scratchDir, sessionId: id });
      }
      // 最早插入的 5 个被 FIFO 淘汰 → getCachedSessionEntries 不再命中
      for (const id of ids.slice(0, 5)) {
        expect(getCachedSessionEntries(scratchDir, id)).toBeUndefined();
      }
      // 最晚插入的仍命中缓存（不必重读盘）
      for (const id of ids.slice(-5)) {
        expect(getCachedSessionEntries(scratchDir, id)?.map((e) => e.message)).toEqual([`msg-${id}`]);
      }
    });
  });

  describe('listSessions 缓存', () => {
    it('从 dir/sessions/ 子目录扫描 session 摘要', async () => {
      writeFileSync(
        join(sessionsDir, 's1.jsonl'),
        makeEntry('2026-08-08T10:00:00.000Z', 's1', 'a') + '\n'
      );
      const sessions = await listSessions({ dir: scratchDir });
      expect(sessions.map((s) => s.sessionId)).toEqual(['s1']);
      expect(sessions[0]?.count).toBe(1);
    });

    it('缓存命中不重复扫描（等长垃圾 + 同 mtime 覆盖后仍返回原摘要）', async () => {
      const file = join(sessionsDir, 's1.jsonl');
      const line = makeEntry('2026-08-08T10:00:00.000Z', 's1', 'a') + '\n';
      writeFileSync(file, line);
      utimesSync(file, FIXED_MTIME, FIXED_MTIME);

      const first = await listSessions({ dir: scratchDir });
      expect(first.map((s) => s.sessionId)).toEqual(['s1']);

      writeFileSync(file, 'G'.repeat(line.length));
      utimesSync(file, FIXED_MTIME, FIXED_MTIME);

      const second = await listSessions({ dir: scratchDir });
      // 若重扫会解析不出 s1（文件是垃圾）→ 列表为空，测试即失败
      expect(second.map((s) => s.sessionId)).toEqual(['s1']);
    });

    it('session 列表变化（新增文件）后缓存失效重扫', async () => {
      writeFileSync(
        join(sessionsDir, 's1.jsonl'),
        makeEntry('2026-08-08T10:00:00.000Z', 's1', 'a') + '\n'
      );
      const first = await listSessions({ dir: scratchDir });
      expect(first).toHaveLength(1);

      writeFileSync(
        join(sessionsDir, 's2.jsonl'),
        makeEntry('2026-08-08T10:01:00.000Z', 's2', 'b') + '\n'
      );
      const second = await listSessions({ dir: scratchDir });
      expect(second).toHaveLength(2);
      expect(second.some((s) => s.sessionId === 's2')).toBe(true);
    });

    it('session 文件删除后缓存失效重扫', async () => {
      writeFileSync(
        join(sessionsDir, 's1.jsonl'),
        makeEntry('2026-08-08T10:00:00.000Z', 's1', 'a') + '\n'
      );
      writeFileSync(
        join(sessionsDir, 's2.jsonl'),
        makeEntry('2026-08-08T10:01:00.000Z', 's2', 'b') + '\n'
      );
      await listSessions({ dir: scratchDir });

      rmSync(join(sessionsDir, 's1.jsonl'));
      const sessions = await listSessions({ dir: scratchDir });
      expect(sessions.map((s) => s.sessionId)).toEqual(['s2']);
    });
  });

  describe('loadSessionEntries 轮转归档', () => {
    it('合并 active + .1 归档并按时间正序', async () => {
      writeFileSync(
        join(sessionsDir, 's1.jsonl'),
        makeEntry('2026-08-08T10:02:00.000Z', 's1', 'new') + '\n'
      );
      writeFileSync(
        join(sessionsDir, 's1.jsonl.1'),
        [
          makeEntry('2026-08-08T10:00:00.000Z', 's1', 'old-a'),
          makeEntry('2026-08-08T10:01:00.000Z', 's1', 'old-b'),
        ].join('\n') + '\n'
      );
      const entries = await loadSessionEntries({ dir: scratchDir, sessionId: 's1' });
      expect(entries.map((e) => e.message)).toEqual(['old-a', 'old-b', 'new']);
    });

    it('active 缺失时仍返回归档内容', async () => {
      writeFileSync(
        join(sessionsDir, 's1.jsonl.1'),
        makeEntry('2026-08-08T10:00:00.000Z', 's1', 'archived') + '\n'
      );
      const entries = await loadSessionEntries({ dir: scratchDir, sessionId: 's1' });
      expect(entries.map((e) => e.message)).toEqual(['archived']);
    });

    it('损坏的归档只跳过该档，不丢整个 session', async () => {
      writeFileSync(
        join(sessionsDir, 's1.jsonl'),
        makeEntry('2026-08-08T10:02:00.000Z', 's1', 'new') + '\n'
      );
      writeFileSync(join(sessionsDir, 's1.jsonl.1'), 'NOT-JSON{{{');
      const entries = await loadSessionEntries({ dir: scratchDir, sessionId: 's1' });
      expect(entries.map((e) => e.message)).toEqual(['new']);
    });

    it('归档变化导致指纹失效并重读', async () => {
      writeFileSync(
        join(sessionsDir, 's1.jsonl'),
        makeEntry('2026-08-08T10:01:00.000Z', 's1', 'a') + '\n'
      );
      expect((await loadSessionEntries({ dir: scratchDir, sessionId: 's1' })).map((e) => e.message)).toEqual(['a']);

      // 模拟轮转：active 内容移到 .1，active 写新条目
      writeFileSync(
        join(sessionsDir, 's1.jsonl.1'),
        makeEntry('2026-08-08T10:00:00.000Z', 's1', 'old') + '\n'
      );
      writeFileSync(
        join(sessionsDir, 's1.jsonl'),
        makeEntry('2026-08-08T10:01:00.000Z', 's1', 'a') + '\n'
      );
      const entries = await loadSessionEntries({ dir: scratchDir, sessionId: 's1' });
      expect(entries.map((e) => e.message)).toEqual(['old', 'a']);
    });
  });
});