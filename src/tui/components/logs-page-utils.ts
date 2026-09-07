/**
 * logs-page-utils.ts - LogsPage 的纯逻辑与类型
 *
 * 从 LogsPage.tsx 抽取的非 JSX 逻辑：视图/时间线枚举与切换、时间格式化、
 * 日志过滤/关键字匹配、错误聚焦与上下文窗口、滚动联动计算等。
 * 抽离后 LogsPage.tsx 只保留组件与键盘交互，便于单元测试与维护。
 */

import { wastelandTheme } from '@theme/wasteland/index.js';
import {
  LOG_LEVEL_RANK,
  type LogEntry,
  type LogLevel,
  type LogScope,
} from '@core/logger/index.js';
import type { SessionRecord } from '@core/runtime/event-types.js';
import { pad2, parseLocalDate } from './chat-message-utils.js';

/** LogsPage 视图：日志列表 / 工具调用时间线。 */
export type LogsView = 'list' | 'timeline';

/** 切换日志页视图（list ↔ timeline）。 */
export function toggleLogsView(view: LogsView): LogsView {
  return view === 'list' ? 'timeline' : 'list';
}

/** 时间线聚合模式：当前 session / 全局跨 session。 */
export type TimelineMode = 'session' | 'global';

/** 切换时间线聚合模式（session ↔ global）。 */
export function toggleTimelineMode(mode: TimelineMode): TimelineMode {
  return mode === 'session' ? 'global' : 'session';
}

/** 全局时间线子视图：调用时序 / 耗时分布（失败聚类）。 */
export type TimelineMetric = 'calls' | 'stats';

/** 切换全局时间线子视图（calls ↔ stats）。 */
export function toggleTimelineMetric(metric: TimelineMetric): TimelineMetric {
  return metric === 'calls' ? 'stats' : 'calls';
}

/** 快捷键提示条目：按键 + 说明。 */
export type ShortcutHelpItem = {
  /** 按键显示（如 `L`、`]`、`Tab`）。 */
  keys: string;
  /** 该按键在当前视图下的作用说明。 */
  description: string;
};

/**
 * 按当前视图组装底部快捷键提示列表。
 *
 * - 通用（list/timeline 均生效）：session 导航、过滤/聚焦、视图切换、导出、帮助 toggle
 * - timeline + session 模式：追加 M（切换全局时间线）
 * - timeline + global 模式：追加 M（切回当前 session）+ K（切换 调用时序/耗时分布，
 *   description 反映当前指标，说明按 K 会切到哪一个子视图）
 *
 * 纯函数，供组件渲染与测试共用。
 */
export function getShortcutHelp(
  view: LogsView,
  timelineMode: TimelineMode,
  timelineMetric: TimelineMetric,
): ShortcutHelpItem[] {
  const items: ShortcutHelpItem[] = [
    { keys: 'Tab/←→', description: '切换面板' },
    { keys: '↑↓', description: '滚动/切换' },
    { keys: 'N/B', description: 'session翻页' },
    { keys: 'Home/End', description: '跳转最早/最晚' },
    { keys: 'PgUp/PgDown', description: '滚动卡片' },
    { keys: 'Enter', description: '展开/定位' },
    { keys: ']', description: '下一个错误' },
    { keys: '[', description: '上一个错误' },
    { keys: 'G', description: '导出markdown' },
    { keys: 'X', description: '导出JSON' },
    { keys: 'T', description: '显示/隐藏对话' },
  ];
  if (view === 'timeline') {
    if (timelineMode === 'global') {
      items.push(
        {
          keys: 'K',
          description: timelineMetric === 'calls' ? '切换耗时分布' : '切换调用时序',
        },
      );
    }
  }
  items.push(
    { keys: '?', description: '显示/隐藏帮助' },
    { keys: 'Esc', description: '返回' },
  );
  return items;
}

