/**
 * GlobalTimeline - 跨 session 全局工具调用时间线视图
 *
 * 在单 session 时间线（ToolTimeline）之上提供全局聚合：
 * - buildGlobalTimeline：跨多个 session 的工具调用记录合并为全局时序
 * - aggregateToolStats：按 toolName 聚合失败数 / 平均耗时 / 最大耗时 / 慢调用数
 * - GlobalTimeline / GlobalStatsTable：对应的全局时序 / 分布视图组件
 *
 * 数据源：每个 session 先经 buildToolTimeline 聚合成 ToolCallRecord[]（配对不跨
 * session），再标注所属 sessionId 合并为全局记录，按 (startTime ?? endTime) 时间序。
 *
 * 设计要点：
 * - 聚合逻辑为纯函数（buildGlobalTimeline / aggregateToolStats），可独立单测
 * - 每条全局记录带 sessionId，可从全局时间线定位到具体 session
 * - stats 视图同时呈现失败聚类（按 toolName 的 failed 数）与耗时分布
 *   （avg / max / slow），覆盖"失败聚类或耗时分布"验收点
 */

import React from 'react';
import { Box, Text } from 'ink';
import { wastelandTheme } from '@theme/wasteland/index.js';
import type { LogEntry } from '@core/logger/index.js';
import {
  DEFAULT_SLOW_THRESHOLD_MS,
  TIMELINE_ROW_HEIGHT,
  buildToolTimeline,
  formatDuration,
  formatToolTime,
  isSlowCall,
  type ToolCallRecord,
  type ToolCallStatus,
} from './ToolTimeline.js';
import { ScrollableBox } from './ScrollableBox.js';

// ============================================================
// 类型
// ============================================================

/** 单个 session 的日志组（全局聚合输入）。 */
export type SessionLogGroup = {
  sessionId: string;
  entries: ReadonlyArray<LogEntry>;
};

/** 全局工具调用记录：单 session 记录 + 所属 sessionId。 */
export type GlobalToolCallRecord = ToolCallRecord & {
  /** 所属 sessionId */
  sessionId: string;
};

/** 按 toolName 聚合的统计。 */
export type ToolCallStats = {
  toolName: string;
  /** 调用总数 */
  calls: number;
  /** 失败数 */
  failed: number;
  /** 平均耗时（ms）；无耗时记录时缺失 */
  avgDurationMs?: number;
  /** 最大耗时（ms）；无耗时记录时缺失 */
  maxDurationMs?: number;
  /** 慢调用数（超过 slowThresholdMs） */
  slowCalls: number;
};

/** 状态 → 图标 / 颜色 / 文案（与 ToolTimeline 保持一致的语义）。 */
const STATUS_META: Record<ToolCallStatus, { icon: string; color: string; label: string }> = {
  success: { icon: '✓', color: wastelandTheme.colors.success, label: 'success' },
  error: { icon: '✗', color: wastelandTheme.colors.error, label: 'error' },
  started: { icon: '…', color: wastelandTheme.colors.warning, label: 'started' },
};

// ============================================================
// 纯函数（可单测）
// ============================================================

/**
 * 跨 session 合并工具调用时间线。
 *
 * 每个 session 独立经 buildToolTimeline 聚合（调用配对不跨 session），
 * 标注 sessionId 后合并，按 (startTime ?? endTime) 全局时间序排列。
 */
export function buildGlobalTimeline(
  groups: ReadonlyArray<SessionLogGroup>,
): GlobalToolCallRecord[] {
  const records: GlobalToolCallRecord[] = [];
  for (const group of groups) {
    for (const record of buildToolTimeline(group.entries)) {
      records.push({ ...record, sessionId: group.sessionId });
    }
  }
  records.sort((a, b) => {
    const ta = a.startTime ?? a.endTime ?? '';
    const tb = b.startTime ?? b.endTime ?? '';
    return ta.localeCompare(tb);
  });
  return records;
}

/**
 * 按 toolName 聚合全局记录：调用数 / 失败数 / 平均耗时 / 最大耗时 / 慢调用数。
 *
 * - 无耗时记录不计入平均/最大耗时
 * - 排序：调用数降序，其次失败数降序（问题集中度优先）
 */
