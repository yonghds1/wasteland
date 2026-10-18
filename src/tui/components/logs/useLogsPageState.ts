import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { join } from 'node:path';
import { useStdout } from 'ink';
import { getCurrentProjectId, resolveDefaultDataDir } from '@config/paths.js';
import { listAllSessions, type ProjectSessionSummary } from '@core/logger/data-store.js';
import type { LogLevel } from '@core/logger/index.js';
import { useAppContext } from '../../context/AppContext.js';
import { useLogsKeymap } from '../../hooks/useLogsKeymap.js';
import { useLogBus } from '../LogBusProvider.js';
import { useScroll } from '../ScrollableBox.js';
import { sliceCardWindow, wrapRowCount } from '../card-window.js';
import { buildToolTimeline, TIMELINE_ROW_HEIGHT } from '../ToolTimeline.js';
import type { LogsView, TimelineMode, TimelineMetric, ErrorContextWindow } from '../logs-page-utils.js';
import {
  getShortcutHelp,
  filterLogEntries,
  countErrorEntries,
  scrollToReveal,
  DEFAULT_CONTEXT_RADIUS,
  getErrorContextWindowAt,
} from '../logs-page-utils.js';
import {
  CARD_HEIGHT,
  SESSION_ROW_HEIGHT,
  SESSION_LIST_POLL_MS,
  projectTag,
  relativeTimeStrFor,
  parseSearchDraft,
  type LogsPageState,
  type UseLogsPageStateOptions,
} from './types.js';
import { useSessionEntries } from './useSessionEntries.js';
import { useGlobalTimelineData } from './useGlobalTimelineData.js';
import { useLogExport } from './useLogExport.js';

export * from './types.js';

