import { resolveUserConfigDir } from "@config/paths.js";
import { getLoadedSettings } from "@config/loaded-settings.js";
/**
 * LogsPage - L2 Dedicated Logs Page (双栏 session 维度，磁盘分页)
 *
 * 设计要点：
 * - 左栏：按 sessionId 分组的 Session 列表（从磁盘按需加载摘要）
 * - 右栏：选中 session 的所有日志卡片流（从磁盘按需加载条目）
 * - 使用 ScrollableBox 统一滚动管理
 *
 * 交互：
 * - ↑/↓：切换左侧 session
 * - Tab / Shift+Tab：在当前 filter 下循环下一个/上一个 session（尾部环绕）
 * - N/B：翻页（每页100 session）
 * - Home/End：跳转到右侧日志流最晚/最早位置（cards 最新在上：Home=顶部=最晚，End=底部=最早）
 * - PgUp/PgDown：滚动右侧卡片
 * - Enter：展开/收起卡片详情 (JSON)；错误卡片额外显示其前后 N 条原始日志上下文
 *   （N 可配置，默认前后各 5 条，聚焦/非聚焦模式均生效）
 * - /：Omnibox 综合搜索（level:/sid:/focus:on/关键字；sid: 直接选中跳转）
 * - T：切换对话合并视图（transcript 用户/助手消息按时间插入日志流）
 * - C：复制聚焦卡片到剪贴板
 * - Esc：返回 chat page
 *（注：L/S/E/V/M 单键文档位，实际经 Omnibox 与 Alt+1~3 Tab 承载）
 * - ]/[：在错误条目间上下跳转
 * - V：切换 日志列表 / 工具调用时间线 视图
 * - M：切换时间线聚合模式（当前 session / 全局跨 session）
 * - K：全局模式下切换 调用时序 / 耗时分布（失败聚类）视图
 * - G：将当前过滤后的日志导出为 markdown（保存到 .wasteland/exports/，成功显示路径）
 * - X：将当前过滤后的日志导出为 JSON（同上）
 * - /：进入 sessionId 文本输入
 * - Esc：返回 chat page
 */

import type { LogsView, TimelineMode, TimelineMetric, ErrorContextWindow } from './logs-page-utils.js';
import { getShortcutHelp, formatTime, formatTimeFull, formatTimeShort, levelColor, pad, scopeColor, kindColor, truncate, formatDetail, filterLogEntries, isErrorEntry, countErrorEntries, scrollToReveal, DEFAULT_CONTEXT_RADIUS, getErrorContextWindowAt, cardKeyFor, transcriptToLogEntries, SESSION_VISIBLE_ESTIMATE, ctxLevelColor } from './logs-page-utils.js';
export * from './logs-page-utils.js';
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { join } from 'node:path';
import { Box, Text, useStdout } from 'ink';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { t } from '@locales/index.js';
import type { LogEntry, LogLevel } from '@core/logger/index.js';
import {
  listSessions,
  loadSessionEntries,
  getCachedSessionEntries,
} from '@core/logger/file-log-loader.js';
import { createSessionIndex } from '@core/session/session-index.js';
import type { SessionSummaryOnDisk } from '@core/logger/file-log-loader.js';
import { useAppContext } from '../context/AppContext.js';
import { useLogsKeymap } from '../hooks/useLogsKeymap.js';
import { useLogBus } from './LogBusProvider.js';
import { TimingsBar, parseTimings } from './TimingsBar.js';
import { ScrollableBox, useScroll } from './ScrollableBox.js';
import { ToolTimeline, TIMELINE_ROW_HEIGHT, buildToolTimeline } from './ToolTimeline.js';
import {
  GlobalTimeline,
  GlobalStatsTable,
  buildGlobalTimeline,
  aggregateToolStats,
  type SessionLogGroup,
} from './GlobalTimeline.js';
import {
  exportLogEntries,
  type LogExportFormat,
} from './log-export.js';

// ============================================================
// 常量
// ============================================================

/** 默认加载的 session 数上限（历史分页保留，当前无限滚动未切片）。 */
const DEFAULT_MAX_SESSIONS = 100;
void DEFAULT_MAX_SESSIONS;

/** 全局时间线最多加载的 session 数（取最近修改的 N 个 session）。 */
const GLOBAL_MAX_SESSIONS = 50;

/** session 列表轮询间隔（毫秒）：新开对话自动出现在左栏。 */
const SESSION_LIST_POLL_MS = 5000;

/** 导出文件默认目录（相对项目根）。 */
const DEFAULT_EXPORT_DIR = join(process.cwd(), '.wasteland', 'exports');

/** 卡片高度（行数） */
const CARD_HEIGHT = 4;

/**
 * 卡片渲染窗口的额外行数余量（行）。
 *
 * 大 session 虚拟化：只对可见窗口内的卡片做 map + parseTimings。窗口大小 =
 * 可见行数 + WINDOW_OVERSCAN，多渲染的几行会被 ScrollableBox 的 overflow hidden
 * 裁掉，保证终端高度计算有细微出入时底部不出现空白。
 */
const WINDOW_OVERSCAN = 2;

/** Session 行高度（行数） */
const SESSION_ROW_HEIGHT = 1;


