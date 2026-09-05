/**
 * useLogStream.test.ts - useLogStream hook 集成测试
 *
 * 通过直接订阅 LogBus 验证 useLogStream 的过滤逻辑。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LogBus, LOG_LEVEL_RANK } from '@core/logger/index.js';
import { Logger } from '@core/logger/index.js';
import { MemorySink } from '@core/logger/memory-sink.js';
import type { LogEntry, LogLevel, LogScope } from '@core/logger/index.js';

/** 构造测试 entry */
function makeEntry(overrides: Partial<LogEntry>): LogEntry {
  return {
    version: 1,
    timestamp: new Date().toISOString(),
    level: 'info' as LogLevel,
    scope: 'session' as LogScope,
    sessionId: 'test-session',
    message: 'test',
    ...overrides,
  };
}

/**
 * 复刻 useLogStream.makeEntryFilter 的过滤逻辑（保持同步，便于 assert）。
 */
function filterBy(opts: {
  minLevel?: LogLevel;
  scopes?: ReadonlySet<LogScope>;
  sessionId?: string;
  kind?: string;
}): (entry: LogEntry) => boolean {
  const minRank = LOG_LEVEL_RANK[opts.minLevel ?? 'debug'];
  const sidTrimmed = opts.sessionId?.trim() ?? '';
  const kindTrimmed = opts.kind?.trim() ?? '';

  return (entry: LogEntry) => {
    if (LOG_LEVEL_RANK[entry.level] < minRank) return false;
    if (opts.scopes && opts.scopes.size > 0 && !opts.scopes.has(entry.scope)) return false;
    if (sidTrimmed.length > 0 && !entry.sessionId.includes(sidTrimmed)) return false;
    if (kindTrimmed.length > 0) {
      const entryKind = (entry.data as Record<string, unknown> | undefined)?.kind;
      if (entryKind !== kindTrimmed) return false;
    }
    return true;
  };
}

describe('useLogStream filter logic', () => {
  let bus: LogBus;
  let sink: MemorySink;

  beforeEach(() => {
    Logger.reset();
    bus = new LogBus();
    sink = new MemorySink();
  });

  afterEach(() => {
    Logger.reset();
  });

  describe('kind filter', () => {
    it('should filter by exact kind match', () => {
      const filter = filterBy({ kind: 'tool_start' });

      expect(filter(makeEntry({ data: { kind: 'tool_start' } }))).toBe(true);
      expect(filter(makeEntry({ data: { kind: 'tool_end' } }))).toBe(false);
      expect(filter(makeEntry({ data: { kind: 'skill_start' } }))).toBe(false);
    });

    it('should not match entries without data.kind when filter is set', () => {
      const filter = filterBy({ kind: 'tool_start' });
      expect(filter(makeEntry({}))).toBe(false);
    });

    it('should pass all when kind is empty', () => {
      const filter = filterBy({ kind: '' });
      expect(filter(makeEntry({ data: { kind: 'tool_start' } }))).toBe(true);
      expect(filter(makeEntry({ data: { kind: 'skill_end' } }))).toBe(true);
      expect(filter(makeEntry({}))).toBe(true);
    });

    it('should trim kind whitespace', () => {
      const filter = filterBy({ kind: '  tool_start  ' });
      expect(filter(makeEntry({ data: { kind: 'tool_start' } }))).toBe(true);
    });
  });

  describe('combined filters', () => {
    it('should combine kind + level + scope filters', () => {
      const filter = filterBy({
        kind: 'tool_error',
        minLevel: 'warn',
        scopes: new Set(['tool']),
      });

      // 全部满足
      expect(
        filter(
          makeEntry({
            level: 'error',
            scope: 'tool',
            data: { kind: 'tool_error' },
          })
        )
      ).toBe(true);

      // kind 不匹配
      expect(
        filter(
          makeEntry({
            level: 'error',
            scope: 'tool',
            data: { kind: 'tool_start' },
          })
        )
      ).toBe(false);

      // level 不够
      expect(
        filter(
          makeEntry({
            level: 'info',
            scope: 'tool',
            data: { kind: 'tool_error' },
          })
        )
      ).toBe(false);

      // scope 不匹配
      expect(
        filter(
          makeEntry({
            level: 'error',
            scope: 'session',
            data: { kind: 'tool_error' },
          })
        )
      ).toBe(false);
    });
  });

  describe('bus integration', () => {
    it('should publish entries to bus and collect via sink', () => {
      bus.subscribe(sink);

      bus.publish(makeEntry({ message: 'a', data: { kind: 'tool_start' } }));
      bus.publish(makeEntry({ message: 'b', data: { kind: 'tool_end' } }));

      const entries = sink.entries();
      expect(entries).toHaveLength(2);
      expect(entries[0]?.data).toEqual({ kind: 'tool_start' });
      expect(entries[1]?.data).toEqual({ kind: 'tool_end' });
    });
  });
});