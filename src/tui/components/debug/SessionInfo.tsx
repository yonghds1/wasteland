/**
 * SessionInfo - Session 信息面板
 */

import React from "react";
import { Text, Box } from "ink";
import { useAppContext } from "../../context/AppContext.js";

export function SessionInfo(): React.ReactElement {
  const { state } = useAppContext();

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold underline>
        Session
      </Text>
      <Text dimColor>ID:</Text>
      <Text> 2026-05-24_demo</Text>
      <Text dimColor>Mode:</Text>
      <Text> {state.config.provider}</Text>
      <Text dimColor>Provider:</Text>
      <Text> local</Text>
      <Text dimColor>Status:</Text>
      <Text> {state.session.isStreaming ? "running" : "idle"}</Text>
    </Box>
  );
}
