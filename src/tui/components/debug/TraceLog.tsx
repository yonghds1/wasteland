/**
 * TraceLog - Trace 日志
 *
 * 显示调试追踪日志，支持过滤
 */

import React, { useState } from "react";
import { Text, Box, useInput } from "ink";
import { useAppContext } from "../../context/AppContext.js";

interface TraceLogProps {
  height?: number;
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

  // 键盘滚动
  useInput((input, key) => {
    if (key.upArrow) {
      setScrollOffset((prev) => Math.max(0, prev - 1));
    }
    if (key.downArrow) {
      setScrollOffset((prev) => Math.min(Math.max(0, filteredTraces.length - visibleLines), prev + 1));
    }
  });

  // 空状态
  if (traces.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
        <Text dimColor>暂无 trace 日志</Text>
        <Text dimColor>使用 --debug 启动以查看详细追踪</Text>
        <Text dimColor color="gray">rxc chat --debug --message "你的消息"</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* 标题栏 */}
      <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
        <Text bold underline>Trace 日志</Text>
        <Text dimColor>{filteredTraces.length} 条 | ↑/↓ 滚动</Text>
      </Box>

      {/* 日志列表 */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {visibleTraces.map((trace, idx) => (
          <Box key={scrollOffset + idx} flexDirection="row">
            {/* 时间戳 */}
            <Text dimColor>[{trace.timestamp.slice(11, 19)}]</Text>
            {/* scope.phase */}
            <Text color="cyan"> {trace.scope}.</Text>
            <Text color="yellow">{trace.phase}</Text>
            {/* 消息 */}
            {trace.message && <Text dimColor> {trace.message}</Text>}
          </Box>
        ))}
      </Box>

      {/* 滚动指示器 */}
      {filteredTraces.length > visibleLines && (
        <Box flexDirection="row" justifyContent="center">
          <Text dimColor>
            {scrollOffset > 0 ? "▲ " : "  "}
            {scrollOffset + 1}-{Math.min(scrollOffset + visibleLines, filteredTraces.length)} / {filteredTraces.length}
            {scrollOffset + visibleLines < filteredTraces.length ? " ▼" : "  "}
          </Text>
        </Box>
      )}
    </Box>
  );
}
