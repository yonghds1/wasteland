import { useState, useEffect, useMemo } from 'react';
import { join } from 'node:path';
import type { ProjectSessionSummary } from '@core/logger/data-store.js';
import { loadSessionEntries } from '@core/logger/file-log-loader.js';
import {
  buildGlobalTimeline,
  aggregateToolStats,
  type SessionLogGroup,
} from '../GlobalTimeline.js';
import type { TimelineMode } from '../logs-page-utils.js';
import { GLOBAL_MAX_SESSIONS } from './types.js';

export interface UseGlobalTimelineDataOptions {
  timelineMode: TimelineMode;
  diskSessions: ProjectSessionSummary[];
  dataRoot: string;
}

export interface UseGlobalTimelineDataResult {
  globalSessionEntries: SessionLogGroup[];
  globalTimelineLoading: boolean;
  globalLoadProgress: { done: number; total: number } | null;
  globalTimelineRecords: ReturnType<typeof buildGlobalTimeline>;
  globalStats: ReturnType<typeof aggregateToolStats>;
}

export function useGlobalTimelineData({
  timelineMode,
  diskSessions,
  dataRoot,
}: UseGlobalTimelineDataOptions): UseGlobalTimelineDataResult {
  const [globalSessionEntries, setGlobalSessionEntries] = useState<SessionLogGroup[]>([]);
  const [globalTimelineLoading, setGlobalTimelineLoading] = useState<boolean>(false);
  const [globalLoadProgress, setGlobalLoadProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (timelineMode !== 'global') {
      setGlobalSessionEntries([]);
      setGlobalLoadProgress(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const summaries = diskSessions.slice(0, GLOBAL_MAX_SESSIONS);

    setGlobalSessionEntries([]);
    setGlobalTimelineLoading(true);
    setGlobalLoadProgress({ done: 0, total: summaries.length });
    let done = 0;
    (async () => {
      await Promise.all(
        summaries.map(async (s) => {
          try {
            const entries = await loadSessionEntries({
              dir: join(dataRoot, 'logs', s.projectId),
              sessionId: s.sessionId,
              signal: controller.signal,
            });
            if (cancelled) return;
            done += 1;
            setGlobalLoadProgress({ done, total: summaries.length });
            setGlobalSessionEntries((prev) => [...prev, { sessionId: s.sessionId, entries }]);
          } catch {
            if (cancelled) return;
            done += 1;
            setGlobalLoadProgress({ done, total: summaries.length });
          }
        }),
      );
      if (!cancelled) {
        setGlobalTimelineLoading(false);
      }
    })().catch((err) => {
      if (!cancelled) {
        setGlobalTimelineLoading(false);
        console.warn('Failed to load global timeline:', (err as Error).message);
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [dataRoot, timelineMode, diskSessions]);

  const globalTimelineRecords = useMemo(
    () => buildGlobalTimeline(globalSessionEntries),
    [globalSessionEntries],
  );

  const globalStats = useMemo(
    () => aggregateToolStats(globalTimelineRecords),
    [globalTimelineRecords],
  );

  return {
    globalSessionEntries,
    globalTimelineLoading,
    globalLoadProgress,
    globalTimelineRecords,
    globalStats,
  };
}
