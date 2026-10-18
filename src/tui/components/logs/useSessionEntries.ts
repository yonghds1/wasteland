import { useState, useEffect, useMemo, useCallback } from 'react';
import { join } from 'node:path';
import type { LogEntry } from '@core/logger/index.js';
import type { ProjectSessionSummary } from '@core/logger/data-store.js';
import {
  loadSessionEntries,
  getCachedSessionEntries,
} from '@core/logger/file-log-loader.js';
import { createSessionIndex } from '@core/session/session-index.js';
import type { useLogBus } from '../LogBusProvider.js';
import { cardKeyFor, transcriptToLogEntries } from '../logs-page-utils.js';

export interface UseSessionEntriesOptions {
  selectedSessionSummary?: ProjectSessionSummary;
  dataRoot: string;
  showConversation: boolean;
  bus?: ReturnType<typeof useLogBus>;
}

export interface UseSessionEntriesResult {
  selectedSessionEntries: LogEntry[];
  selectedSessionLoading: boolean;
  liveBuffer: LogEntry[];
  mergedSessionEntries: LogEntry[];
  cardKeyByEntry: Map<LogEntry, string>;
  cardKeyOf: (e: LogEntry) => string;
}

export function useSessionEntries({
  selectedSessionSummary,
  dataRoot,
  showConversation,
  bus,
}: UseSessionEntriesOptions): UseSessionEntriesResult {
  const [selectedSessionEntries, setSelectedSessionEntries] = useState<LogEntry[]>([]);
  const [selectedSessionLoading, setSelectedSessionLoading] = useState<boolean>(false);
  const [transcriptEntries, setTranscriptEntries] = useState<LogEntry[]>([]);
  const [liveBuffer, setLiveBuffer] = useState<LogEntry[]>([]);

  // 订阅 LogBus 实时流
  useEffect(() => {
    if (!bus || !selectedSessionSummary) {
      setLiveBuffer([]);
      return;
    }
    const sid = selectedSessionSummary.sessionId;
    const sub = bus.asObservable().subscribe((entry) => {
      if (entry.sessionId !== sid) return;
      setLiveBuffer((prev) => {
        const next = [...prev, entry];
        return next.length > 500 ? next.slice(next.length - 500) : next;
      });
    });
    return () => sub.unsubscribe();
  }, [bus, selectedSessionSummary?.sessionId]);

  // 切换 session 时清空 live 缓冲
  useEffect(() => {
    setLiveBuffer([]);
  }, [selectedSessionSummary?.sessionId]);

  // 从磁盘按需加载日志条目
  useEffect(() => {
    if (!selectedSessionSummary) {
      setSelectedSessionEntries([]);
      return;
    }

    const logDir = join(dataRoot, 'logs', selectedSessionSummary.projectId);
    const sessionId = selectedSessionSummary.sessionId;

    const cached = getCachedSessionEntries(logDir, sessionId);
    if (cached) {
      setSelectedSessionEntries(cached);
      setSelectedSessionLoading(false);
    }

    let cancelled = false;
    const controller = new AbortController();

    if (!cached) {
      setSelectedSessionLoading(true);
    }
    loadSessionEntries({
      dir: logDir,
      sessionId,
      signal: controller.signal,
    })
      .then((entries) => {
        if (!cancelled) {
          setSelectedSessionEntries(entries);
          setSelectedSessionLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSelectedSessionLoading(false);
          console.warn('Failed to load session entries:', (err as Error).message);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedSessionSummary?.sessionId]);

  // 对话 transcript：加载用户/助手消息
  useEffect(() => {
    if (!showConversation || !selectedSessionSummary) {
      setTranscriptEntries([]);
      return;
    }
    let cancelled = false;
    createSessionIndex(join(dataRoot, 'sessions', selectedSessionSummary.projectId))
      .getSession(selectedSessionSummary.sessionId)
      .then((detail) => {
        if (!cancelled) {
          setTranscriptEntries(
            detail ? transcriptToLogEntries(detail.records, detail.id) : []
          );
        }
      })
      .catch(() => {
        if (!cancelled) setTranscriptEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [showConversation, selectedSessionSummary?.sessionId]);

  // 合并磁盘条目 + Live 缓冲 + 对话 transcript
  const mergedSessionEntries = useMemo(() => {
    const keyCounts = new Map<string, number>();
    const dedupKey = (e: LogEntry): string => {
      if (e.seq != null) return `seq:${e.seq}`;
      const base = `${e.timestamp}::${e.level}::${e.message}`;
      const n = keyCounts.get(base) ?? 0;
      keyCounts.set(base, n + 1);
      return `${base}#${n}`;
    };
    const seen = new Set(selectedSessionEntries.map(dedupKey));
    const extra = liveBuffer.filter((e) => !seen.has(dedupKey(e)));
    const base = [...selectedSessionEntries, ...extra];
    const withConversation = showConversation ? [...base, ...transcriptEntries] : base;
    return withConversation.sort((a, b) => {
      const cmp = a.timestamp.localeCompare(a.timestamp);
      if (cmp !== 0) return cmp;
      return (a.seq ?? 0) - (b.seq ?? 0);
    });
  }, [selectedSessionEntries, liveBuffer, showConversation, transcriptEntries]);

  // 卡片稳定键
  const cardKeyByEntry = useMemo(() => {
    const keys = new Map<LogEntry, string>();
    const ordinalByTs = new Map<string, number>();
    for (const e of mergedSessionEntries) {
      const ordinal = ordinalByTs.get(e.timestamp) ?? 0;
      ordinalByTs.set(e.timestamp, ordinal + 1);
      keys.set(e, cardKeyFor(e, ordinal));
    }
    return keys;
  }, [mergedSessionEntries]);

  const cardKeyOf = useCallback(
    (e: LogEntry): string => cardKeyByEntry.get(e) ?? cardKeyFor(e, 0),
    [cardKeyByEntry]
  );

  return {
    selectedSessionEntries,
    selectedSessionLoading,
    liveBuffer,
    mergedSessionEntries,
    cardKeyByEntry,
    cardKeyOf,
  };
}