export function aggregateToolStats(
  records: ReadonlyArray<GlobalToolCallRecord>,
  slowThresholdMs: number = DEFAULT_SLOW_THRESHOLD_MS,
): ToolCallStats[] {
  const map = new Map<string, { calls: number; failed: number; durations: number[]; slow: number }>();
  for (const record of records) {
    const agg = map.get(record.toolName) ?? { calls: 0, failed: 0, durations: [], slow: 0 };
    agg.calls += 1;
    if (record.status === 'error') agg.failed += 1;
    if (record.durationMs !== undefined && Number.isFinite(record.durationMs)) {
      agg.durations.push(record.durationMs);
      if (record.durationMs > slowThresholdMs) agg.slow += 1;
    }
    map.set(record.toolName, agg);
  }
  return Array.from(map.entries())
    .map(([toolName, agg]) => ({
      toolName,
      calls: agg.calls,
      failed: agg.failed,
      ...(agg.durations.length > 0
        ? {
            avgDurationMs: agg.durations.reduce((a, b) => a + b, 0) / agg.durations.length,
            maxDurationMs: Math.max(...agg.durations),
          }
        : {}),
      slowCalls: agg.slow,
    }))
    .sort((a, b) => b.calls - a.calls || b.failed - a.failed);
}

/** 截断字符串，超长用省略号。 */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - 1)) + '…';
}

// ============================================================
// 全局时序视图
// ============================================================

/** 全局时间线表头（时间 / session / 工具名 / 耗时 / 状态）。 */
export function GlobalTimelineHeader(): React.ReactElement {
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Text color={wastelandTheme.colors.muted}>
        {'time'.padEnd(10)}
        {'session'.padEnd(16)}
        {'toolName'.padEnd(14)}
        {'duration'.padStart(9)}
        {'  status'}
      </Text>
    </Box>
  );
}

/**
 * 单条全局工具调用记录行（含可选错误 / 未结束子行）。
 *
 * sessionId 用 secondary 色区分来源；`highlightSessionId` 命中时高亮
 * （当前 session filter 匹配的 session），用于定位反馈。
 */
export function GlobalTimelineRow({
  record,
  highlightSessionId,
  slowThresholdMs = DEFAULT_SLOW_THRESHOLD_MS,
}: {
  record: GlobalToolCallRecord;
  /** 高亮显示的 sessionId（当前 session filter 匹配的 session） */
  highlightSessionId?: string;
  /** 慢调用阈值（毫秒），可覆盖默认值 */
  slowThresholdMs?: number;
}): React.ReactElement {
  const meta = STATUS_META[record.status];
  const timeStr = formatToolTime(record.startTime ?? record.endTime);
  const slow = isSlowCall(record, slowThresholdMs);
  const isHighlighted = record.sessionId === highlightSessionId;
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text color={wastelandTheme.colors.muted}>{timeStr.padEnd(10)}</Text>
        <Text
          bold={isHighlighted}
          color={isHighlighted ? wastelandTheme.colors.borderFocused : wastelandTheme.colors.secondary}
        >
          {truncate(record.sessionId, 16).padEnd(16)}
        </Text>
        <Text color={wastelandTheme.colors.text}>{truncate(record.toolName, 14).padEnd(14)}</Text>
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
            {'✗ '}
            {truncate(record.errorMessage, 60)}
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
 * 完整全局时间线视图（表头 + 空态 + 全部记录行）。
 *
 * 传入 `offset` / `onOffsetChange` 时行区域用 ScrollableBox 滚动；不传则全部渲染
 * （无滚动，用于测试 / 单屏展示）。
 */
export function GlobalTimeline({
  records,
  offset,
  onOffsetChange,
  itemHeight = TIMELINE_ROW_HEIGHT,
  highlightSessionId,
  slowThresholdMs = DEFAULT_SLOW_THRESHOLD_MS,
  height,
  showScrollbar = false,
}: {
  records: ReadonlyArray<GlobalToolCallRecord>;
  /** 滚动偏移（提供后启用 ScrollableBox） */
  offset?: number;
  /** 滚动偏移变化回调（提供后启用 ScrollableBox） */
  onOffsetChange?: (offset: number) => void;
  /** 每行占高（默认 2 行，含错误/未结束子行） */
  itemHeight?: number;
  /** 高亮显示的 sessionId */
  highlightSessionId?: string;
  /** 慢调用阈值（毫秒），可覆盖默认值 */
  slowThresholdMs?: number;
  /** 列表区固定高度（行数；传入后溢出裁剪，页面不撑屏） */
  height?: number;
  /** 显示右侧滚动条（内容可能溢出时传 true） */
  showScrollbar?: boolean;
}): React.ReactElement {
  const scrollable = offset !== undefined && onOffsetChange !== undefined;
  const rowKey = (record: GlobalToolCallRecord, idx: number): string =>
    `${record.sessionId}-${record.toolName}-${record.startTime ?? record.endTime}-${idx}`;
  return (
    <Box flexDirection="column">
      <GlobalTimelineHeader />
      {records.length === 0 ? (
        <Box marginTop={1}>
          <Text color={wastelandTheme.colors.muted}>(no tool calls across sessions)</Text>
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
            <GlobalTimelineRow
              key={rowKey(record, idx)}
              record={record}
              highlightSessionId={highlightSessionId}
              slowThresholdMs={slowThresholdMs}
            />
          ))}
        </ScrollableBox>
      ) : (
        records.map((record, idx) => (
          <GlobalTimelineRow
            key={rowKey(record, idx)}
            record={record}
            highlightSessionId={highlightSessionId}
            slowThresholdMs={slowThresholdMs}
          />
        ))
      )}
    </Box>
  );
}

