/**
 * SessionInfo - Session 信息面板
 */

import React from "react";
import { Text, Box } from "ink";
import { useAppContext } from "../../context/AppContext.js";

export function SessionInfo(): React.ReactElement {
  const { state } = useAppContext();

  // 从 sessionMetadata 获取真实的 session ID
  // 显示 ID 的后 20 个字符（保留时间戳部分）
  const sessionIdDisplay = state.sessionMetadata.id.length > 20
    ? "..." + state.sessionMetadata.id.slice(-20)
    : state.sessionMetadata.id;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold underline>
        Session
      </Text>
      <Text dimColor>ID:</Text>
      <Text> {sessionIdDisplay}</Text>
      <Text dimColor>Mode:</Text>
      <Text> {state.config.provider}</Text>
      <Text dimColor>Provider:</Text>
      <Text> {state.sessionMetadata.providerId}</Text>
      <Text dimColor>Status:</Text>
      <Text> {state.session.isStreaming ? "running" : "idle"}</Text>
    </Box>
  );
}