/** ISO 时间戳 → 本地时区 HH:MM:SS（紧凑；非法输入原样返回）。 */
export function formatTime(iso: string): string {
  const d = parseLocalDate(iso);
  if (!d) return iso;
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** ISO 时间戳 → 本地时区 HH:MM:SS.mmm（完整精度，用于展开详情；无毫秒位时回退紧凑格式）。 */
export function formatTimeFull(iso: string): string {
  const d = parseLocalDate(iso);
  if (!d) return formatTime(iso);
  const frac = iso.match(/\.(\d{3})/);
  if (!frac) return formatTime(iso);
  return `${formatTime(iso)}.${frac[1]}`;
}

/** ISO 时间戳 → 本地时区 HH:MM（非法输入原样返回）。 */
export function formatTimeShort(iso: string): string {
  const d = parseLocalDate(iso);
  if (!d) return iso;
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** level → 颜色映射，与主题系统配色一致（error/warn/info/debug 逐级区分）。 */
export function levelColor(level: LogLevel): string {
  switch (level) {
    case 'error':
      return wastelandTheme.colors.error;
    case 'warn':
      return wastelandTheme.colors.warning;
    case 'info':
      return wastelandTheme.colors.info;
    case 'debug':
      return wastelandTheme.colors.muted;
    default:
      return wastelandTheme.colors.text;
  }
}

/** 左对齐到固定宽度（超长硬截断，不追加省略号，用于字段对齐）。 */
export function pad(value: string, width: number): string {
  if (value.length >= width) return value.slice(0, width);
  return value + ' '.repeat(width - value.length);
}

/** scope 字符串映射到颜色。 */
export function scopeColor(scope: LogScope): string {
  switch (scope) {
    case 'tool':
      return wastelandTheme.colors.accent;
    case 'permission':
      return wastelandTheme.colors.warning;
    case 'session':
    case 'turn':
      return wastelandTheme.colors.secondary;
    case 'provider':
      return wastelandTheme.colors.primary;
    case 'mcp':
    case 'a2a':
      return wastelandTheme.colors.success;
    case 'file':
      return wastelandTheme.colors.text;
    default:
      return wastelandTheme.colors.muted;
  }
}

/** kind 颜色映射。 */
export function kindColor(kind: string | undefined): string {
  if (!kind) return wastelandTheme.colors.muted;
  if (kind.endsWith('_error')) return wastelandTheme.colors.error;
  if (kind.endsWith('_denied')) return wastelandTheme.colors.warning;
  if (kind.endsWith('_start') || kind.endsWith('_request')) return wastelandTheme.colors.primary;
  if (kind.endsWith('_end') || kind.endsWith('_response')) return wastelandTheme.colors.success;
  if (kind.endsWith('_granted')) return wastelandTheme.colors.success;
  return wastelandTheme.colors.muted;
}

/** 截断字符串，超长用省略号。 */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - 1)) + '…';
}

/** 选中行的 detail JSON。 */
export function formatDetail(entry: LogEntry): string {
  const json = {
    version: entry.version,
    timestamp: entry.timestamp,
    level: entry.level,
    scope: entry.scope,
    sessionId: entry.sessionId,
    turn: entry.turn,
    step: entry.step,
    message: entry.message,
    data: entry.data,
    error: entry.error,
  };
  try {
    return JSON.stringify(json, null, 2);
  } catch {
    return '[unable to serialize entry]';
  }
}

