/**
 * DebugPage - 调试页面
 */

import React from "react";
import { Box } from "ink";
import { SessionInfo } from "./SessionInfo.js";
import { TraceLog } from "./TraceLog.js";
import { TraceFilter } from "./TraceFilter.js";
import { useAppContext } from "../../context/AppContext.js";

interface DebugPageProps {
  height?: number;
  width?: number;
}

export function DebugPage({ height, width }: DebugPageProps): React.ReactElement {
  const { state, setFilterMode } = useAppContext();
  const infoWidth = 28;
  // Trace 日志宽度 = 总宽度 - Session信息 - 边框
  const traceWidth = width ? width - infoWidth - 4 : undefined;

  // 如果在过滤模式，显示过滤器
  if (state.filterMode) {
    return (
      <Box flexDirection="row" height={height} width={width}>
        {/* 左侧：Session 信息 */}
        <Box width={infoWidth} flexShrink={0} borderStyle="single" borderColor="gray" flexDirection="column">
          <SessionInfo />
        </Box>

        {/* 右侧：过滤器 */}
        <Box flexGrow={1} flexShrink={1} width={traceWidth} borderStyle="single" borderColor="cyan" flexDirection="column">
          <TraceFilter onExit={() => setFilterMode(false)} />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="row" height={height} width={width}>
      {/* 左侧：Session 信息 */}
      <Box
        width={infoWidth}
        flexShrink={0}
        borderStyle="single"
        borderColor={state.focusArea === "sessionInfo" ? "cyan" : "gray"}
        flexDirection="column"
      >
        <SessionInfo />
      </Box>

      {/* 右侧：Trace 日志 - 填充剩余空间 */}
      <Box
        flexGrow={1}
        flexShrink={1}
        width={traceWidth}
        borderStyle="single"
        borderColor={state.focusArea === "traceLog" ? "cyan" : "gray"}
        flexDirection="column"
      >
        <TraceLog height={height} />
      </Box>
    </Box>
  );
}
