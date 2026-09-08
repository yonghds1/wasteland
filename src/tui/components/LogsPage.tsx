import { getCurrentProjectId, resolveDefaultDataDir } from "@config/paths.js";
import {
  listAllSessions,
  type ProjectSessionSummary,
} from "@core/logger/data-store.js";
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
 * - G：将当前过滤后的日志导出为 markdown（保存到中央数据根 exports/<projectId>/，成功显示路径）
 * - X：将当前过滤后的日志导出为 JSON（同上）
 * - /：进入 sessionId 文本输入
 * - Esc：返回 chat page
 */

import type { LogsView, TimelineMode, TimelineMetric, ErrorContextWindow } from './logs-page-utils.js';
import { getShortcutHelp, formatTime, formatTimeShort, levelColor, pad, scopeColor, kindColor, truncate, filterLogEntries, countErrorEntries, scrollToReveal, DEFAULT_CONTEXT_RADIUS, getErrorContextWindowAt, cardKeyFor, transcriptToLogEntries, ctxLevelColor } from './logs-page-utils.js';
export * from './logs-page-utils.js';
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { join } from 'node:path';
import { Box, Text, useStdout } from 'ink';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { t } from '@locales/index.js';
import type { LogEntry, LogLevel } from '@core/logger/index.js';
import {
  loadSessionEntries,
  getCachedSessionEntries,
} from '@core/logger/file-log-loader.js';
import { createSessionIndex } from '@core/session/session-index.js';
import { useAppContext } from '../context/AppContext.js';
import { useLogsKeymap } from '../hooks/useLogsKeymap.js';
import { useLogBus } from './LogBusProvider.js';
import { TimingsBar, parseTimings } from './TimingsBar.js';
import { ScrollableBox, useScroll } from './ScrollableBox.js';
import { sliceCardWindow, truncateToWidth, displayWidth } from './card-window.js';
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

/**
 * 非本项目 session 的行尾标签（纯函数，可单测）。
 *
 * 本项目返回空串（无视觉噪音）；他项目返回 ` [basename]`（截断 12 列，保住单行虚拟化）。
 */
export function projectTag(worktree: string, projectId: string, currentProjectId: string | null): string {
  if (currentProjectId !== null && projectId === currentProjectId) return '';
  const base = worktree.split('/').filter(Boolean).pop() ?? worktree;
  const short = base.length > 12 ? base.slice(0, 11) + '…' : base;
  return ` [${short}]`;
}

/** 卡片标称高度（行数，仅供滚动步长/名义 maxVisible 估算；渲染窗口按行预算精确切割，见 card-window.ts） */
const CARD_HEIGHT = 4;

/** Session 行高度（行数；行经 truncateToWidth 保证恰 1 行） */
const SESSION_ROW_HEIGHT = 1;

/** 搜索框提示串（单例，宽度计算与渲染共用，保证搜索行恒单行） */
const SEARCH_HINT = '  (语法: level:error sid:1a2b keyword)';

/**
 * 相对耗时串（基于后一条日志，即时间上更早的一条；只显示 0.1s 以上、1 小时以内）。
 * 测量（card-window）与渲染共用，保证行预算与实际同源。
 */
