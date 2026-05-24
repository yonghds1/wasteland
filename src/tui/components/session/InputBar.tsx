/**
 * InputBar - 输入框
 *
 * 支持输入模式和导航模式切换
 */

import React, { useState } from "react";
import { Text, Box, useInput } from "ink";
import { useAppContext } from "../../context/AppContext.js";

interface InputBarProps {
  width?: number;
  sendMessage?: (content: string) => void;
}

export function InputBar({ width, sendMessage }: InputBarProps): React.ReactElement {
  const [input, setInput] = useState("");
  const { state, setInputMode } = useAppContext();

  // 输入模式下捕获所有按键
  useInput(
    (char, key) => {
      // Esc 取消输入，回到导航模式
      if (key.escape) {
        setInput("");
        setInputMode(false);
        return;
      }

      // Enter 发送消息，保持在输入模式
      if (key.return) {
        if (input.trim()) {
          // 调用 runtime 发送消息
          if (sendMessage) {
            sendMessage(input.trim());
          }
        }
        setInput("");
        // 不退出输入模式，让用户继续输入
        return;
      }

      // Backspace / Delete 删除字符
      if (key.backspace || key.delete) {
        setInput((prev) => prev.slice(0, -1));
        return;
      }

      // Ctrl+C 全局退出（由 App.tsx 处理）
      if (key.ctrl && char === "c") {
        return;
      }

      // 其他字符直接输入
      if (char && !key.ctrl && !key.meta) {
        setInput((prev) => prev + char);
      }
    },
    { isActive: state.inputMode }
  );

  return (
    <Box flexDirection="column" width={width}>
      {/* 模式指示器 */}
      {state.inputMode && (
        <Box paddingX={1}>
          <Text dimColor color="yellow">
            [输入模式] Esc 取消 | Enter 发送
          </Text>
        </Box>
      )}

      {/* 输入框 */}
      <Box flexDirection="row" paddingX={1} width={width}>
        <Text bold color={state.inputMode ? "green" : "cyan"}>
          &gt;{" "}
        </Text>
        <Text>{input}</Text>
        {state.inputMode && <Text dimColor>▌</Text>}
        {!state.inputMode && (
          <Text dimColor>按 Enter 进入输入模式...</Text>
        )}
      </Box>
    </Box>
  );
}