function ContextLine({ entry }: { entry: LogEntry }): React.ReactElement {
  return (
    <Box flexDirection="row" paddingLeft={2}>
      <Text color={wastelandTheme.colors.muted}>│ </Text>
      <Text color={wastelandTheme.colors.muted}>{formatTime(entry.timestamp)}</Text>
      <Text color={wastelandTheme.colors.muted}> | </Text>
      <Text color={ctxLevelColor(entry.level)}>{entry.level}</Text>
      <Text color={wastelandTheme.colors.muted}> | </Text>
      <Text color={wastelandTheme.colors.muted}>{truncate(entry.scope, 12)}</Text>
      <Text color={wastelandTheme.colors.muted}> | </Text>
      <Text color={wastelandTheme.colors.text}>{truncate(entry.message, 64)}</Text>
    </Box>
  );
}

/**
 * 错误上下文展开区块：错误卡片展开时，按 前因 → 错误 → 后果 顺序
 * 显示其前后 N 条原始日志，与错误卡片本体形成视觉区分。
 */
function ErrorContextSection({
  window,
}: {
  window: ErrorContextWindow | null;
}): React.ReactElement | null {
  if (!window) return null;
  const { before, after, error } = window;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={wastelandTheme.colors.muted}>
        {`── context ↑${before.length} ↓${after.length} ──`}
      </Text>
      {before.map((ctx, i) => (
        <ContextLine key={`ctx-before-${i}`} entry={ctx} />
      ))}
      {/* 错误定位行：标出错误在调用链中的位置（错误色高亮） */}
      <Box flexDirection="row" paddingLeft={2}>
        <Text color={wastelandTheme.colors.error}>▼ </Text>
        <Text color={wastelandTheme.colors.error}>
          {`${formatTime(error.timestamp)} | ${error.level} | ${error.scope} | ${truncate(error.message, 64)}`}
        </Text>
      </Box>
      {after.map((ctx, i) => (
        <ContextLine key={`ctx-after-${i}`} entry={ctx} />
      ))}
    </Box>
  );
}

function HighlightedText({ text, keyword }: { text: string; keyword: string }): React.ReactElement {
  if (!keyword.trim()) return <Text color={wastelandTheme.colors.text} wrap="wrap">{text}</Text>;
  
  const tokens = keyword.trim().toLowerCase().split(/\s+/).map(t => {
    if (t.includes(':') && !t.startsWith('http')) {
      const parts = t.split(':');
      return parts.slice(1).join(':'); // everything after key:
    }
    return t;
  }).filter(t => t);

  if (tokens.length === 0) return <Text color={wastelandTheme.colors.text} wrap="wrap">{text}</Text>;

  // Escape special chars for regex
  const escapeRegExp = (string: string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'gi');
  const parts = text.split(regex);

  return (
    <Text color={wastelandTheme.colors.text} wrap="wrap">
      {parts.map((part, i) => {
        const isMatch = tokens.some(t => part.toLowerCase() === t.toLowerCase());
        return isMatch ? (
          <Text key={i} backgroundColor="yellow" color="black">{part}</Text>
        ) : (
          <Text key={i}>{part}</Text>
        );
      })}
    </Text>
  );
}
function JsonHighlighter({ data }: { data: unknown }) {
  const str = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const regex = /("(?:\\[^]|[^\\"])*"\s*:?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g;
  const parts = str.split(regex);
  return (
    <Text>
      {parts.map((p, i) => {
        if (i % 2 === 0) return <Text key={i}>{p}</Text>; // whitespace/punctuation
        let color: string = wastelandTheme.colors.warning; // numbers
        if (p.startsWith('"')) {
          if (p.trim().endsWith(':')) color = wastelandTheme.colors.primary; // keys
          else color = wastelandTheme.colors.success; // strings
        } else if (p === 'true' || p === 'false') {
          color = wastelandTheme.colors.text; // booleans
        } else if (p === 'null') {
          color = wastelandTheme.colors.error;
        }
        return (
          <Text key={i} color={color}>
            {p}
          </Text>
        );
      })}
    </Text>
  );
}

