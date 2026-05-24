/**
 * TraceLog - Trace 日志
 */

import React from "react";
import { Text, Box } from "ink";
import { useAppContext } from "../../context/AppContext.js";

export function TraceLog(): React.ReactElement {
  const { state } = useAppContext();
  const { traces } = state.debug;

  if (traces.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1} justifyContent="center" alignItems="center">
        <Text dimColor>暂无 trace 日志</Text>
        <Text dimColor>使用 --debug 启动以查看详细追踪</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {traces.slice(-20).map((trace, index) => (
        <Box key={index} flexDirection="row">
          <Text dimColor>[{trace.timestamp}]</Text>
          <Text> {trace.scope}.{trace.phase}</Text>
          {trace.message && <Text dimColor> {trace.message}</Text>}
        </Box>
      ))}
    </Box>
  );
}
