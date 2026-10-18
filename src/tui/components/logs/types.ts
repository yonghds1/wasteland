import type { ProjectSessionSummary } from '@core/logger/data-store.js';
import type { LogEntry, LogLevel } from '@core/logger/index.js';
import type { UseScrollResult } from '../ScrollableBox.js';
import type { CardWindowItem } from '../card-window.js';
import type { buildToolTimeline } from '../ToolTimeline.js';
import type { buildGlobalTimeline, aggregateToolStats, SessionLogGroup } from '../GlobalTimeline.js';
import type { LogsView, TimelineMode, TimelineMetric } from '../logs-page-utils.js';

export const CARD_HEIGHT = 4;
export const SESSION_ROW_HEIGHT = 1;
export const GLOBAL_MAX_SESSIONS = 50;
export const SESSION_LIST_POLL_MS = 5000;
export const SEARCH_HINT = '  (语法: level:error sid:1a2b keyword)';

export function projectTag(worktree: string, projectId: string, currentProjectId: string | null): string {
  if (currentProjectId !== null && projectId === currentProjectId) return '';
  const base = worktree.split('/').filter(Boolean).pop() ?? worktree;
  const short = base.length > 12 ? base.slice(0, 11) + '…' : base;
  return ` [${short}]`;
}

export function relativeTimeStrFor(cards: LogEntry[], index: number): string {
  const entry = cards[index];
  const nextOlderEntry = cards[index + 1];
  if (!entry || !nextOlderEntry) return '';
  const t1 = new Date(nextOlderEntry.timestamp).getTime();
  const t2 = new Date(entry.timestamp).getTime();
  const diff = (t2 - t1) / 1000;
  if (diff >= 0.1 && diff < 3600) {
    return `<+${diff.toFixed(1)}s>`;
  }
  return '';
}

export function parseSearchDraft(searchDraft: string): {
  level?: LogLevel;
  sid: string;
  focus: boolean;
  keyword: string;
} {
  let level: LogLevel | undefined;
  let sid = '';
  let focus = false;
  const kwParts: string[] = [];

  const parts = searchDraft.split(' ').filter(Boolean);
  for (const p of parts) {
    if (p.startsWith('level:')) {
      const l = p.slice(6).toLowerCase();
      if (l === 'debug' || l === 'info' || l === 'warn' || l === 'error') {
        level = l as LogLevel;
      }
    } else if (p.startsWith('sid:')) {
      sid = p.slice(4);
    } else if (p === 'focus:on' || p === 'error') {
      focus = true;
    } else {
      kwParts.push(p);
    }
  }
  return { level, sid, focus, keyword: kwParts.join(' ') };
}

export interface UseLogsPageStateOptions {
  initialView?: LogsView;
  contextRadius?: number;
  exportDir?: string;
}

export interface LogsPageState {
  activeTab: 'history' | 'timeline' | 'insights';
  view: LogsView;
  timelineMode: TimelineMode;
  timelineMetric: TimelineMetric;
  terminalRows: number;
  terminalCols: number;
  listHeight: number;
  rightListHeight: number;
  timelineListHeight: number;
  leftContentWidth: number;
  cardContentWidth: number;
  timelineContentWidth: number;
  minLevel: LogLevel;
  sessionFilter: string;
  keywordFilter: string;
  errorFocus: boolean;
  showConversation: boolean;
  isSearching: boolean;
  searchDraft: string;
  sessions: ProjectSessionSummary[];
  diskSessionsLoaded: boolean;
  selectedSessionIdx: number;
  selectedSessionSummary?: ProjectSessionSummary;
  selectedSessionLoading: boolean;
  sessionScroll: UseScrollResult;
  sessionTag: (s: ProjectSessionSummary) => string;
  sessionCards: LogEntry[];
  cardWindow: CardWindowItem[];
  cardScroll: UseScrollResult;
  focusedPane: 'left' | 'right';
  selectedCardIdx: number;
  errorCount: number;
  liveBuffer: LogEntry[];
  mergedSessionEntries: LogEntry[];
  cardKeyOf: (e: LogEntry) => string;
  timelineRecords: ReturnType<typeof buildToolTimeline>;
  timelineScroll: UseScrollResult;
  globalTimelineRecords: ReturnType<typeof buildGlobalTimeline>;
  globalStats: ReturnType<typeof aggregateToolStats>;
  globalSessionEntries: SessionLogGroup[];
  globalTimelineLoading: boolean;
  globalLoadProgress: { done: number; total: number } | null;
  globalTimelineScroll: UseScrollResult;
  globalStatsScroll: UseScrollResult;
  helpVisible: boolean;
  exportStatus: string | null;
}
