/**
 * MessageList - 消息列表
 */

import React from "react";
import { Text, Box } from "ink";
import { useAppContext } from "../../context/AppContext.js";

const TYPE_COLORS: Record<string, string> = {
  user: "cyan",
  assistant: "green",
  tool: "magenta",
  system: "gray",
};

export function MessageList(): React.ReactElement {
  const { state } = useAppContext();
  const { messages } = state.session;

  if (messages.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1} justifyContent="center" alignItems="center">
        <Text dimColor>等待输入...</Text>
        <Text dimColor>按 Tab 切换页面，按 q 退出</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {messages.map((msg) => (
        <Box key={msg.id} flexDirection="row" marginBottom={1}>
          <Text dimColor>[{msg.timestamp}]</Text>
          <Text color={TYPE_COLORS[msg.type]}> [{msg.type}]</Text>
          <Text> {msg.content}</Text>
        </Box>
      ))}
    </Box>
  );
}