/** 序列化 data 字段为可搜索字符串（未定义/非对象 → 空串或 JSON）。 */
export function serializeData(data: unknown): string {
  if (data === undefined || data === null) return '';
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

export function entryMatchesKeyword(entry: LogEntry, keyword: string): boolean {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return true;

  const tokens = kw.split(/\s+/);
  for (const token of tokens) {
    if (token.includes(':') && !token.startsWith('http')) {
      const [key, ...rest] = token.split(':');
      const value = rest.join(':');
      
      if (key === 'level') {
        if (entry.level.toLowerCase() !== value) return false;
      } else if (key === 'scope' || key === 'agent') {
        if (!entry.scope.toLowerCase().includes(value)) return false;
      } else if (key === 'kind') {
        const entryKind = (entry.data as Record<string, unknown> | undefined)?.kind;
        const kindStr = typeof entryKind === 'string' ? entryKind.toLowerCase() : '-';
        if (!kindStr.includes(value)) return false;
      } else {
        // Fallback for unknown keys, treat as text search
        const textMatch = entry.message.toLowerCase().includes(token) || serializeData(entry.data).toLowerCase().includes(token);
        if (!textMatch) return false;
      }
    } else {
      // Normal keyword search
      const textMatch = entry.message.toLowerCase().includes(token) || serializeData(entry.data).toLowerCase().includes(token);
      if (!textMatch) return false;
    }
  }
  return true;
}

/**
 * 按 minLevel、关键字与错误聚焦过滤日志条目，三者叠加（AND）。
 *
 * - minLevel：只保留 level 数值 >= minLevel 的条目
 * - keyword：只保留 message / data 命中关键字的条目
 * - focusErrors：只保留 warn/error 级别的条目（错误聚焦模式）
 *
 * 仅做过滤，不做排序；排序由调用方负责。
 */
export function filterLogEntries(
  entries: LogEntry[],
  filters: { minLevel?: LogLevel; keyword?: string; focusErrors?: boolean },
): LogEntry[] {
  const minRank = filters.minLevel !== undefined ? LOG_LEVEL_RANK[filters.minLevel] : 0;
  const keyword = filters.keyword ?? '';
  const focusErrors = filters.focusErrors ?? false;
  return entries.filter((e) => {
    if (LOG_LEVEL_RANK[e.level] < minRank) return false;
    if (!entryMatchesKeyword(e, keyword)) return false;
    if (focusErrors && LOG_LEVEL_RANK[e.level] < LOG_LEVEL_RANK.warn) return false;
    return true;
  });
}

/** warn/error 级别的最低 rank（错误聚焦模式的阈值）。 */
const ERROR_FOCUS_MIN_RANK = LOG_LEVEL_RANK.warn;

/** 判断日志条目是否为错误聚焦关注的目标（warn/error）。 */
export function isErrorEntry(entry: LogEntry): boolean {
  return LOG_LEVEL_RANK[entry.level] >= ERROR_FOCUS_MIN_RANK;
}

/**
 * 统计日志条目中 warn/error 级别的数量（用于错误聚焦计数）。
 */
export function countErrorEntries(entries: LogEntry[]): number {
  return entries.reduce((acc, e) => (isErrorEntry(e) ? acc + 1 : acc), 0);
}

/**
 * 从 fromIndex 起沿 direction 方向查找最近的 warn/error 条目索引。
 *
 * - direction = 1：向下（索引增大，显示顺序中的下一条）
 * - direction = -1：向上（索引减小，显示顺序中的上一条）
 * - 找不到返回 -1
 *
 * entries 需按显示顺序排列（sessionCards 最新在上）。
 */
export function findNextErrorIndex(
  entries: LogEntry[],
  fromIndex: number,
  direction: 1 | -1,
): number {
  const step = direction >= 0 ? 1 : -1;
  for (let i = fromIndex + step; i >= 0 && i < entries.length; i += step) {
    const entry = entries[i];
    if (entry && isErrorEntry(entry)) {
      return i;
    }
  }
  return -1;
}

/**
 * 计算跳转到日志流最早/最晚位置的目标滚动偏移。
 *
 * cards 最新在上（offset 0 = 最新），因此：
 * - position = 'latest'：最新 → 列表顶部，偏移 0
 * - position = 'earliest'：最早 → 列表底部，偏移 total - visible
 *
 * totalItems 为当前过滤后的卡片总数；visibleCount 为可见行数（滚动窗口高度）。
 * 空列表返回 0（无内容可跳）。
 */
export function jumpOffset(
  totalItems: number,
  visibleCount: number,
  position: 'earliest' | 'latest',
): number {
  if (totalItems <= 0) return 0;
  const maxOffset = Math.max(0, totalItems - visibleCount);
  return position === 'latest' ? 0 : maxOffset;
}

/**
 * 在当前 filter 收窄后的 session 列表内循环计算下一个/上一个索引（尾部环绕）。
 *
 * - direction = 1：下一个（尾部环绕回 0）
 * - direction = -1：上一个（头部环绕回尾部）
 * - total <= 0 时返回 0（空列表占位，由外层 clamp 兜底）
 * - total 为 1 时恒为 0
 */
export function cycleSessionIndex(
  current: number,
  total: number,
  direction: 1 | -1,
): number {
  if (total <= 0) return 0;
  return ((current + direction) % total + total) % total;
}

/**
 * 计算让 selectedIndex 重新进入可见窗口所需的最小滚动偏移（滚动联动）。
 *
 * - selectedIndex 已在窗口内：保持原偏移（不扰动已稳定视图）
 * - 在窗口上方（selected < offset）：滚到选中项置于窗口顶（offset = selected）
 * - 在窗口下方（selected >= offset + visibleCount）：滚到选中项置于窗口底
 *   （offset = selected - visibleCount + 1，越界截断到 total - visibleCount）
 *
 * visibleCount 为可见行数估算；totalItems 为列表总项数。空列表返回 0。
 */
export function scrollToReveal(
  offset: number,
  selectedIndex: number,
  visibleCount: number,
  totalItems: number,
): number {
  if (totalItems <= 0) return 0;
  const maxOffset = Math.max(0, totalItems - visibleCount);
  if (selectedIndex < offset) {
    return Math.max(0, selectedIndex);
  }
  if (selectedIndex >= offset + visibleCount) {
    return Math.min(maxOffset, Math.max(0, selectedIndex - visibleCount + 1));
  }
  return offset;
}

/** 错误上下文展开的默认前后条数（可通过 LogsPage contextRadius prop 配置）。 */
export const DEFAULT_CONTEXT_RADIUS = 5;

/** 错误上下文窗口：错误条目本身 + 其前后各 radius 条原始日志。 */
export type ErrorContextWindow = {
  /** 错误条目本身。 */
  error: LogEntry;
  /** 错误之前的条目（时间上更早，按时间正序）。 */
  before: LogEntry[];
  /** 错误之后的条目（时间上更晚，按时间正序）。 */
  after: LogEntry[];
};

/**
 * 会话 transcript（用户/助手消息记录）转日志条目，用于对话+日志合并视图。
 *
 * 只取 message 记录（tool_call/tool_result 已有 tool 域日志覆盖，避免重复）；
 * role 进 data，前缀进 message（grep 友好）；level 固定 info，scope 用 turn。
 */
export function transcriptToLogEntries(
  records: SessionRecord[],
  sessionId: string
): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const record of records) {
    if (record.type !== 'message') continue;
    entries.push({
      version: 1,
      timestamp: record.timestamp,
      level: 'info',
      scope: 'turn',
      sessionId,
      turn: record.turn,
      message: `[${record.role}] ${record.content}`,
      data: { kind: 'transcript', role: record.role, source: record.source ?? 'interactive' },
    });
  }
  return entries;
}

