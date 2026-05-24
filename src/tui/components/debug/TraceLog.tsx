/**
 * TraceLog - Trace 日志
 *
 * 显示调试追踪日志，支持：
 * - scope.phase 显示
 * - 过滤器支持
 * - 滚动查看
 */

import React, { useState } from "react";
import { Text, Box, useInput } from "ink";
import { useAppContext } from "../../context/AppContext.js";
import {
  PRIMARY,
  MUTED,
  SECONDARY,
  SUCCESS,
  WARNING,
  SEPARATORS,
} from "../../utils/colors.js";

interface TraceLogProps {
  height?: number;
}

/**
 * 根据日志级别获取颜色
 */
function getLogLevelColor(phase: string): string {
  if (phase.includes("error") || phase.includes("fail")) {
    return "red";
  }
  if (phase.includes("warn")) {
    return WARNING;
  }
  if (phase.includes("success") || phase.includes("complete")) {
    return SUCCESS;
  }
  return SECONDARY;
}

export function TraceLog({ height }: TraceLogProps): React.ReactElement {
  const { state } = useAppContext();
  const { traces, filter } = state.debug;
  const [scrollOffset, setScrollOffset] = useState(0);

  // 可见行数
  const visibleLines = height ? Math.max(height - 4, 5) : 15;

  // 过滤 traces
  const filteredTraces = traces.filter((trace) => {
    if (filter.scope && trace.scope !== filter.scope) return false;
    if (filter.phase && trace.phase !== filter.phase) return false;
    return true;
  });

  // 可见 traces
  const visibleTraces = filteredTraces.slice(scrollOffset, scrollOffset + visibleLines);

  // 键盘滚动（仅在导航模式下处理）
  useInput(
    (input, key) => {
      if (key.upArrow) {
        setScrollOffset((prev) => Math.max(0, prev - 1));
      }
      if (key.downArrow) {
        setScrollOffset((prev) => Math.min(Math.max(0, filteredTraces.length - visibleLines), prev + 1));
      }
    },
    // 仅在导航模式且不在特殊模式下时处理
    { isActive: !state.inputMode && !state.filterMode && !state.editMode && !state.exitConfirmPending && !state.showHelp }
  );

  // 空状态
  if (traces.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
        <Text color={PRIMARY}>◆ 暂无 trace 日志</Text>
        <Text dimColor>使用 --debug 启动以查看详细追踪</Text>
        <Text dimColor color="gray">rxc chat --debug --message "你的消息"</Text>
      </Box>
    );
  }

  // 是否有激活的过滤器
  const hasFilter = Boolean(filter.scope || filter.phase);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* 标题栏 */}
      <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
        <Box flexDirection="row" gap={1}>
          <Text bold color={PRIMARY}>
            Trace 日志
          </Text>
          {hasFilter && (
            <Text color={WARNING}>⚑ 过滤</Text>
          )}
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{filteredTraces.length} 条</Text>
          <Text dimColor>{SEPARATORS.item.trim()}</Text>
          <Text dimColor>↑/↓ 滚动</Text>
        </Box>
      </Box>

      {/* 日志列表 */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {visibleTraces.map((trace, idx) => {
          const phaseColor = getLogLevelColor(trace.phase);

          return (
            <Box key={scrollOffset + idx} flexDirection="row" gap={1}>
              {/* 时间戳 */}
              <Text dimColor>[{trace.timestamp.slice(11, 19)}]</Text>

              {/* scope */}
              <Text color="cyan">{trace.scope}</Text>
              <Text dimColor>.</Text>

              {/* phase */}
              <Text color={phaseColor}>{trace.phase}</Text>

              {/* 消息 */}
              {trace.message && (
                <Text dimColor>{trace.message}</Text>
              )}
            </Box>
          );
        })}
      </Box>

      {/* 滚动指示器 */}
      {filteredTraces.length > visibleLines && (
        <Box flexDirection="row" justifyContent="center" gap={1}>
          <Text dimColor>
            {scrollOffset > 0 ? "▲ " : "  "}
            {scrollOffset + 1}-{Math.min(scrollOffset + visibleLines, filteredTraces.length)} / {filteredTraces.length}
            {scrollOffset + visibleLines < filteredTraces.length ? " ▼" : "  "}
          </Text>
        </Box>
      )}

      {/* 过滤器状态 */}
      {hasFilter && (
        <Box flexDirection="row" justifyContent="center" gap={1}>
          <Text dimColor>过滤条件:</Text>
          {filter.scope && (
            <Text color="cyan">scope={filter.scope}</Text>
          )}
          {filter.phase && (
            <Text color={SECONDARY}>phase={filter.phase}</Text>
          )}
          <Text dimColor>{SEPARATORS.item.trim()}</Text>
          <Text color={WARNING}>f 修改</Text>
        </Box>
      )}
    </Box>
  );
}