// ============================================================
// 耗时分布 / 失败聚类视图
// ============================================================

/** 分布表头（工具名 / 调用数 / 失败 / 平均耗时 / 最大耗时 / 慢调用）。 */
export function GlobalStatsHeader(): React.ReactElement {
  return (
    <Box flexDirection="row" flexShrink={0}>
      <Text color={wastelandTheme.colors.muted}>
        {'toolName'.padEnd(16)}
        {'calls'.padStart(6)}
        {'failed'.padStart(7)}
        {'avg'.padStart(9)}
        {'max'.padStart(9)}
        {'slow'.padStart(6)}
      </Text>
    </Box>
  );
}

/** 单条工具统计行：失败数错误色、慢调用数 warning 色。 */
export function GlobalStatsRow({ stat }: { stat: ToolCallStats }): React.ReactElement {
  return (
    <Box flexDirection="row">
      <Text color={wastelandTheme.colors.text}>{truncate(stat.toolName, 16).padEnd(16)}</Text>
      <Text color={wastelandTheme.colors.muted}>{String(stat.calls).padStart(6)}</Text>
      <Text color={stat.failed > 0 ? wastelandTheme.colors.error : wastelandTheme.colors.success}>
        {String(stat.failed).padStart(7)}
      </Text>
      <Text color={wastelandTheme.colors.muted}>{formatDuration(stat.avgDurationMs).padStart(9)}</Text>
      <Text color={wastelandTheme.colors.muted}>{formatDuration(stat.maxDurationMs).padStart(9)}</Text>
      <Text color={stat.slowCalls > 0 ? wastelandTheme.colors.warning : wastelandTheme.colors.muted}>
        {String(stat.slowCalls).padStart(6)}
      </Text>
    </Box>
  );
}

/**
 * 完整分布视图（表头 + 空态 + 全部统计行）。
 *
 * 传入 `offset` / `onOffsetChange` 时行区域用 ScrollableBox 滚动；不传则全部渲染。
 */
export function GlobalStatsTable({
  stats,
  offset,
  onOffsetChange,
  height,
  showScrollbar = false,
}: {
  stats: ReadonlyArray<ToolCallStats>;
  /** 滚动偏移（提供后启用 ScrollableBox） */
  offset?: number;
  /** 滚动偏移变化回调（提供后启用 ScrollableBox） */
  onOffsetChange?: (offset: number) => void;
  /** 列表区固定高度（行数；传入后溢出裁剪，页面不撑屏） */
  height?: number;
  /** 显示右侧滚动条（内容可能溢出时传 true） */
  showScrollbar?: boolean;
}): React.ReactElement {
  const scrollable = offset !== undefined && onOffsetChange !== undefined;
  return (
    <Box flexDirection="column">
      <GlobalStatsHeader />
      {stats.length === 0 ? (
        <Box marginTop={1}>
          <Text color={wastelandTheme.colors.muted}>(no tool stats across sessions)</Text>
        </Box>
      ) : scrollable ? (
        <ScrollableBox
          offset={offset}
          onOffsetChange={onOffsetChange}
          totalItems={stats.length}
          itemHeight={1}
          height={height}
          showScrollbar={showScrollbar}
        >
          {stats.map((stat) => (
            <GlobalStatsRow key={stat.toolName} stat={stat} />
          ))}
        </ScrollableBox>
      ) : (
        stats.map((stat) => <GlobalStatsRow key={stat.toolName} stat={stat} />)
      )}
    </Box>
  );
}