export function useLogsPageState({
  initialView = 'list',
  contextRadius = DEFAULT_CONTEXT_RADIUS,
  exportDir: exportDirProp,
}: UseLogsPageStateOptions = {}): LogsPageState {
  const { state, setCurrentPage, setInputMode } = useAppContext();

  const dataRoot = useMemo(() => resolveDefaultDataDir({ cwd: process.cwd() }), []);
  const currentProjectId = useMemo(() => getCurrentProjectId(), []);

  const [minLevel, setMinLevel] = useState<LogLevel>(state.logPageFilter.level ?? 'info');
  const [sessionFilter, setSessionFilter] = useState<string>(state.logPageFilter.sessionId ?? '');
  const [keywordFilter, setKeywordFilter] = useState<string>('');
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchDraft, setSearchDraft] = useState<string>('');
  const [errorFocus, setErrorFocus] = useState<boolean>(false);
  const errorFocusTouchedRef = useRef(false);

  const [showConversation, setShowConversation] = useState<boolean>(false);

  const [view, setView] = useState<LogsView>(initialView);
  const [timelineMode, setTimelineMode] = useState<TimelineMode>('session');
  const [timelineMetric, setTimelineMetric] = useState<TimelineMetric>('calls');
  const [helpVisible, setHelpVisible] = useState<boolean>(true);

  const [diskSessions, setDiskSessions] = useState<ProjectSessionSummary[]>([]);
  const [diskSessionsLoaded, setDiskSessionsLoaded] = useState<boolean>(false);

  const [selectedSessionIdx, setSelectedSessionIdx] = useState<number>(0);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  const [focusedPane, setFocusedPane] = useState<'left' | 'right'>('left');
  const [selectedCardIdx, setSelectedCardIdx] = useState<number>(0);

  const selRef = useRef<{ idx: number; id: string | null; len: number }>({ idx: 0, id: null, len: 0 });
  const pollKeepRef = useRef(false);
  const revealOnNextSessionsChange = useRef<number | null>(null);

  // 从中央数据根聚合 session 摘要
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const load = (): void => {
      listAllSessions(dataRoot, controller.signal)
        .then((all) => {
          if (cancelled) return;
          const curPid = currentProjectId;
          const sessions = [...all].sort((a, b) => {
            const aCur = curPid !== null && a.projectId === curPid ? 0 : 1;
            const bCur = curPid !== null && b.projectId === curPid ? 0 : 1;
            if (aCur !== bCur) return aCur - bCur;
            return b.lastTime.localeCompare(a.lastTime);
          });
          if (cancelled) return;
          const cur = selRef.current;
          if (cur.id) {
            const idx = sessions.findIndex((s) => s.sessionId === cur.id);
            if (idx >= 0 && idx !== cur.idx) {
              pollKeepRef.current = true;
              setSelectedSessionIdx(idx);
            } else if (idx >= 0 && sessions.length !== cur.len) {
              pollKeepRef.current = true;
            }
          }
          setDiskSessions(sessions);
          setDiskSessionsLoaded(true);
        })
        .catch((err) => {
          if (!cancelled) {
            setDiskSessionsLoaded(true);
            console.warn('Failed to load sessions:', err.message);
          }
        });
    };
    load();
    const timer = setInterval(() => {
      if (!cancelled) load();
    }, SESSION_LIST_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      controller.abort();
    };
  }, []);

  // 跳转自动聚焦
  useEffect(() => {
    if (errorFocusTouchedRef.current) return;
    const sid = sessionFilter.trim();
    if (!sid || diskSessions.length === 0) return;
    const match = diskSessions.find((s) => s.sessionId === sid);
    if (match?.hasError) {
      errorFocusTouchedRef.current = true;
      setErrorFocus(true);
    }
  }, [diskSessions, sessionFilter]);

  const filteredSessions = useMemo(() => {
    const trimmed = sessionFilter.trim();
    if (!trimmed) return diskSessions;
    return diskSessions.filter((s) => s.sessionId.includes(trimmed));
  }, [diskSessions, sessionFilter]);

  const sessions = filteredSessions;

  const multiProject = useMemo(
    () => new Set(sessions.map((s) => s.projectId)).size > 1,
    [sessions]
  );
  const sessionTag = useCallback(
    (s: ProjectSessionSummary): string =>
      multiProject ? projectTag(s.worktree, s.projectId, currentProjectId) : '',
    [multiProject, currentProjectId]
  );

  const selectedSessionSummary: ProjectSessionSummary | undefined = sessions[selectedSessionIdx];

  const effectiveExportDir =
    exportDirProp ?? join(dataRoot, 'exports', selectedSessionSummary?.projectId ?? 'global');

  const { stdout: logsStdout } = useStdout();
  const terminalRows = logsStdout?.rows ?? 24;
  const terminalCols = logsStdout?.columns ?? 80;

  const helpOnText = getShortcutHelp(view, timelineMode, timelineMetric)
    .map((h) => `${h.keys} ${h.description}`)
    .join(' · ');
  const helpOffText = '[help off] · ? 显示快捷键 · / 搜索 · Esc 返回';
  const helpBodyRows = Math.max(1, wrapRowCount(helpVisible ? helpOnText : helpOffText, Math.max(1, terminalCols - 2)));
  const helpStatusRows = helpVisible
    ? Math.max(1, wrapRowCount('[help on] · ? 隐藏 · / 搜索', Math.max(1, terminalCols - 2)))
    : 0;
  const bottomBarRows = isSearching ? 3 : 2 + helpBodyRows + helpStatusRows;

  const leftColWidth = Math.max(10, Math.floor(terminalCols * 0.4) - 1);
  const rightColWidth = Math.max(10, Math.floor(terminalCols * 0.6) - 1);
  const leftContentWidth = Math.max(8, leftColWidth - 1 - 2);
  const cardContentWidth = Math.max(8, rightColWidth - 4);
  const timelineContentWidth = Math.max(8, rightColWidth - 2);

  const bus = useLogBus();
  const {
    selectedSessionLoading,
    liveBuffer,
    mergedSessionEntries,
    cardKeyByEntry,
    cardKeyOf,
  } = useSessionEntries({
    selectedSessionSummary,
    dataRoot,
    showConversation,
    bus,
  });

  const sessionCards = useMemo(() => {
    const filtered = filterLogEntries(mergedSessionEntries, {
      minLevel,
      keyword: keywordFilter,
      focusErrors: errorFocus,
    });
    return [...filtered].sort((a, b) => {
      const cmp = b.timestamp.localeCompare(a.timestamp);
      if (cmp !== 0) return cmp;
      return (b.seq ?? 0) - (a.seq ?? 0);
    });
  }, [mergedSessionEntries, minLevel, keywordFilter, errorFocus]);

  const { exportStatus, setExportStatus, handleExport } = useLogExport({
    selectedSessionSummary,
    sessionCards,
    effectiveExportDir,
  });

  const chromeRows = 2 + (exportStatus ? 1 : 0) + bottomBarRows;
  const listHeight = Math.max(3, terminalRows - chromeRows - 1 - (selectedSessionLoading ? 2 : 0));

  const sessionScroll = useScroll({
    totalItems: sessions.length,
    itemHeight: SESSION_ROW_HEIGHT,
    height: listHeight,
  });

  const {
    globalSessionEntries,
    globalTimelineLoading,
    globalLoadProgress,
    globalTimelineRecords,
    globalStats,
  } = useGlobalTimelineData({
    timelineMode,
    diskSessions,
    dataRoot,
  });

  const contextWindows = useMemo(() => {
    const windows = new Map<string, ErrorContextWindow | null>();
    if (expandedCards.size === 0) return windows;
    mergedSessionEntries.forEach((entry, idx) => {
      const key = cardKeyByEntry.get(entry);
      if (key !== undefined && expandedCards.has(key) && !windows.has(key)) {
        windows.set(key, getErrorContextWindowAt(mergedSessionEntries, idx, contextRadius));
      }
    });
    return windows;
  }, [mergedSessionEntries, cardKeyByEntry, expandedCards, contextRadius]);

  const errorCount = useMemo(
    () => countErrorEntries(mergedSessionEntries),
    [mergedSessionEntries],
  );

  const timelineRecords = useMemo(() => buildToolTimeline(mergedSessionEntries), [mergedSessionEntries]);

  const rightListHeight = listHeight;
  const timelineListHeight = Math.max(3, rightListHeight - 1);

  const cardScroll = useScroll({
    totalItems: sessionCards.length,
    itemHeight: CARD_HEIGHT,
    height: rightListHeight,
    clampToLastItem: true,
  });

  useEffect(() => {
    setSelectedCardIdx(0);
  }, [minLevel, keywordFilter, errorFocus, selectedSessionIdx, view, timelineMode]);

  const cardWindowStart = Math.max(0, Math.min(cardScroll.offset, Math.max(0, sessionCards.length - 1)));
  const cardWindow = useMemo(() => {
    return sliceCardWindow(sessionCards, cardWindowStart, {
      contentWidth: cardContentWidth,
      budgetRows: rightListHeight,
      isExpanded: (i) => {
        const e = sessionCards[i];
        return e !== undefined && expandedCards.has(cardKeyOf(e));
      },
      contextWindowOf: (i) => {
        const e = sessionCards[i];
        if (!e) return null;
        return contextWindows.get(cardKeyOf(e)) ?? null;
      },
      relativeTimeOf: (i) => relativeTimeStrFor(sessionCards, i),
      isCurrentCard: (i) => i === cardWindowStart,
    });
  }, [sessionCards, cardWindowStart, cardContentWidth, rightListHeight, expandedCards, contextWindows, cardKeyOf]);

  const cardWindowSize = cardWindow.length;

  const timelineScroll = useScroll({
    totalItems: timelineRecords.length,
    itemHeight: TIMELINE_ROW_HEIGHT,
    height: timelineListHeight,
  });

  const globalTimelineScroll = useScroll({
    totalItems: globalTimelineRecords.length,
    itemHeight: TIMELINE_ROW_HEIGHT,
    height: timelineListHeight,
  });
  const globalStatsScroll = useScroll({
    totalItems: globalStats.length,
    itemHeight: 1,
    height: timelineListHeight,
  });

  const resetRightPaneScroll = useCallback((): void => {
    cardScroll.scrollToTop();
    timelineScroll.scrollToTop();
    globalTimelineScroll.scrollToTop();
    globalStatsScroll.scrollToTop();
  }, [cardScroll, timelineScroll, globalTimelineScroll, globalStatsScroll]);

  const moveSelection = useCallback(
    (target: number): void => {
      const clamped = Math.max(0, Math.min(sessions.length - 1, target));
      setSelectedSessionIdx(clamped);
      sessionScroll.setOffset(
        scrollToReveal(sessionScroll.offset, clamped, sessionScroll.maxVisible, sessions.length),
      );
      resetRightPaneScroll();
    },
    [sessions.length, sessionScroll, resetRightPaneScroll],
  );

  useEffect(() => {
    selRef.current = {
      idx: selectedSessionIdx,
      id: sessions[selectedSessionIdx]?.sessionId ?? null,
      len: sessions.length,
    };
  }, [sessions, selectedSessionIdx]);

  useEffect(() => {
    if (sessions.length === 0) {
      setSelectedSessionIdx(0);
      return;
    }
    setSelectedSessionIdx((cur) => Math.min(cur, sessions.length - 1));
    const reveal = revealOnNextSessionsChange.current;
    revealOnNextSessionsChange.current = null;
    const keep = pollKeepRef.current;
    pollKeepRef.current = false;
    if (reveal != null) {
      sessionScroll.setOffset(
        scrollToReveal(sessionScroll.offset, Math.min(reveal, sessions.length - 1), sessionScroll.maxVisible, sessions.length),
      );
      resetRightPaneScroll();
    } else if (!keep) {
      sessionScroll.scrollToTop();
      resetRightPaneScroll();
    }
  }, [sessions.length]);

  const closePage = useCallback((): void => {
    setCurrentPage('session');
    setInputMode(true);
  }, [setCurrentPage, setInputMode]);

  const commitSearchDraft = useCallback(() => {
    const { level, sid, focus, keyword } = parseSearchDraft(searchDraft);
    if (level) setMinLevel(level);

    setSessionFilter(sid);
    const trimmed = sid.trim();
    if (trimmed) {
      const narrowed = diskSessions.filter((s) => s.sessionId.includes(trimmed));
      const exactIdx = narrowed.findIndex((s) => s.sessionId === trimmed);
      const target = exactIdx >= 0 ? exactIdx : 0;
      if (narrowed.length > 0) {
        setSelectedSessionIdx(target);
        sessionScroll.setOffset(
          scrollToReveal(sessionScroll.offset, target, sessionScroll.maxVisible, narrowed.length),
        );
        revealOnNextSessionsChange.current = target;
        resetRightPaneScroll();
      }
    }
    setErrorFocus(focus);
    errorFocusTouchedRef.current = true;
    setKeywordFilter(keyword);
    setIsSearching(false);
  }, [searchDraft, diskSessions, sessionScroll, resetRightPaneScroll]);

  const toggleCardExpand = useCallback((key: string): void => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const clampedSelectedIdx =
    selectedCardIdx < cardScroll.offset || selectedCardIdx >= cardScroll.offset + cardWindowSize
      ? cardScroll.offset
      : selectedCardIdx;

  useLogsKeymap({
    isSearching,
    view,
    timelineMode,
    timelineMetric,
    focusedPane,
    setFocusedPane,
    selectedSessionIdx,
    selectedCardIdx: clampedSelectedIdx,
    setSelectedCardIdx,
    cardWindowSize,
    sessions,
    diskSessions,
    sessionCards,
    globalTimelineRecords,
    minLevel,
    sessionFilter,
    errorFocus,
    keywordFilter,
    setSearchDraft,
    setIsSearching,
    setSelectedSessionIdx,
    setSessionFilter,
    setTimelineMode,
    setView,
    setTimelineMetric,
    setShowConversation,
    setHelpVisible,
    setExportStatus,
    commitSearchDraft,
    closePage,
    moveSelection,
    resetRightPaneScroll,
    toggleCardExpand,
    handleExport,
    cardKeyOf,
    sessionScroll,
    cardScroll,
    timelineScroll,
    globalTimelineScroll,
    globalStatsScroll,
  });

  const activeTab: 'history' | 'timeline' | 'insights' =
    view === 'list' ? 'history' : timelineMode === 'global' ? 'insights' : 'timeline';

  return {
    activeTab,
    view,
    timelineMode,
    timelineMetric,
    terminalRows,
    terminalCols,
    listHeight,
    rightListHeight,
    timelineListHeight,
    leftContentWidth,
    cardContentWidth,
    timelineContentWidth,
    minLevel,
    sessionFilter,
    keywordFilter,
    errorFocus,
    showConversation,
    isSearching,
    searchDraft,
    sessions,
    diskSessionsLoaded,
    selectedSessionIdx,
    selectedSessionSummary,
    selectedSessionLoading,
    sessionScroll,
    sessionTag,
    sessionCards,
    cardWindow,
    cardScroll,
    focusedPane,
    selectedCardIdx,
    errorCount,
    liveBuffer,
    mergedSessionEntries,
    cardKeyOf,
    timelineRecords,
    timelineScroll,
    globalTimelineRecords,
    globalStats,
    globalSessionEntries,
    globalTimelineLoading,
    globalLoadProgress,
    globalTimelineScroll,
    globalStatsScroll,
    helpVisible,
    exportStatus,
  };
}
