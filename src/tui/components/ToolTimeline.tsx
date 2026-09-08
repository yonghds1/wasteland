/**
 * ToolTimeline - 工具调用时间线视图
 *
 * 从日志条目流（tool_start / tool_end / tool_error 结构化事件）聚合出工具调用
 * 时间线：调用顺序、耗时、成功/失败状态，方便排查"谁在什么时候调了什么、结果如何"。
 *
 * 数据源：`createLogEvents` 产出的结构化事件会写入 LogEntry：
 * - `data.kind === 'tool_start'` / `'tool_end'` / `'tool_error'`
 * - `data.toolName` 标识工具名，`data.durationMs` 为事件侧耗时
 * - `error` 字段携带失败信息（仅 tool_error）
 *
 * 设计要点：
 * - 纯函数 `buildToolTimeline` 从 LogEntry[] 聚合 ToolCallRecord[]（可单测）
 * - 无 callId，按 toolName FIFO 配对 start/end；配对缺失时降级显示：
 *   - 有 end 无 start → 孤儿记录（仍显示，状态 success/error）
 *   - 有 start 无 end → 状态保持 `started`（running），耗时留空
 * - 耗时优先取事件 `data.durationMs`，缺失时由 start/end 时间戳推算
 * - 失败调用用 error 色高亮，未结束调用用 warning 色标注
 * - 超过慢调用阈值（默认 DEFAULT_SLOW_THRESHOLD_MS）的调用标记 SLOW 并用 warning 色
 *   高亮耗时，与错误高亮互不干扰（错误行仍用 error 色）
 */

import React from 'react';
import { Box, Text } from 'ink';
import { wastelandTheme } from '@theme/wasteland/index.js';
import type { LogEntry } from '@core/logger/index.js';
import { ScrollableBox } from './ScrollableBox.js';
import { truncateToWidth } from './card-window.js';
import { pad2, parseLocalDate } from './chat-message-utils.js';

// ============================================================
// 类型
// ============================================================

/** 工具调用状态。 */
export type ToolCallStatus = 'success' | 'error' | 'started';

/** 聚合后的单条工具调用记录。 */
export type ToolCallRecord = {
  /** 工具名 */
  toolName: string;
  /** toolStart 事件时间戳（ISO8601） */
  startTime?: string;
  /** toolEnd / toolError 事件时间戳（ISO8601） */
  endTime?: string;
  /** 耗时（毫秒）：优先取事件 data.durationMs，缺失时由 start/end 时间戳推算 */
  durationMs?: number;
  /** 状态：success=成功 / error=失败 / started=已开始未结束 */
  status: ToolCallStatus;
  /** 失败信息（仅 error 状态） */
  errorMessage?: string;
};

// ============================================================
// 常量
// ============================================================

/** 工具生命周期事件 kind。 */
const KIND_START = 'tool_start';
const KIND_END = 'tool_end';
const KIND_ERROR = 'tool_error';

/** 时间线每行占高（含可能的错误/未结束子行）。 */
export const TIMELINE_ROW_HEIGHT = 2;

/** 慢调用阈值（毫秒）：工具调用耗时超过该值即在时间线标记 SLOW。 */
export const DEFAULT_SLOW_THRESHOLD_MS = 5000;

/** 状态 → 图标 / 颜色 / 文案。 */
const STATUS_META: Record<ToolCallStatus, { icon: string; color: string; label: string }> = {
  success: { icon: '✓', color: wastelandTheme.colors.success, label: 'success' },
  error: { icon: '✗', color: wastelandTheme.colors.error, label: 'error' },
  started: { icon: '…', color: wastelandTheme.colors.warning, label: 'started' },
};

// ============================================================
// 纯函数（可单测）
// ============================================================

/** 两个 ISO 时间戳之间的毫秒差；任一无法解析时返回 undefined。 */
function msBetween(a: string, b: string): number | undefined {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return undefined;
  return Math.max(0, tb - ta);
}

/** 从 entry.data 提取 toolName。 */
function toolNameOf(data: Record<string, unknown> | undefined): string | undefined {
  if (!data) return undefined;
  const name = data.toolName;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

/** 从 entry.error 提取可读消息。 */
function errorMessageOf(error: LogEntry['error']): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as { name?: unknown; message?: unknown };
  if (typeof e.message === 'string' && e.message.length > 0) return e.message;
  if (typeof e.name === 'string' && e.name.length > 0) return e.name;
  return undefined;
}

