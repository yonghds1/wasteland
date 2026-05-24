/**
 * DebugPage - 调试页面
 */

import React from "react";
import { Box } from "ink";
import { SessionInfo } from "./SessionInfo.js";
import { TraceLog } from "./TraceLog.js";

interface DebugPageProps {
  height?: number;
}

export function DebugPage({ height }: DebugPageProps): React.ReactElement {
  return (
    <Box flexDirection="row" height={height}>
      <Box width={30} borderStyle="single" flexDirection="column">
        <SessionInfo />
      </Box>
      <Box flexGrow={1} borderStyle="single" flexDirection="column">
        <TraceLog />
      </Box>
    </Box>
  );
}
