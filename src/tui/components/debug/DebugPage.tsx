/**
 * DebugPage - 调试页面
 */

import React from "react";
import { Text, Box } from "ink";
import { SessionInfo } from "./SessionInfo.js";
import { TraceLog } from "./TraceLog.js";

export function DebugPage(): React.ReactElement {
  return (
    <Box flexDirection="row" height="100%">
      <Box width={30} borderStyle="single" flexDirection="column">
        <SessionInfo />
      </Box>
      <Box flexGrow={1} borderStyle="single" flexDirection="column">
        <TraceLog />
      </Box>
    </Box>
  );
}