/** 左侧 session 列表"可见行数"的保守估算（scrollToReveal 保证选中行可见用）。 */
export const SESSION_VISIBLE_ESTIMATE = 18;

/**
 * 卡片稳定键：优先用 logger 注入的全局自增 seq（跨 session 唯一），
 * 无 seq 的老数据用 timestamp + 同毫秒序号兜底（解决同毫秒多条导致的展开串台）。
 *
 * @param entry - 日志条目
 * @param ordinal - 同 timestamp 下的出现序号（调用方按列表顺序累计）
 */
export function cardKeyFor(entry: LogEntry, ordinal: number): string {
  return entry.seq != null ? `seq:${entry.seq}` : `ts:${entry.timestamp}#${ordinal}`;
}

/**
 * 取指定错误条目在原始日志流中的上下文窗口（前后各 radius 条）。
 *
 * 呈现错误发生的调用链与前因后果：before（前因）→ error → after（后果）。
 *
 * - entries 需按 timestamp 正序（loadSessionEntries 的返回顺序）
 * - 按 timestamp 定位错误条目；找不到返回 null
 * - 边界截断：流首/尾不足 radius 条时，返回可用部分
 * - 结果不包含错误条目自身（before / after 各独立计数）
 */
export function getErrorContextWindow(
  entries: LogEntry[],
  errorTimestamp: string,
  radius = DEFAULT_CONTEXT_RADIUS,
): ErrorContextWindow | null {
  const idx = entries.findIndex((e) => e.timestamp === errorTimestamp);
  return getErrorContextWindowAt(entries, idx, radius);
}

/**
 * 按下标取错误上下文窗口（同毫秒多条时精确定位，避免 timestamp 定位到第一条）。
 *
 * idx 越界返回 null。
 */
export function getErrorContextWindowAt(
  entries: LogEntry[],
  idx: number,
  radius = DEFAULT_CONTEXT_RADIUS,
): ErrorContextWindow | null {
  if (idx < 0 || idx >= entries.length) return null;
  const error = entries[idx];
  if (!error) return null;
  const before = entries.slice(Math.max(0, idx - radius), idx);
  const after = entries.slice(idx + 1, Math.min(entries.length, idx + 1 + radius));
  return { error, before, after };
}

/** 上下文条目 level 着色：error 高亮、warn 警告色、其余 muted（与错误条目区分）。 */
export function ctxLevelColor(level: LogLevel): string {
  switch (level) {
    case 'error':
      return wastelandTheme.colors.error;
    case 'warn':
      return wastelandTheme.colors.warning;
    default:
      return wastelandTheme.colors.muted;
  }
}
