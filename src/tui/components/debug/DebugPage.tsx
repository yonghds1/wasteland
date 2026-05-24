/**
 * DebugPage - 调试页面
 */

import React from "react";
import { Box } from "ink";
import { SessionInfo } from "./SessionInfo.js";
import { TraceLog } from "./TraceLog.js";

export function DebugPage({ height }: { height?: number }): React.ReactElement {
  const infoWidth = 28;

  return (
    <Box flexDirection="row" height={height}>
      {/* 左侧：Session 信息 */}
      <Box width={infoWidth} borderStyle="single" borderColor="gray" flexDirection="column">
        <SessionInfo />
      </Box>

      {/* 右侧：Trace 日志 - 填充剩余空间 */}
      <Box flexGrow={1} borderStyle="single" borderColor="gray" flexDirection="column">
        <TraceLog height={height} />
      </Box>
    </Box>
  );
}
