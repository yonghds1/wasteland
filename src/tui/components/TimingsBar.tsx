/**
 * TimingsBar - 工具调用 5 段时间分解可视化
 *
 * 借自 Claude Code `tengu_tool_use_success`：把一次工具调用的总耗时拆成
 * preHook / permission / tool / postHook / total 五段，用水平进度条直观展示。
 *
 * ## 设计要点
 *
 * - 进度条总宽度 = `width` props；每段宽度按 `ms / totalMs` 等比缩放
 * - 颜色映射：preHook=蓝、permission=黄、tool=主色、postHook=紫、total=绿
 * - 每段下方标注 `label  ms (占比%)`，便于精确读数
 * - total 段在最右侧以等宽对照展示
 *
 * @example
 * ```tsx
 * <TimingsBar timings={{ preHookMs: 5, permissionMs: 12, toolMs: 1190, postHookMs: 2, totalMs: 1234 }} width={40} />
 * ```
 */

import React from 'react';
import { Box, Text } from 'ink';
import { wastelandTheme } from '@theme/wasteland/index.js';

/** 5 段时间分解（与 @core/logger LogTimings 对齐） */
export type Timings = {
  preHookMs: number;
  permissionMs: number;
  toolMs: number;
  postHookMs: number;
  totalMs: number;
};

interface TimingsBarProps {
  timings: Timings;
  /** 进度条总宽度（字符数），默认 32 */
  width?: number;
}

/**
 * 计算单段百分比（防止 0 除）。
 *
 * 导出以便单元测试。
 */
export function calcSegmentPercentage(ms: number, totalMs: number): number {
  const total = Math.max(totalMs, 1);
  return (ms / total) * 100;
}

/**
 * 把 entry.data.timings 解析为 Timings 对象，缺失字段容错返回 0。
 *
 * 导出以便 LogsPage 与测试复用。
 */
export function parseTimings(data: unknown): Timings | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  const t = obj.timings;
  if (!t || typeof t !== 'object') return null;
  const fields = t as Record<string, unknown>;
  const num = (k: string): number => (typeof fields[k] === 'number' ? (fields[k] as number) : 0);
  return {
    preHookMs: num('preHookMs'),
    permissionMs: num('permissionMs'),
    toolMs: num('toolMs'),
    postHookMs: num('postHookMs'),
    totalMs: num('totalMs'),
  };
}

/**
 * 5 段时间分解进度条。
 *
 * 渲染结构：
 * ```
 * preHook   ▓░ 5ms (0.4%)
 * permission▓▓▓▓ 12ms (1.0%)
 * tool      ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 1190ms (96.4%)
 * postHook  ░ 2ms (0.2%)
 * total     ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 1234ms
 * ```
 */
export function TimingsBar({ timings, width = 32 }: TimingsBarProps): React.ReactElement {
  // 防止 0 除
  const total = Math.max(timings.totalMs, 1);
  const segments = [
    { key: 'preHook', ms: timings.preHookMs, color: wastelandTheme.colors.primary, label: 'preHook' },
    { key: 'permission', ms: timings.permissionMs, color: wastelandTheme.colors.warning, label: 'permission' },
    { key: 'tool', ms: timings.toolMs, color: wastelandTheme.colors.text, label: 'tool' },
    { key: 'postHook', ms: timings.postHookMs, color: wastelandTheme.colors.muted, label: 'postHook' },
  ];

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={wastelandTheme.colors.muted}>timings (total: {timings.totalMs}ms):</Text>
      {segments.map((seg) => {
        const pct = (seg.ms / total) * 100;
        const barWidth = Math.max(1, Math.round((seg.ms / timings.totalMs) * width));
        // 保留至少 1 格给 0ms 段，否则看起来像数据缺失
        const bar = '▓'.repeat(barWidth) + '░'.repeat(Math.max(0, width - barWidth));
        return (
          <Box key={seg.key} flexDirection="row">
            <Text color={wastelandTheme.colors.muted}>
              {'  '}
              {seg.label.padEnd(10, ' ')}
            </Text>
            <Text color={seg.color}>{bar}</Text>
            <Text color={wastelandTheme.colors.muted}>
              {' '}
              {String(seg.ms).padStart(4, ' ')}ms ({pct.toFixed(1)}%)
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}