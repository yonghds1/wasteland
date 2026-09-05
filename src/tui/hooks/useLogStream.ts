/**
 * useLogStream - 订阅 LogBus 流式日志到 React 状态
 *
 * 设计要点：
 * - 接收一个可选的 `LogBus`；null 时 hook 仍可挂载但 entries 永远为空。
 * - 过滤在 hook 层完成（不进 LogBus）：保留 LogBus 的"广播到多 sink"语义，
 *   让 UI 层可以独立切 level / scope / sessionId 而不影响 FileSink。
 * - `paused` 状态下新 entry 进入 buffer，恢复时一次性 flush 到 entries。
 * - 队列满 maxEntries 时丢最旧（slice 截断）。
 * - 卸载时 unsubscribe，避免内存泄漏。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Subscription } from 'rxjs';
import { Logger } from '@core/logger/index.js';
import type { LogBus } from '@core/logger/index.js';
import type { LogEntry, LogLevel, LogScope } from '@core/logger/index.js';
import { LOG_LEVEL_RANK } from '@core/logger/index.js';

// ============================================================
// Options
// ============================================================

/**
 * useLogStream 配置选项。
 *
 * @property maxEntries - entries 最大条数（默认 50）；超出丢最旧
 * @property minLevel   - 最低 level（默认 'debug'，即全收）
 * @property scopes     - 允许的 scope 集合；undefined/空 = 不过滤 scope
 * @property sessionId  - sessionId 子串匹配；空 = 不过滤
 * @property kind       - 按 entry.data.kind 精确匹配；空 = 不过滤
 * @property initialEntries - 启动时注入的初始条目（通常从 FileLogLoader 加载的磁盘历史）
 */
export type UseLogStreamOptions = {
  maxEntries?: number;
  minLevel?: LogLevel;
  scopes?: ReadonlySet<LogScope>;
  sessionId?: string;
  kind?: string;
  initialEntries?: readonly LogEntry[];
};

/**
 * 条目来源标签：磁盘历史 vs 实时订阅。
 *
 * 通过 entry.data.__source 字段标记（不污染顶层 schema）。
 */
export type LogEntrySource = 'disk' | 'live';

/**
 * 标记 entry 来源。
 *
 * 注入 data.__source 字段，调用方可在 UI 上区分显示。
 */
function tagSource(entry: LogEntry, source: LogEntrySource): LogEntry {
  return {
    ...entry,
    data: { ...(entry.data ?? {}), __source: source },
  };
}

/**
 * 从 entry 提取来源标签（默认 'live'）。
 */
export function getEntrySource(entry: LogEntry): LogEntrySource {
  const data = entry.data as Record<string, unknown> | undefined;
  return data?.__source === 'disk' ? 'disk' : 'live';
}

// ============================================================
// Result
// ============================================================

/**
 * useLogStream 返回值。
 *
 * @property entries - 当前 entries 列表（最新在末尾）
 * @property paused  - 是否暂停 follow
 * @property pause   - 暂停；新事件进入 buffer 不入 entries
 * @property resume  - 恢复；将 buffer 一次性 flush 到 entries
 * @property clear   - 清空 entries 与 buffer
 */
export type UseLogStreamResult = {
  entries: LogEntry[];
  paused: boolean;
  pause: () => void;
  resume: () => void;
  clear: () => void;
};

// ============================================================
// 内部过滤函数
// ============================================================

/**
 * 在 hook 内做 entry 过滤。
 *
 * 与 LogBus.subscribe 的过滤选项语义一致，但 hooks 层额外支持 sessionId 子串和 kind 精确匹配。
 */
function makeEntryFilter(opts: {
  minLevel: LogLevel;
  scopes?: ReadonlySet<LogScope>;
  sessionId?: string;
  kind?: string;
}): (entry: LogEntry) => boolean {
  const { minLevel, scopes, sessionId, kind } = opts;
  const minRank = LOG_LEVEL_RANK[minLevel];
  const sidTrimmed = sessionId?.trim() ?? '';
  const kindTrimmed = kind?.trim() ?? '';

  return (entry: LogEntry): boolean => {
    if (LOG_LEVEL_RANK[entry.level] < minRank) return false;
    if (scopes && scopes.size > 0 && !scopes.has(entry.scope)) return false;
    if (sidTrimmed.length > 0 && !entry.sessionId.includes(sidTrimmed)) return false;
    if (kindTrimmed.length > 0) {
      const entryKind = (entry.data as Record<string, unknown> | undefined)?.kind;
      if (entryKind !== kindTrimmed) return false;
    }
    return true;
  };
}