export function LogsPage({
  initialView = 'list',
  contextRadius = DEFAULT_CONTEXT_RADIUS,
  exportDir = DEFAULT_EXPORT_DIR,
}: {
  initialView?: LogsView;
  /** 错误卡片展开时显示的前后上下文条数（默认前后各 5 条）。 */
  contextRadius?: number;
  /** 导出文件目录（默认 .wasteland/exports；测试可注入临时目录）。 */
  exportDir?: string;
} = {}): React.ReactElement {
  const { state, setCurrentPage, setInputMode } = useAppContext();

  // UI-local filter：初始从 AppContext 取；后续 L/S/P/Enter 修改
  const [minLevel, setMinLevel] = useState<LogLevel>(state.logPageFilter.level ?? 'info');
  const [sessionFilter, setSessionFilter] = useState<string>(state.logPageFilter.sessionId ?? '');
  const [keywordFilter, setKeywordFilter] = useState<string>('');
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchDraft, setSearchDraft] = useState<string>('');

  // 错误聚焦模式：只显示 warn/error 条目（与 level / 关键字过滤叠加）
  const [errorFocus, setErrorFocus] = useState<boolean>(false);
  // 用户是否手动动过 errorFocus（Omnibox 提交即视为手动；自动聚焦只生效一次，不跟用户对着干）
  const errorFocusTouchedRef = useRef(false);

  // 对话合并视图：把 transcript 的用户/助手消息按时间插进日志流（T 切换）。
  // 查"为什么 AI 干了 X"时一次看完说了啥 + 系统干了啥。
  const [showConversation, setShowConversation] = useState<boolean>(false);
  const [transcriptEntries, setTranscriptEntries] = useState<LogEntry[]>([]);

  // 最近一次导出结果提示（成功含保存路径，失败含错误原因）；null 表示未导出
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  // 视图：日志列表 / 工具调用时间线（V 切换）
  const [view, setView] = useState<LogsView>(initialView);

  // 时间线聚合模式：当前 session / 全局跨 session（M 切换，仅 timeline 视图生效）
  const [timelineMode, setTimelineMode] = useState<TimelineMode>('session');
  // 全局时间线子视图：调用时序 / 耗时分布（K 切换，仅 global 模式生效）
  const [timelineMetric, setTimelineMetric] = useState<TimelineMetric>('calls');

  // 底部快捷键提示条：? 键 toggle 显示/隐藏（默认显示，首次进入即给出按键说明）
  const [helpVisible, setHelpVisible] = useState<boolean>(true);

  // 磁盘 session 列表（无限滚动，无分页）
  const [diskSessions, setDiskSessions] = useState<SessionSummaryOnDisk[]>([]);
  const [diskSessionsLoaded, setDiskSessionsLoaded] = useState<boolean>(false);

  // 从磁盘加载 session 列表（只加载摘要，不加载日志条目）。
  // 5s 轮询一次：新 session 出现 / 已有 session 追加日志时自动刷新排序与计数。
  // listSessions 内部有文件指纹缓存，无变化时返回同一数组引用，setState 自动 bail out，不触发重渲染。
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const logDir = getLoadedSettings()?.projectConfigDir ?? resolveUserConfigDir();
    const load = (): void => {
      listSessions({ dir: logDir, signal: controller.signal })
        .then((sessions) => {
          if (cancelled) return;
          // 选中跟随：头部插入导致选中 session 下移时，按 id 找回并修正索引，
          // 同时标记 keep，抑制 [sessions.length] effect 的回顶（用户正在看别处）。
          const cur = selRef.current;
          if (cur.id) {
            const idx = sessions.findIndex((s) => s.sessionId === cur.id);
            if (idx >= 0 && idx !== cur.idx) {
              pollKeepRef.current = true;
              setSelectedSessionIdx(idx);
            } else if (idx >= 0 && sessions.length !== cur.len) {
              // 长度变了但选中位置未动（如尾部追加）：同样抑制回顶
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

  // 跳转自动聚焦：带 sid 过滤落地（/logs show <sid>）且该 session 有错误时，
  // 自动打开错误聚焦（用户手动关掉后不再自动开）。
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

  // 按 sessionId 过滤
  const filteredSessions = useMemo(() => {
    const trimmed = sessionFilter.trim();
    if (!trimmed) return diskSessions;
    return diskSessions.filter((s) => s.sessionId.includes(trimmed));
  }, [diskSessions, sessionFilter]);

  // Session 列表：无限滚动（ScrollableBox 虚拟化）
  const sessions = filteredSessions;

  // 选中的 session index
  const [selectedSessionIdx, setSelectedSessionIdx] = useState<number>(0);
  // 卡片展开状态
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  // 左侧 session 列表滚动
  const sessionScroll = useScroll({
    totalItems: sessions.length,
    itemHeight: SESSION_ROW_HEIGHT,
  });

  // 选中的 session 摘要
  const selectedSessionSummary: SessionSummaryOnDisk | undefined = sessions[selectedSessionIdx];

  // 选中 session 的原始日志条目（从磁盘按需加载，不做 level 过滤；
  // level 过滤在 sessionCards memo 内做，时间线聚合用原始条目）
  const [selectedSessionEntries, setSelectedSessionEntries] = useState<LogEntry[]>([]);
  const [selectedSessionLoading, setSelectedSessionLoading] = useState<boolean>(false);

  // Live tail：订阅 LogBus 实时流，对当前选中 session 做增量合并（解决 /logs 非实时痛点）
  const bus = useLogBus();
  const [liveBuffer, setLiveBuffer] = useState<LogEntry[]>([]);
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
  // 切换 session 时清空 live 缓冲，避免跨 session 串台
  useEffect(() => {
    setLiveBuffer([]);
  }, [selectedSessionSummary?.sessionId]);

  // 合并磁盘条目 + Live 缓冲 + 对话 transcript。
  // 去重：seq 优先（全局唯一）；无 seq 的回退键加同键出现序号，
  // 避免同毫秒 identical 重试消息被误杀（旧 key 会吞掉第二条）。
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
    // transcript 行无 seq：与 base 互不干扰（message 带 [user]/[assistant] 前缀），直接合并排序
    const withConversation = showConversation ? [...base, ...transcriptEntries] : base;
    return withConversation.sort((a, b) => {
      const cmp = a.timestamp.localeCompare(b.timestamp);
      if (cmp !== 0) return cmp;
      return (a.seq ?? 0) - (b.seq ?? 0);
    });
  }, [selectedSessionEntries, liveBuffer, showConversation, transcriptEntries]);

  // 卡片稳定键：seq 优先（全局唯一），无 seq 按同毫秒出现序号兜底。
  // 解决同毫秒多条共用 timestamp 键导致的展开串台 + React key 冲突。
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

  // 全局时间线：跨 session 聚合数据（进入 global 模式时按需加载最近的 N 个 session）
  const [globalSessionEntries, setGlobalSessionEntries] = useState<SessionLogGroup[]>([]);
  const [globalTimelineLoading, setGlobalTimelineLoading] = useState<boolean>(false);

  // 当选中 session 变化时，从磁盘加载其日志条目
  useEffect(() => {
    if (!selectedSessionSummary) {
      setSelectedSessionEntries([]);
      return;
    }

    const logDir = getLoadedSettings()?.projectConfigDir ?? resolveUserConfigDir();
    const sessionId = selectedSessionSummary.sessionId;

    // 缓存命中：同步渲染缓存条目（避免 loading 闪烁），但不早退——
    // 仍走 loadSessionEntries 后台校验（其内部指纹缓存使真命中读盘开销仅一次 stat）。
    // 文件在缓存后发生写入（live session 持续追加日志）时会刷新出新条目，
    // 避免 fast path 永远展示冻结的旧快照。
    const cached = getCachedSessionEntries(logDir, sessionId);
    if (cached) {
      setSelectedSessionEntries(cached);
      setSelectedSessionLoading(false);
    }

    let cancelled = false;
    const controller = new AbortController();

    // 缓存未命中才显示 loading；命中时已有条目可显示，保持 loading 关闭
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
          // 存原始条目（不过滤），level 过滤交给 sessionCards memo
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

  // 对话 transcript：选中 session 变化时加载其用户/助手消息（仅 showConversation 开启时；
  // 关闭时清空，避免无效 IO；transcript 缺失/失败静默为空，不挡日志流）
  useEffect(() => {
    if (!showConversation || !selectedSessionSummary) {
      setTranscriptEntries([]);
      return;
    }
    let cancelled = false;
    const logDir = getLoadedSettings()?.projectConfigDir ?? resolveUserConfigDir();
    createSessionIndex(join(logDir, 'sessions'))
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

  // 全局时间线数据：进入 global 模式时，复用磁盘 session 摘要（diskSessions），
  // 为最近的 GLOBAL_MAX_SESSIONS 个 session 逐个加载日志条目。
  // 任一 session 加载失败则跳过（不影响其他 session）。
  // 渐进式渲染：每完成一个 session 即追加显示，顶部显示 x/N 进度，
  // 避免 50 个全量读完之前一直转圈。
  const [globalLoadProgress, setGlobalLoadProgress] = useState<{ done: number; total: number } | null>(null);
  useEffect(() => {
    if (timelineMode !== 'global') {
      setGlobalSessionEntries([]);
      setGlobalLoadProgress(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const logDir = getLoadedSettings()?.projectConfigDir ?? resolveUserConfigDir();
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
              dir: logDir,
              sessionId: s.sessionId,
              signal: controller.signal,
            });
            if (cancelled) return;
            done += 1;
            setGlobalLoadProgress({ done, total: summaries.length });
            setGlobalSessionEntries((prev) => [...prev, { sessionId: s.sessionId, entries }]);
          } catch {
            // 单个 session 加载失败：跳过并计入进度
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
  }, [timelineMode, diskSessions]);

  // 展开卡片的错误上下文窗口（按卡片稳定键定位下标，同毫秒多条精确定位；
  // 即使错误被 level/关键字过滤隐藏，上下文仍来自原始日志流）
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

  // 右侧卡片：按 level + 关键字 + 错误聚焦过滤后，最新在上
  // （关键字搜索、level 过滤与错误聚焦三者叠加；时间线聚合仍用原始条目，见 timelineRecords）
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

  // 当前 session 的 warn/error 计数（基于合并条目，含 Live 实时）
  const errorCount = useMemo(
    () => countErrorEntries(mergedSessionEntries),
    [mergedSessionEntries],
  );

  // 工具调用时间线：从当前 session 的日志条目聚合（按时间序，含 Live）
  const timelineRecords = useMemo(() => buildToolTimeline(mergedSessionEntries), [mergedSessionEntries]);

  // 全局时间线：跨 session 聚合记录（按时间序）+ 按 toolName 统计（失败聚类 / 耗时分布）
  const globalTimelineRecords = useMemo(
    () => buildGlobalTimeline(globalSessionEntries),
    [globalSessionEntries],
  );
  const globalStats = useMemo(
    () => aggregateToolStats(globalTimelineRecords),
    [globalTimelineRecords],
  );

  // 右侧卡片滚动
  const cardScroll = useScroll({
    totalItems: sessionCards.length,
    itemHeight: CARD_HEIGHT,
  });

  // 大 session 虚拟化：只对可见窗口内的卡片创建 React 元素 / 计算 data。
  // 数千条 session 的卡片不预渲染（parseTimings 等耗时计算只对可见卡片执行），
  // 滚动流畅不卡顿。窗口由 ScrollableBox 的 maxVisible 计算 + 少量余量构成，
  // 窗口外的行由 ScrollableBox overflow:hidden 裁掉。
  // Right pane selected card index
  const [focusedPane, setFocusedPane] = useState<'left' | 'right'>('left');
  const [selectedCardIdx, setSelectedCardIdx] = useState<number>(0);

  // Reset to 0 when filter changes
  useEffect(() => {
    setSelectedCardIdx(0);
  }, [minLevel, keywordFilter, errorFocus, selectedSessionIdx, view, timelineMode]);

  const { stdout: logsStdout } = useStdout();
  const cardWindowSize = Math.max(
    1,
    Math.floor((logsStdout?.rows ?? 24) / CARD_HEIGHT) + WINDOW_OVERSCAN,
  );
  const cardWindow = useMemo(() => {
    const start = cardScroll.offset;
    return sessionCards.slice(start, start + cardWindowSize);
  }, [sessionCards, cardScroll.offset, cardWindowSize]);

  // 时间线滚动（独立于卡片滚动，行高 2）
  const timelineScroll = useScroll({
    totalItems: timelineRecords.length,
    itemHeight: TIMELINE_ROW_HEIGHT,
  });

  // 全局时间线滚动（独立于 session 时间线滚动；统计视图行高 1）
  const globalTimelineScroll = useScroll({
    totalItems: globalTimelineRecords.length,
    itemHeight: TIMELINE_ROW_HEIGHT,
  });
  const globalStatsScroll = useScroll({
    totalItems: globalStats.length,
    itemHeight: 1,
  });

  // 滚动联动：切换 session / 视图后，右侧日志流回到顶部（保持一致的查看起点）。
  // 覆盖列表卡片流与两种时间线视图，避免切换后右栏停在旧 session 的滚动位置。
  const resetRightPaneScroll = useCallback((): void => {
    cardScroll.scrollToTop();
    timelineScroll.scrollToTop();
    globalTimelineScroll.scrollToTop();
    globalStatsScroll.scrollToTop();
  }, [cardScroll, timelineScroll, globalTimelineScroll, globalStatsScroll]);

  /**
   * 移动选中 session（clamp 到有效范围），并协调左右栏滚动：
   * - 左栏：scrollToReveal 保证选中行进入可见窗口（已在窗口内则不扰动）
   * - 右栏：resetRightPaneScroll 回到顶部
   */
  const moveSelection = useCallback(
    (target: number): void => {
      const clamped = Math.max(0, Math.min(sessions.length - 1, target));
      setSelectedSessionIdx(clamped);
      sessionScroll.setOffset(
        scrollToReveal(sessionScroll.offset, clamped, SESSION_VISIBLE_ESTIMATE, sessions.length),
      );
      resetRightPaneScroll();
    },
    [sessions.length, sessionScroll, resetRightPaneScroll],
  );

  // 选中状态跟随：轮询导致列表头部插入时，按 sessionId 找回选中项，
  // 避免 selectedSessionIdx 错位到另一个 session；同时抑制滚动回顶。
  // Omnibox sid 跳转经 revealOnNextSessionsChange 交接：列表长度变化导致下述 effect
  // 触发时，优先揭示目标行而非回顶部（避免覆盖 commitSearchDraft 的 reveal）。
  const selRef = useRef<{ idx: number; id: string | null; len: number }>({ idx: 0, id: null, len: 0 });
  const pollKeepRef = useRef(false);
  const revealOnNextSessionsChange = useRef<number | null>(null);
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
        scrollToReveal(sessionScroll.offset, Math.min(reveal, sessions.length - 1), SESSION_VISIBLE_ESTIMATE, sessions.length),
      );
      resetRightPaneScroll();
    } else if (!keep) {
      sessionScroll.scrollToTop();
      resetRightPaneScroll();
    }
  }, [sessions.length]);

  // 关闭 page 时回到 chat
  const closePage = useCallback((): void => {
    setCurrentPage('session');
    setInputMode(true);
  }, [setCurrentPage, setInputMode]);

  // 提交综合搜索 (Omnibox)
  // - level: 仅显式指定 level: 时才改档，不指定保持当前（不回退 info）
  // - sid: 按子串收窄左栏后，精确匹配直接选中跳转（与 Enter 全局定位同规则）
  const commitSearchDraft = useCallback(() => {
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
          scrollToReveal(sessionScroll.offset, target, SESSION_VISIBLE_ESTIMATE, narrowed.length),
        );
        // 若过滤改变了列表长度，[sessions.length] effect 会回顶部；
        // 用 ref 交接目标行，effect 内优先揭示（见上）。
        revealOnNextSessionsChange.current = target;
        resetRightPaneScroll();
      }
    }
    setErrorFocus(focus);
    errorFocusTouchedRef.current = true;
    setKeywordFilter(kwParts.join(' '));
    setIsSearching(false);
  }, [searchDraft, diskSessions, sessionScroll, resetRightPaneScroll]);

  // 切换卡片展开状态（按卡片稳定键，见 cardKeyByEntry）
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

  // 导出当前选中 session 的过滤后日志（G=markdown / X=JSON）
  const handleExport = useCallback(
    async (format: LogExportFormat): Promise<void> => {
      if (!selectedSessionSummary) {
        setExportStatus('✗ 导出失败: 未选中 session');
        return;
      }
      if (sessionCards.length === 0) {
        setExportStatus('✗ 导出失败: 当前过滤下没有日志');
        return;
      }
      try {
        const filePath = await exportLogEntries({
          dir: exportDir,
          sessionId: selectedSessionSummary.sessionId,
          entries: sessionCards,
          format,
        });
        setExportStatus(`✓ 已导出 ${sessionCards.length} 条${format === 'markdown' ? ' markdown' : ' JSON'} → ${filePath}`);
      } catch (err) {
        setExportStatus(`✗ 导出失败: ${(err as Error).message}`);
      }
    },
    [selectedSessionSummary, sessionCards, exportDir],
  );

  const clampedSelectedIdx = (selectedCardIdx < cardScroll.offset || selectedCardIdx >= cardScroll.offset + cardWindowSize) ? cardScroll.offset : selectedCardIdx;

  // 本页键盘交互（实现见 useLogsKeymap，入参即本地同名状态/回调）
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

  // 派生 Tab（显式化 V/M/K）
  const activeTab: 'history' | 'timeline' | 'insights' =
    view === 'list' ? 'history' : timelineMode === 'global' ? 'insights' : 'timeline';

  // ----- 渲染 -----

  return (
    <Box flexDirection="column" width="100%" height="100%">
      {/* 顶部工具栏（对齐主 AgentTabs 样式 + 右侧精简 Tags） */}
      <Box
        flexDirection="row"
        flexShrink={0}
        paddingX={1}
        borderStyle="single"
        borderTop={false}
        borderLeft={false}
        borderRight={false}
        borderBottomColor={wastelandTheme.colors.borderFocused}
        justifyContent="space-between"
      >
        <Box flexDirection="row">
          <Text color={wastelandTheme.colors.primary} bold>
            {wastelandTheme.displayName}
          </Text>
          <Text color={wastelandTheme.colors.muted}>
            {' · '}
            Logs
          </Text>

          <Box flexDirection="row" marginLeft={2}>
            <Box marginRight={1}>
              <Text color={activeTab === 'history' ? wastelandTheme.colors.primary : wastelandTheme.colors.text} bold={activeTab === 'history'}>
                {activeTab === 'history' ? '▶ ' : ''}[历史日志{view === 'list' ? `·${sessionCards.length}` : ''}]
              </Text>
            </Box>
            <Box marginRight={1}>
              <Text color={activeTab === 'timeline' ? wastelandTheme.colors.primary : wastelandTheme.colors.text} bold={activeTab === 'timeline'}>
                {activeTab === 'timeline' ? '▶ ' : ''}[调用时序{view === 'timeline' && timelineMode === 'session' ? `·${timelineRecords.length}` : ''}]
              </Text>
            </Box>
            <Box marginRight={1}>
              <Text color={activeTab === 'insights' ? wastelandTheme.colors.primary : wastelandTheme.colors.text} bold={activeTab === 'insights'}>
                {activeTab === 'insights' ? '▶ ' : ''}[全局分析{activeTab === 'insights' ? `·${globalStats.length}` : ''}]
              </Text>
            </Box>
            <Text color={wastelandTheme.colors.muted} dimColor>
              (Alt+1~3 切换)
            </Text>
          </Box>
        </Box>

        {/* 右侧：过滤状态 Tags (按需显示) */}
        <Box flexDirection="row" gap={1}>
          {minLevel !== 'info' && <Text color={wastelandTheme.colors.warning}>[L:{minLevel}]</Text>}
          {sessionFilter && <Text color={wastelandTheme.colors.primary}>[S:{sessionFilter}]</Text>}
          {errorFocus && <Text color={wastelandTheme.colors.error} bold>[🛑 ErrorOnly]</Text>}
          {keywordFilter && <Text color={wastelandTheme.colors.success}>[🔍 {keywordFilter}]</Text>}
          {showConversation && <Text color={wastelandTheme.colors.secondary}>[{t('tui.conversationBadge')}]</Text>}
        </Box>
      </Box>

      {/* 导出状态行：最近一次导出的结果（成功含保存路径） */}
      {exportStatus && (
        <Box flexShrink={0} paddingX={1}>
          <Text
            color={
              exportStatus.startsWith('✓')
                ? wastelandTheme.colors.success
                : wastelandTheme.colors.error
            }
          >
            {exportStatus}
          </Text>
        </Box>
      )}

      {/* 主体：左 session 列表 + 右 卡片流 */}
      <Box flexGrow={1} flexDirection="row" width="100%">
        {/* 左栏：Session 列表 */}
        <Box
          flexDirection="column"
          width="40%"
          borderStyle={wastelandTheme.decorations.borderStyle}
          borderRight
          borderColor={wastelandTheme.colors.borderDim}
          paddingX={1}
        >
          {/* header */}
          <Box flexDirection="row" flexShrink={0}>
            <Text color={wastelandTheme.colors.muted}>
              {truncate('time range', 20)}
              {' | '}
              {truncate('sessionId', 16)}
              {' | '}
              {truncate('cnt', 4)}
              {' | '}
              summary
            </Text>
          </Box>

          {sessions.length === 0 && (
            <Box marginTop={1}>
              <Text color={wastelandTheme.colors.muted}>
                {diskSessionsLoaded
                  ? '(no sessions — run a session to generate logs, logs saved to .wasteland/logs/sessions/)'
                  : '(loading sessions...)'}
              </Text>
            </Box>
          )}

          {/* 使用 ScrollableBox */}
          <ScrollableBox
            offset={sessionScroll.offset}
            onOffsetChange={sessionScroll.setOffset}
            totalItems={sessions.length}
            itemHeight={SESSION_ROW_HEIGHT}
          >
            {sessions.map((session, idx) => {
              const isSelected = idx === selectedSessionIdx;
              // 选中行：高亮背景带 + 最亮文本色 + bold + > 前缀（聚焦位置清晰可辨）
              const lineColor = isSelected
                ? wastelandTheme.colors.textEmphasized
                : wastelandTheme.colors.text;
              const lineBg = isSelected
                ? wastelandTheme.colors.backgroundSecondary
                : undefined;
              const indent = isSelected ? '> ' : '  ';
              const timeRange = `${formatTimeShort(session.firstTime)}-${formatTimeShort(session.lastTime)}`;
              const statusIcon = session.hasError ? '✗' : '✓';
              const statusColor = session.hasError
                ? wastelandTheme.colors.error
                : wastelandTheme.colors.success;

              return (
                <Box key={session.sessionId} flexDirection="row">
                  <Text color={lineColor} backgroundColor={lineBg} bold={isSelected}>
                    {indent}
                    {truncate(timeRange, 20)}
                    {' | '}
                    {truncate(session.sessionId, 16)}
                    {' | '}
                    {String(session.count).padStart(4)}
                    {' | '}
                    <Text color={statusColor}>{statusIcon}</Text>
                    {' '}
                    {truncate(session.lastMessage, 30)}
                  </Text>
                </Box>
              );
            })}
          </ScrollableBox>
        </Box>

        {/* 右栏：卡片流 */}
        <Box flexDirection="column" width="60%" paddingX={1}>
          {/* 右栏 header */}
          <Box flexDirection="row" justifyContent="space-between" flexShrink={0}>
            <Box flexDirection="row">
              <Text color={wastelandTheme.colors.muted}>
                {selectedSessionSummary
                  ? `session: ${selectedSessionSummary.sessionId} (${mergedSessionEntries.length} entries${liveBuffer.length > 0 ? ` +${liveBuffer.length} live` : ''})`
                  : 'session: (none selected)'}
              </Text>
              {selectedSessionSummary && (
                <Text color={errorCount > 0 ? wastelandTheme.colors.error : wastelandTheme.colors.success}>
                  {' '}[errors={errorCount}]
                </Text>
              )}
              {liveBuffer.length > 0 && (
                <Text color={wastelandTheme.colors.success}> ●Live</Text>
              )}
            </Box>
            <Text color={wastelandTheme.colors.muted}>
              {view === 'timeline' && timelineMode === 'global'
                ? timelineMetric === 'calls'
                  ? `${globalTimelineRecords.length} tool calls (${globalSessionEntries.length} sessions)`
                  : `${globalStats.length} tools`
                : view === 'timeline'
                  ? `${timelineRecords.length} tool calls`
                  : sessionCards.length > 0
                    ? `${cardScroll.offset + 1}-${Math.min(cardScroll.offset + 5, sessionCards.length)} of ${sessionCards.length}`
                    : selectedSessionLoading ? 'loading...' : '0 of 0'}
            </Text>
          </Box>

          {/* 加载中 */}
          {selectedSessionLoading && (
            <Box marginTop={1}>
              <Text color={wastelandTheme.colors.muted}>
                {`Loading session entries... (${selectedSessionSummary?.count ?? 0} ${
                  selectedSessionSummary?.count === 1 ? 'entry' : 'entries'
                })`}
              </Text>
            </Box>
          )}

          {/* 时间线视图：工具调用（当前 session） */}
          {!selectedSessionLoading && view === 'timeline' && timelineMode === 'session' && (
            <ToolTimeline
              records={timelineRecords}
              offset={timelineScroll.offset}
              onOffsetChange={timelineScroll.setOffset}
            />
          )}

          {/* 时间线视图：全局跨 session（calls=调用时序 / stats=耗时分布与失败聚类） */}
          {/* 渐进式：entries 边到边渲染，顶部显示加载进度 */}
          {view === 'timeline' && timelineMode === 'global' && (
            <>
              {globalTimelineLoading && (
                <Box marginTop={1}>
                  <Text color={wastelandTheme.colors.muted}>
                    {globalLoadProgress
                      ? t('tui.globalTimelineLoading', { done: String(globalLoadProgress.done), total: String(globalLoadProgress.total) })
                      : t('tui.globalTimelineLoading', { done: '0', total: '…' })}
                  </Text>
                </Box>
              )}
              {timelineMetric === 'calls' ? (
                <GlobalTimeline
                  records={globalTimelineRecords}
                  offset={globalTimelineScroll.offset}
                  onOffsetChange={globalTimelineScroll.setOffset}
                  highlightSessionId={sessionFilter.trim() || undefined}
                />
              ) : (
                <GlobalStatsTable
                  stats={globalStats}
                  offset={globalStatsScroll.offset}
                  onOffsetChange={globalStatsScroll.setOffset}
                />
              )}
            </>
          )}

          {/* 列表视图：空态 */}
          {!selectedSessionLoading && view === 'list' && sessionCards.length === 0 && (
            <Box marginTop={1}>
              <Text color={wastelandTheme.colors.muted}>
                {selectedSessionSummary
                  ? errorFocus
                    ? keywordFilter.trim()
                      ? '(no errors match keyword)'
                      : '(no errors in this session)'
                    : keywordFilter.trim()
                      ? '(no entries match keyword)'
                      : '(no entries match current filter)'
                  : '(select a session from the left)'}
              </Text>
            </Box>
          )}

          {/* 列表视图：卡片流（使用 ScrollableBox；windowed 预切片，只渲染可见窗口） */}
          {!selectedSessionLoading && view === 'list' && sessionCards.length > 0 && (
            <ScrollableBox
              offset={cardScroll.offset}
              onOffsetChange={cardScroll.setOffset}
              totalItems={sessionCards.length}
              itemHeight={CARD_HEIGHT}
              windowed
            >
              {cardWindow.map((entry, windowIdx) => {
                const isExpanded = expandedCards.has(cardKeyOf(entry));
                // 当前聚焦卡片：窗口顶部那张（= cardScroll.offset 指向的卡片，
                // Enter 展开/错误跳转都以它为锚点），用 ▶ 标记聚焦位置
                const isCurrentCard = windowIdx === 0;
                const idx = cardScroll.offset + windowIdx;
                const isSelectedCard = idx === selectedCardIdx;
                const entryKind = (entry.data as Record<string, unknown> | undefined)?.kind;
                const kindStr = typeof entryKind === 'string' ? entryKind : '-';
                const timings = parseTimings(entry.data);

                // 卡片边框颜色
                let cardBorderColor: string = wastelandTheme.colors.borderDim;
                if (entry.level === 'error') {
                  cardBorderColor = wastelandTheme.colors.error;
                } else if (entry.level === 'warn') {
                  cardBorderColor = wastelandTheme.colors.warning;
                }

                // 相对耗时计算（基于前一条日志，即时间上更早的一条）
                const nextOlderEntry = sessionCards[cardScroll.offset + windowIdx + 1];
                let relativeTimeStr = '';
                if (nextOlderEntry) {
                  const t1 = new Date(nextOlderEntry.timestamp).getTime();
                  const t2 = new Date(entry.timestamp).getTime();
                  const diff = (t2 - t1) / 1000;
                  if (diff >= 0.1 && diff < 3600) { // 只显示 0.1s 以上，1小时以内的差异
                    relativeTimeStr = `<+${diff.toFixed(1)}s>`;
                  }
                }

                return (
                  <Box
                    key={cardKeyOf(entry)}
                    flexDirection="column"
                    backgroundColor={isSelectedCard ? '#2b2d31' : undefined}
                    borderStyle={wastelandTheme.decorations.borderStyle}
                    borderLeft
                    borderBottom
                    borderColor={cardBorderColor}
                    paddingLeft={1}
                    marginBottom={1}
                  >
                    {/* 卡片头部：聚焦指示 + 紧凑时间 + 着色 level + scope + kind（level/scope 固定宽度对齐） */}
                    <Box flexDirection="row">
                      <Text
                        color={
                          isCurrentCard
                            ? wastelandTheme.colors.borderFocused
                            : wastelandTheme.colors.muted
                        }
                      >
                        {isCurrentCard ? '▶ ' : '  '}
                      </Text>
                      {entry.turn !== undefined && (
                        <Text color={wastelandTheme.colors.borderDim}>
                          {entry.step === 0 ? `▼ T${entry.turn} ` : (entry.step ? ` ├─ ` : ` │ `)}
                        </Text>
                      )}
                      <Text color={wastelandTheme.colors.muted}>
                        {formatTime(entry.timestamp)}
                        {relativeTimeStr ? ` ${relativeTimeStr}` : ''}
                      </Text>
                      <Text color={wastelandTheme.colors.muted}> | </Text>
                      <Text color={levelColor(entry.level)} bold>
                        {entry.level.padEnd(5)}
                      </Text>
                      <Text color={wastelandTheme.colors.muted}> | </Text>
                      <Text color={scopeColor(entry.scope)}>{pad(entry.scope, 10)}</Text>
                      <Text color={wastelandTheme.colors.muted}> | </Text>
                      <Text color={kindColor(kindStr)}>{kindStr}</Text>
                    </Box>

                    {/* 卡片消息：智能截断 */}
                    <Box flexDirection="row" marginTop={0} paddingLeft={entry.turn !== undefined ? (entry.step === 0 ? 0 : 3) : 0}>
                      {(() => {
                        const lines = entry.message.split('\n');
                        const isLong = lines.length > 5;
                        const displayMsg = (!isExpanded && isLong) ? lines.slice(0, 5).join('\n') : entry.message;
                        return (
                          <Box flexDirection="column">
                            <HighlightedText text={displayMsg} keyword={keywordFilter} />
                            {!isExpanded && isLong && (
                              <Text color={wastelandTheme.colors.muted}>
                                ... ({lines.length - 5} more lines, press Enter to expand)
                              </Text>
                            )}
                          </Box>
                        );
                      })()}
                    </Box>

                    {/* Timings 进度条 */}
                    {timings && <TimingsBar timings={timings} />}

                    {/* 错误信息 */}
                    {entry.error && (
                      <Box flexDirection="row" marginTop={0} paddingLeft={entry.turn !== undefined ? (entry.step === 0 ? 0 : 3) : 0}>
                        <Text color={wastelandTheme.colors.error}>
                          ✗ {entry.error.name}: {entry.error.message}
                        </Text>
                      </Box>
                    )}

                    {/* 展开的 JSON 详情（头部保留完整精度时间戳） */}
                    {isExpanded && (
                      <Box flexDirection="column" marginTop={1} paddingLeft={entry.turn !== undefined ? (entry.step === 0 ? 0 : 3) : 0}>
                        <Text color={wastelandTheme.colors.muted}>
                          {`── detail @ ${formatTimeFull(entry.timestamp)} ──`}
                        </Text>
                        <Box flexDirection="row">
                          <JsonHighlighter data={formatDetail(entry)} />
                        </Box>
                      </Box>
                    )}

                    {/* 错误上下文：展开错误卡片时显示其前后 N 条原始日志
                        （聚焦/非聚焦模式均生效，呈现调用链与前因后果） */}
                      {isExpanded && isErrorEntry(entry) && (
                        <ErrorContextSection
                          window={contextWindows.get(cardKeyOf(entry)) ?? null}
                        />
                      )}
                  </Box>
                );
              })}
            </ScrollableBox>
          )}
        </Box>
      </Box>

      {/* 底部区：Omnibox 搜索框 或 快捷键提示条 */}
      {isSearching ? (
        <Box
          flexShrink={0}
          borderStyle={wastelandTheme.decorations.borderStyle}
          borderBottom
          borderTop
          borderColor={wastelandTheme.colors.borderFocused}
          backgroundColor={wastelandTheme.colors.borderFocused}
          paddingX={1}
          flexDirection="row"
        >
          <Text color={wastelandTheme.colors.text} bold>
            /search {searchDraft}_
          </Text>
          <Text color={wastelandTheme.colors.muted}>  (语法: level:error sid:1a2b keyword)</Text>
        </Box>
      ) : (
        <Box
          flexShrink={0}
          borderStyle={wastelandTheme.decorations.borderStyle}
          borderBottom
          borderTop
          borderColor={wastelandTheme.colors.borderDim}
          paddingX={1}
          flexDirection="column"
        >
          {helpVisible ? (
            <>
              <Text color={wastelandTheme.colors.muted}>
                {getShortcutHelp(view, timelineMode, timelineMetric)
                  .map((h) => `${h.keys} ${h.description}`)
                  .join(' · ')}
              </Text>
              <Text color={wastelandTheme.colors.muted}>
                [help on] · ? 隐藏 · / 搜索
              </Text>
            </>
          ) : (
            <Text color={wastelandTheme.colors.muted}>
              [help off] · ? 显示快捷键 · / 搜索 · Esc 返回
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
