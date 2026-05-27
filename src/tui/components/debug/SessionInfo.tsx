/**
 * SessionInfo - Session 信息面板
 *
 * 简化显示：只显示 ID 和大意（首条用户消息）
 */

import React from "react";
import { Text, Box } from "ink";
import { useAppContext } from "../../context/AppContext.js";

export function SessionInfo(): React.ReactElement {
  const { state } = useAppContext();

  // 从 sessionMetadata 获取完整的 session ID
  const sessionId = state.sessionMetadata.id;

  // 获取首条用户消息作为大意
  const firstUserMessage = state.session.messages.find((m) => m.type === "user");
  const summary = firstUserMessage
    ? (firstUserMessage.content.length > 30
        ? firstUserMessage.content.slice(0, 30) + "..."
        : firstUserMessage.content)
    : "(无消息)";

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold underline>
        Session
      </Text>
      <Text dimColor>ID:</Text>
      <Text> {sessionId}</Text>
      <Text dimColor>大意:</Text>
      <Text> {summary}</Text>
    </Box>
  );
}