function relativeTimeStrFor(cards: LogEntry[], index: number): string {
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
 * 错误上下文定位行：标出错误在调用链中的位置（错误色高亮）。
 * 行预算测量见 card-window.locatorText（逐字对应）。
 */
function ErrorContextLocator({ entry }: { entry: LogEntry }): React.ReactElement {
  return (
    <Box flexDirection="row" paddingLeft={2}>
      <Text color={wastelandTheme.colors.error}>▼ </Text>
      <Text color={wastelandTheme.colors.error}>
        {`${formatTime(entry.timestamp)} | ${entry.level} | ${entry.scope} | ${truncate(entry.message, 64)}`}
      </Text>
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
  exportDir: exportDirProp,
}: {
  initialView?: LogsView;
  /** 错误卡片展开时显示的前后上下文条数（默认前后各 5 条）。 */
  contextRadius?: number;
  /** 导出文件目录（默认跟选中 session 的项目走；测试可注入临时目录）。 */
  exportDir?: string;
} = {}): React.ReactElement {
  const { state, setCurrentPage, setInputMode } = useAppContext();

  // 中央数据根（读聚合唯一入口；单进程 cwd 固定，memo 一次）。
  const dataRoot = useMemo(() => resolveDefaultDataDir({ cwd: process.cwd() }), []);
  const currentProjectId = useMemo(() => getCurrentProjectId(), []);

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

  // 磁盘 session 列表（无限滚动，无分页；中央数据根全项目聚合，本项目置顶）。
  const [diskSessions, setDiskSessions] = useState<ProjectSessionSummary[]>([]);
  const [diskSessionsLoaded, setDiskSessionsLoaded] = useState<boolean>(false);

  // 从中央数据根聚合 session 摘要（只加载摘要，不加载日志条目）。
  // 5s 轮询一次：新 session 出现 / 已有 session 追加日志时自动刷新排序与计数。
  // listAllSessions 底层 listSessions 有文件指纹缓存，无变化时引用稳定，setState 自动 bail out。
  // 排序：本项目优先（保持单项目时的原有顺序），其余按 lastTime 倒序。
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

  // 多项目标签开关：仅当列表含 ≥2 个项目时展示归属标签；
  // 单项目时渲染与旧版逐像素一致（零回归噪音）。
  const multiProject = useMemo(
    () => new Set(sessions.map((s) => s.projectId)).size > 1,
    [sessions]
  );
  const sessionTag = useCallback(
    (s: ProjectSessionSummary): string =>
      multiProject ? projectTag(s.worktree, s.projectId, currentProjectId) : '',
    [multiProject, currentProjectId]
  );

  // 选中的 session index
  const [selectedSessionIdx, setSelectedSessionIdx] = useState<number>(0);
  // 卡片展开状态
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  // 选中 session 的原始日志条目（从磁盘按需加载，不做 level 过滤；
  // level 过滤在 sessionCards memo 内做，时间线聚合用原始条目）
  const [selectedSessionEntries, setSelectedSessionEntries] = useState<LogEntry[]>([]);
  const [selectedSessionLoading, setSelectedSessionLoading] = useState<boolean>(false);

  // 选中的 session 摘要
  const selectedSessionSummary: ProjectSessionSummary | undefined = sessions[selectedSessionIdx];

  // 导出目录：显式注入优先，否则跟选中 session 的项目走（跨项目导出落各自家）。
  const effectiveExportDir =
    exportDirProp ?? join(dataRoot, 'exports', selectedSessionSummary?.projectId ?? 'global');

  // ----- 高度账本（终端总行 − 固定铬），滚动数学与渲染裁剪必须用同一套 maxVisible -----
  // toolbar 2（内容 1 + 底边框 1）+ 导出状态 0/1 + 底部区（搜索 3 / 帮助开 4 / 关 3）。
  // 左右两栏共用同一列表高度（含加载态扣除，保证加载中也不撑屏）。
  const { stdout: logsStdout } = useStdout();
  const terminalRows = logsStdout?.rows ?? 24;
  const terminalCols = logsStdout?.columns ?? 80;
  const bottomBarRows = isSearching ? 3 : helpVisible ? 4 : 3;
  const chromeRows = 2 + (exportStatus ? 1 : 0) + bottomBarRows;
  const listHeight = Math.max(3, terminalRows - chromeRows - 1 - (selectedSessionLoading ? 2 : 0));

  // ----- 列宽账本（yoga 百分比向下取整再减 1 做 guard，宁可少排不许多占） -----
  // 左栏：40% − 右框线 1 − paddingX 2；行首 indent 含在行串里，内容宽即行宽上限。
  // 右栏：60% − 外层 padL 1 − padR/滚动条 1 − 卡片 borderL 1 − 卡片 padL 1。
  // 时间线行：无卡片铬，外层 padL 1 + padR/滚动条 1。
  const leftColWidth = Math.max(10, Math.floor(terminalCols * 0.4) - 1);
  const rightColWidth = Math.max(10, Math.floor(terminalCols * 0.6) - 1);
  const leftContentWidth = Math.max(8, leftColWidth - 1 - 2);
  const cardContentWidth = Math.max(8, rightColWidth - 4);
  const timelineContentWidth = Math.max(8, rightColWidth - 2);

  // 左侧 session 列表滚动（高度与下方渲染盒一致，reveal 数学才对得上；
  // 行经 truncateToWidth 保证恰 1 行，计数切片精确）。
  const sessionScroll = useScroll({
    totalItems: sessions.length,
    itemHeight: SESSION_ROW_HEIGHT,
    height: listHeight,
  });

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

  // 当选中 session 变化时，从其归属项目的中央目录加载日志条目
  useEffect(() => {
    if (!selectedSessionSummary) {
      setSelectedSessionEntries([]);
      return;
    }

    const logDir = join(dataRoot, 'logs', selectedSessionSummary.projectId);
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

  // ----- 右栏高度账本（与左栏共用 listHeight；header 1 + 加载行 0/2 已在上式扣除） -----
  // 右栏 header 1 行；卡片流按行预算精确切片（见 sliceCardWindow），渲染总行恒 ≤ 预算。
  const rightListHeight = listHeight;
  // 时间线视图与卡片流共用右栏槽位；内部自带 1 行表头，列表预算再扣 1。
  const timelineListHeight = Math.max(3, rightListHeight - 1);

  // 右侧卡片滚动（offset 语义 = 起始卡下标；窗口按行预算精确切片，见 cardWindow；
  // clampToLastItem：末卡钳制，标称 maxVisible 会误判行预算窗口的尾部可达性）
  const cardScroll = useScroll({
    totalItems: sessionCards.length,
    itemHeight: CARD_HEIGHT,
    height: rightListHeight,
    clampToLastItem: true,
  });

  // 大 session 虚拟化：只对可见窗口内的卡片创建 React 元素 / 计算 data。
  // 数千条 session 的卡片不预渲染（parseTimings 等耗时计算只对可见卡片执行），
  // 滚动流畅不卡顿。窗口按行预算精确切片（sliceCardWindow），渲染总行恒 ≤ 预算，
  // 页面不撑屏、顶部恒可达；单张超大卡截断可展开区域并打标（见 card-window.ts）。
  // Right pane selected card index
  const [focusedPane, setFocusedPane] = useState<'left' | 'right'>('left');
  const [selectedCardIdx, setSelectedCardIdx] = useState<number>(0);

  // Reset to 0 when filter changes
  useEffect(() => {
    setSelectedCardIdx(0);
  }, [minLevel, keywordFilter, errorFocus, selectedSessionIdx, view, timelineMode]);

  // 卡片窗口：按行预算切片（替代按张数）；offset 越界钳制到末卡。
  // 相对耗时/展开态/上下文与下方渲染共用同一计算（relativeTimeStrFor），测量与渲染同源。
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
  }, [sessionCards, cardWindowStart, cardContentWidth, rightListHeight, expandedCards, contextWindows]);

  // 可见卡数（供 selectedCard 联动与键盘 reveal 数学；取窗口实际张数）。
  const cardWindowSize = cardWindow.length;

  // 时间线滚动（独立于卡片滚动，行高 2；高度与渲染盒一致）
  const timelineScroll = useScroll({
    totalItems: timelineRecords.length,
    itemHeight: TIMELINE_ROW_HEIGHT,
    height: timelineListHeight,
  });

  // 全局时间线滚动（独立于 session 时间线滚动；统计视图行高 1）
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
        scrollToReveal(sessionScroll.offset, clamped, sessionScroll.maxVisible, sessions.length),
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
        scrollToReveal(sessionScroll.offset, Math.min(reveal, sessions.length - 1), sessionScroll.maxVisible, sessions.length),
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
          scrollToReveal(sessionScroll.offset, target, sessionScroll.maxVisible, narrowed.length),
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
          dir: effectiveExportDir,
          sessionId: selectedSessionSummary.sessionId,
          entries: sessionCards,
          format,
        });
        setExportStatus(`✓ 已导出 ${sessionCards.length} 条${format === 'markdown' ? ' markdown' : ' JSON'} → ${filePath}`);
      } catch (err) {
        setExportStatus(`✗ 导出失败: ${(err as Error).message}`);
      }
    },
    [selectedSessionSummary, sessionCards, effectiveExportDir],
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
        {/* 左栏：Session 列表（Ink 语义：borderStyle 存在即默认四边全画，
            只保留右边框线，其余三边必须显式关闭，否则多出上下各 1 行撑开页面） */}
        <Box
          flexDirection="column"
          width="40%"
          borderStyle={wastelandTheme.decorations.borderStyle}
          borderTop={false}
          borderBottom={false}
          borderLeft={false}
          borderRight
          borderColor={wastelandTheme.colors.borderDim}
          paddingX={1}
        >
          {/* header（单行：超出左栏宽截断，保证不换行撑屏） */}
          <Box flexDirection="row" flexShrink={0}>
            <Text color={wastelandTheme.colors.muted}>
              {truncateToWidth(
                `${truncate('time range', 20)} | ${truncate('sessionId', 16)} | ${truncate('cnt', 4)} | summary`,
                leftContentWidth
              )}
            </Text>
          </Box>

          {sessions.length === 0 && (
            <Box marginTop={1}>
              <Text color={wastelandTheme.colors.muted}>
                {diskSessionsLoaded
                  ? '(no sessions — run a session to generate logs)'
                  : '(loading sessions...)'}
              </Text>
            </Box>
          )}

          {/* 使用 ScrollableBox（固定高度 + 按需滚动条；行高恒 1，窗口数学精确） */}
          <ScrollableBox
            offset={sessionScroll.offset}
            onOffsetChange={sessionScroll.setOffset}
            totalItems={sessions.length}
            itemHeight={SESSION_ROW_HEIGHT}
            height={listHeight}
            showScrollbar={false}
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
              // 单行保证：固定段 53 列（indent 2 + time 20 + 分隔 9 + sid 16 + cnt 4 + icon 1 + 空格 1），
              // 消息与项目标签按显示宽度分配剩余列，超出截断（Ink 会换行，单 Text 行必须事先截到宽度内）。
              const tailBudget = Math.max(0, leftContentWidth - 53);
              const fittedMessage = truncateToWidth(session.lastMessage, Math.min(30, tailBudget));
              const fittedTag = truncateToWidth(
                sessionTag(session),
                Math.max(0, tailBudget - displayWidth(fittedMessage))
              );

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
                    {fittedMessage}
                    {fittedTag}
                  </Text>
                </Box>
              );
            })}
          </ScrollableBox>
        </Box>

        {/* 右栏：卡片流（滚动条列从右 padding 借：内容宽恒等于基线，换行逐像素一致） */}
        <Box
          flexDirection="column"
          width="60%"
          paddingLeft={1}
          paddingRight={cardScroll.canScrollUp || cardScroll.canScrollDown ? 0 : 1}
        >
          {/* 右栏 header */}
          <Box flexDirection="row" justifyContent="space-between" flexShrink={0}>
            <Box flexDirection="row">
              <Text color={wastelandTheme.colors.muted}>
                {selectedSessionSummary
                  ? `session: ${selectedSessionSummary.sessionId}${sessionTag(selectedSessionSummary)} (${mergedSessionEntries.length} entries${liveBuffer.length > 0 ? ` +${liveBuffer.length} live` : ''})`
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
                    ? `${cardScroll.offset + 1}-${cardScroll.offset + cardWindow.length} of ${sessionCards.length}`
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
              height={timelineListHeight}
              showScrollbar={timelineScroll.canScrollUp || timelineScroll.canScrollDown}
              contentWidth={timelineContentWidth}
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
                  height={timelineListHeight}
                  showScrollbar={globalTimelineScroll.canScrollUp || globalTimelineScroll.canScrollDown}
                  contentWidth={timelineContentWidth}
                />
              ) : (
                <GlobalStatsTable
                  stats={globalStats}
                  offset={globalStatsScroll.offset}
                  onOffsetChange={globalStatsScroll.setOffset}
                  height={timelineListHeight}
                  showScrollbar={globalStatsScroll.canScrollUp || globalStatsScroll.canScrollDown}
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

          {/* 列表视图：卡片流（行预算虚拟化窗口 + 右侧滚动条；指示器关闭，
              位置计数由右栏 header 的 `x-y of N` 承担，避免指示器行挤占预算） */}
          {!selectedSessionLoading && view === 'list' && sessionCards.length > 0 && (
            <ScrollableBox
              offset={cardScroll.offset}
              onOffsetChange={cardScroll.setOffset}
              totalItems={sessionCards.length}
              itemHeight={CARD_HEIGHT}
              height={rightListHeight}
              showScrollbar={cardScroll.canScrollUp || cardScroll.canScrollDown}
              showIndicators={false}
              windowed
            >
              {cardWindow.map(({ index: idx, plan }, windowIdx) => {
                const entry = sessionCards[idx];
                if (!entry) return null;
                // 当前聚焦卡片：窗口顶部那张（= cardScroll.offset 指向的卡片，
                // Enter 展开/错误跳转都以它为锚点），用 ▶ 标记聚焦位置
                const isCurrentCard = windowIdx === 0;
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

                // 相对耗时（与行预算测量同一计算，见 relativeTimeStrFor）
                const relativeTimeStr = relativeTimeStrFor(sessionCards, idx);

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

                    {/* 卡片消息：行计划已切好（折叠 5 行/more 提示/预算截断），直接渲染 */}
                    <Box flexDirection="row" marginTop={0} paddingLeft={entry.turn !== undefined ? (entry.step === 0 ? 0 : 3) : 0}>
                      <Box flexDirection="column">
                        <HighlightedText text={plan.messageLines.join('\n')} keyword={keywordFilter} />
                        {plan.messageMore && (
                          <Text color={wastelandTheme.colors.muted}>
                            {plan.messageMore}
                          </Text>
                        )}
                      </Box>
                    </Box>

                    {/* Timings 进度条（行计划原子 inclusion） */}
                    {timings && plan.timingsRows > 0 && <TimingsBar timings={timings} />}

                    {/* 错误信息（行计划已换行+切片） */}
                    {plan.errorLines.length > 0 && (
                      <Box flexDirection="row" marginTop={0} paddingLeft={entry.turn !== undefined ? (entry.step === 0 ? 0 : 3) : 0}>
                        <Text color={wastelandTheme.colors.error}>
                          {plan.errorLines.join('\n')}
                        </Text>
                      </Box>
                    )}

                    {/* 展开的 JSON 详情（行计划：头原子 + JSON 切片；JsonHighlighter 接受预切片串） */}
                    {(plan.detailHeaderLines.length > 0 || plan.detailLines.length > 0) && (
                      <Box flexDirection="column" marginTop={1} paddingLeft={entry.turn !== undefined ? (entry.step === 0 ? 0 : 3) : 0}>
                        {plan.detailHeaderLines.length > 0 && (
                          <Text color={wastelandTheme.colors.muted}>
                            {plan.detailHeaderLines.join('\n')}
                          </Text>
                        )}
                        {plan.detailLines.length > 0 && (
                          <Box flexDirection="row">
                            <JsonHighlighter data={plan.detailLines.join('\n')} />
                          </Box>
                        )}
                        {plan.detailMore && (
                          <Text color={wastelandTheme.colors.muted}>
                            {plan.detailMore}
                          </Text>
                        )}
                      </Box>
                    )}

                    {/* 错误上下文：行计划已按 cap 切分条目（计数与测量同源） */}
                    {plan.contextChromeRows > 0 && (
                      <Box flexDirection="column" marginTop={1}>
                        <Text color={wastelandTheme.colors.muted}>
                          {`── context ↑${plan.contextBefore.length} ↓${plan.contextAfter.length} ──`}
                        </Text>
                        {plan.contextBefore.map((ctx, i) => (
                          <ContextLine key={`ctx-before-${i}`} entry={ctx} />
                        ))}
                        <ErrorContextLocator entry={entry} />
                        {plan.contextAfter.map((ctx, i) => (
                          <ContextLine key={`ctx-after-${i}`} entry={ctx} />
                        ))}
                        {plan.contextMore && (
                          <Text color={wastelandTheme.colors.muted}>
                            {plan.contextMore}
                          </Text>
                        )}
                      </Box>
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
          borderLeft={false}
          borderRight={false}
          borderColor={wastelandTheme.colors.borderFocused}
          backgroundColor={wastelandTheme.colors.borderFocused}
          paddingX={1}
          flexDirection="row"
        >
          <Text color={wastelandTheme.colors.text} bold>
            {truncateToWidth(`/search ${searchDraft}_`, terminalCols - 2 - displayWidth(SEARCH_HINT))}
          </Text>
          <Text color={wastelandTheme.colors.muted}>{SEARCH_HINT}</Text>
        </Box>
      ) : (
        <Box
          flexShrink={0}
          borderStyle={wastelandTheme.decorations.borderStyle}
          borderBottom
          borderTop
          borderLeft={false}
          borderRight={false}
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