// ============================================================
// Hook
// ============================================================

/**
 * useLogStream - 订阅 LogBus 并维护 entry 列表。
 *
 * 用法：
 * ```ts
 * const { entries, paused, pause, resume } = useLogStream(bus, {
 *   maxEntries: 50,
 *   minLevel: 'info',
 *   scopes: new Set(['tool', 'permission']),
 *   sessionId: 'abc-123',
 * });
 * ```
 *
 * 当 bus 切换时（同一组件内动态换 bus）会自动重新订阅。
 * 注意：本 hook 不直接依赖 Logger，但允许在 bus 为 null 时使用 `Logger.getBus()`
 * 作为 fallback，便于测试 + 不强制顶层必须挂 Provider。
 */
export function useLogStream(
  bus: LogBus | null | undefined,
  options: UseLogStreamOptions = {},
): UseLogStreamResult {
  const { maxEntries = 50, minLevel = 'debug', scopes, sessionId, kind, initialEntries } = options;

  // 初始 entries：标记为 disk 来源（来自历史）
  const [entries, setEntries] = useState<LogEntry[]>(() =>
    initialEntries ? initialEntries.map((e) => tagSource(e, 'disk')) : []
  );
  const [paused, setPaused] = useState<boolean>(false);

  // 用 ref 跟踪 paused，避免每次 paused 切换都重订阅
  const pausedRef = useRef<boolean>(false);
  pausedRef.current = paused;

  // buffer 用于 pause 期间的累积；resume 时 flush。
  const bufferRef = useRef<LogEntry[]>([]);

  const resolvedBus = bus ?? (Logger.getBus() as LogBus | null);
  // 用 ref 锁住 bus，effect 重新订阅时用最新值
  const busRef = useRef<LogBus | null>(resolvedBus);
  busRef.current = resolvedBus;

  // 把 entry 推到当前列表；超 maxEntries 时丢最旧。
  const appendEntries = useCallback(
    (newOnes: readonly LogEntry[]) => {
      if (newOnes.length === 0) return;
      setEntries((prev) => {
        const next = prev.length === 0 ? [...newOnes] : [...prev, ...newOnes];
        if (next.length > maxEntries) {
          return next.slice(next.length - maxEntries);
        }
        return next;
      });
    },
    [maxEntries],
  );

  useEffect(() => {
    const target = busRef.current;
    if (!target) {
      // 没有 bus 时清空 entries（防止挂上 bus 后看到旧数据）
      setEntries([]);
      return;
    }

    const filter = makeEntryFilter({ minLevel, scopes, sessionId, kind });

    const subscription: Subscription = target.asObservable().subscribe((entry) => {
      if (!filter(entry)) return;
      const liveEntry = tagSource(entry, 'live');
      if (pausedRef.current) {
        bufferRef.current.push(liveEntry);
        return;
      }
      appendEntries([liveEntry]);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [resolvedBus, minLevel, scopes, sessionId, kind, appendEntries]);

  const pause = useCallback((): void => {
    setPaused(true);
  }, []);

  const resume = useCallback((): void => {
    setPaused(false);
    const drained = bufferRef.current;
    bufferRef.current = [];
    appendEntries(drained);
  }, [appendEntries]);

  // 当 initialEntries 引用变化时（例如重新加载磁盘历史），合并新历史到 entries
  // 不重新订阅 bus，已有 live 条目保留
  // 注：仅当 initialEntries 引用真正变化时执行（避免重复 setState）
  const lastInitialRef = useRef<readonly LogEntry[] | undefined>(initialEntries);
  if (initialEntries !== lastInitialRef.current) {
    lastInitialRef.current = initialEntries;
    if (initialEntries) {
      const diskEntries = initialEntries.map((e) => tagSource(e, 'disk'));
      setEntries((prev) => {
        // 合并：disk 在前，live 在后，按 timestamp 倒序
        const merged = [...diskEntries, ...prev].sort((a, b) =>
          b.timestamp.localeCompare(a.timestamp)
        );
        return merged.slice(0, maxEntries);
      });
    }
  }

  const clear = useCallback((): void => {
    bufferRef.current = [];
    setEntries([]);
  }, []);

  return { entries, paused, pause, resume, clear };
}