/**
 * 从日志条目流聚合出工具调用时间线。
 *
 * 配对规则（无 callId，按 toolName FIFO 配对）：
 * - tool_start 开启一个 pending 调用，立即生成 `started` 记录
 * - tool_end / tool_error 弹出一个 pending 调用并标记为 success / error
 * - tool_end / tool_error 无匹配 start（异常中断 / 日志裁剪）→ 生成孤儿记录
 * - 有 start 无 end → 保持 `started`，durationMs 留空
 *
 * 返回按开始时间（无开始则按结束时间）正序排列的记录。
 */
export function buildToolTimeline(entries: ReadonlyArray<LogEntry>): ToolCallRecord[] {
  const sorted = [...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  // toolName → 尚未配对的 started 记录队列（FIFO）
  const pending = new Map<string, ToolCallRecord[]>();
  const records: ToolCallRecord[] = [];

  for (const entry of sorted) {
    const kind = entry.data?.kind;
    if (kind !== KIND_START && kind !== KIND_END && kind !== KIND_ERROR) continue;
    const toolName = toolNameOf(entry.data);
    if (!toolName) continue;

    if (kind === KIND_START) {
      const record: ToolCallRecord = {
        toolName,
        startTime: entry.timestamp,
        status: 'started',
      };
      records.push(record);
      const queue = pending.get(toolName) ?? [];
      queue.push(record);
      pending.set(toolName, queue);
      continue;
    }

    // end / error
    const isError = kind === KIND_ERROR;
    const rawDuration = entry.data?.durationMs;
    const durationMs =
      typeof rawDuration === 'number' && Number.isFinite(rawDuration) ? rawDuration : undefined;
    const queue = pending.get(toolName);
    const start = queue?.shift();
    if (queue && queue.length === 0) pending.delete(toolName);

    const effectiveDuration =
      durationMs ?? (start?.startTime ? msBetween(start.startTime, entry.timestamp) : undefined);

    if (start) {
      start.endTime = entry.timestamp;
      start.durationMs = effectiveDuration;
      start.status = isError ? 'error' : 'success';
      if (isError) start.errorMessage = errorMessageOf(entry.error);
    } else {
      // 孤儿记录：有结束事件但无匹配开始（异常中断 / 日志裁剪）
      records.push({
        toolName,
        endTime: entry.timestamp,
        durationMs: effectiveDuration,
        status: isError ? 'error' : 'success',
        ...(isError ? { errorMessage: errorMessageOf(entry.error) } : {}),
      });
    }
  }

  // 时间序：优先 startTime，其次 endTime；相同时间保持稳定顺序
  records.sort((a, b) => {
    const ta = a.startTime ?? a.endTime ?? '';
    const tb = b.startTime ?? b.endTime ?? '';
    return ta.localeCompare(tb);
  });

  return records;
}

/**
 * 格式化耗时（毫秒）。
 *
 * - 缺失 / 非有限数 → `--`
 * - < 1000ms → `123ms`
 * - ≥ 1000ms → `1.5s` / `45s`
 */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  return `${seconds % 1 === 0 ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
}

/**
 * 判断工具调用是否为慢调用：有耗时且严格超过阈值（毫秒）。
 *
 * - 无耗时（started / 数据缺失）→ 不算慢调用
 * - durationMs === thresholdMs（恰好等于）→ 不算慢调用（“超过”而非“达到”）
 */
export function isSlowCall(
  record: ToolCallRecord,
  thresholdMs: number = DEFAULT_SLOW_THRESHOLD_MS,
): boolean {
  return record.durationMs !== undefined && record.durationMs > thresholdMs;
}

/** ISO 时间戳 → 本地时区 HH:MM:SS.mmm；缺失 → '--'，非法 → 原样。 */
export function formatToolTime(iso: string | undefined): string {
  if (!iso) return '--';
  const d = parseLocalDate(iso);
  if (!d) return iso;
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

/** 截断字符串，超长用省略号。 */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - 1)) + '…';
}

// ============================================================
// 组件
// ============================================================

/** 时间线表头（时间 / 工具名 / 耗时 / 状态）。 */
export function ToolTimelineHeader(): React.ReactElement {
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Text color={wastelandTheme.colors.muted}>
        {'time'.padEnd(10)}
        {'toolName'.padEnd(18)}
        {'duration'.padStart(9)}
        {'  status'}
      </Text>
    </Box>
  );
}

/**
 * 单条工具调用记录行（含可选错误 / 未结束子行）。
 *
 * 超过 `slowThresholdMs` 的调用在耗时后用 warning 色标记 SLOW，且耗时本身用
 * warning 色高亮；与错误高亮互不干扰（错误状态与错误子行仍用 error 色）。
 */
export function ToolTimelineRow({
  record,
  slowThresholdMs = DEFAULT_SLOW_THRESHOLD_MS,
  contentWidth,
}: {
  record: ToolCallRecord;
  /** 慢调用阈值（毫秒），可覆盖默认值 */
  slowThresholdMs?: number;
  /**
   * 行内容宽度（列数；传入后错误子行按显示宽度截到单行，保证 TIMELINE_ROW_HEIGHT 精确。
   * 不传保持旧行为：错误信息截断 60 字符）。
   */
  contentWidth?: number;
}): React.ReactElement {
  const meta = STATUS_META[record.status];
  const timeStr = formatToolTime(record.startTime ?? record.endTime);
  const slow = isSlowCall(record, slowThresholdMs);
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color={wastelandTheme.colors.muted}>{timeStr.padEnd(10)}</Text>
        <Text color={wastelandTheme.colors.text}>{truncate(record.toolName, 18).padEnd(18)}</Text>
        <Text color={slow ? wastelandTheme.colors.warning : wastelandTheme.colors.muted}>
          {formatDuration(record.durationMs).padStart(9)}
        </Text>
        <Text color={meta.color}>
          {'  '}
          {meta.icon} {meta.label}
        </Text>
        {slow && (
          <Text color={wastelandTheme.colors.warning}>
            {'  '}SLOW
          </Text>
        )}
      </Box>
      {record.status === 'error' && record.errorMessage && (
        <Box flexDirection="row" marginLeft={2}>
          <Text color={wastelandTheme.colors.error}>
            {contentWidth === undefined
              ? `✗ ${truncate(record.errorMessage, 60)}`
              : truncateToWidth(`✗ ${record.errorMessage}`, contentWidth - 2)}
          </Text>
        </Box>
      )}
      {record.status === 'started' && (
        <Box flexDirection="row" marginLeft={2}>
          <Text color={wastelandTheme.colors.warning}>
            {'… '}
            incomplete (no end event)
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * 完整时间线视图（表头 + 空态 + 全部记录行）。
 *
 * 传入 `offset` / `onOffsetChange` 时行区域用 ScrollableBox 滚动；不传则全部渲染
 * （无滚动，用于测试 / 单屏展示）。
 */
export function ToolTimeline({
  records,
  offset,
  onOffsetChange,
  itemHeight = TIMELINE_ROW_HEIGHT,
  slowThresholdMs = DEFAULT_SLOW_THRESHOLD_MS,
  height,
  showScrollbar = false,
  contentWidth,
}: {
  records: ReadonlyArray<ToolCallRecord>;
  /** 滚动偏移（提供后启用 ScrollableBox） */
  offset?: number;
  /** 滚动偏移变化回调（提供后启用 ScrollableBox） */
  onOffsetChange?: (offset: number) => void;
  /** 每行占高（默认 2 行，含错误/未结束子行） */
  itemHeight?: number;
  /** 慢调用阈值（毫秒），可覆盖默认值 */
  slowThresholdMs?: number;
  /** 列表区固定高度（行数；传入后溢出裁剪，页面不撑屏） */
  height?: number;
  /** 显示右侧滚动条（内容可能溢出时传 true） */
  showScrollbar?: boolean;
  /** 行内容宽度（透传给 Row 做错误行单行截断；不传保持旧行为） */
  contentWidth?: number;
}): React.ReactElement {
  const scrollable = offset !== undefined && onOffsetChange !== undefined;
  return (
    <Box flexDirection="column">
      <ToolTimelineHeader />
      {records.length === 0 ? (
        <Box marginTop={1}>
          <Text color={wastelandTheme.colors.muted}>(no tool calls in this session)</Text>
        </Box>
      ) : scrollable ? (
        <ScrollableBox
          offset={offset}
          onOffsetChange={onOffsetChange}
          totalItems={records.length}
          itemHeight={itemHeight}
          height={height}
          showScrollbar={showScrollbar}
        >
          {records.map((record, idx) => (
            <ToolTimelineRow
              key={`${record.toolName}-${record.startTime ?? record.endTime}-${idx}`}
              record={record}
              slowThresholdMs={slowThresholdMs}
              contentWidth={contentWidth}
            />
          ))}
        </ScrollableBox>
      ) : (
        records.map((record, idx) => (
          <ToolTimelineRow
            key={`${record.toolName}-${record.startTime ?? record.endTime}-${idx}`}
            record={record}
            slowThresholdMs={slowThresholdMs}
            contentWidth={contentWidth}
          />
        ))
      )}
    </Box>
  );
}
