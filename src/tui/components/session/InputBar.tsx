/**
 * InputBar - 输入框
 */

import React, { useState } from "react";
import { Text, Box, useInput } from "ink";
import { useAppContext } from "../../context/AppContext.js";

export function InputBar(): React.ReactElement {
  const [input, setInput] = useState("");
  const { state } = useAppContext();

  // 在会话页面捕获输入
  useInput(
    (char, key) => {
      if (key.return) {
        // 发送消息（TODO: 实际发送逻辑）
        setInput("");
        return;
      }

      if (key.backspace || key.delete) {
        setInput((prev) => prev.slice(0, -1));
        return;
      }

      if (char && !key.ctrl && !key.meta) {
        setInput((prev) => prev + char);
      }
    },
    { isActive: state.currentPage === "session" }
  );

  return (
    <Box flexDirection="row" paddingX={1}>
      <Text bold color="cyan">&gt; </Text>
      <Text>{input}</Text>
      <Text dimColor>▌</Text>
    </Box>
  );
}
