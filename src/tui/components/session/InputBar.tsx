/**
 * InputBar - 输入框
 *
 * 使用主题系统的 prompt symbol (❯)
 * 输入模式时显示绿色高亮
 * 添加模式指示器（更醒目）
 */

import React, { useState } from "react";
import { Text, Box, useInput } from "ink";
import { useAppContext } from "../../context/AppContext.js";
import {
  PRIMARY,
  SUCCESS,
  SECONDARY,
  PROMPT_SYMBOL,
  STREAMING_CURSOR,
  SEPARATORS,
} from "../../utils/colors.js";

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
      {/* 模式指示器 - 输入模式时显示 */}
      {state.inputMode && (
        <Box paddingX={1} flexDirection="row" gap={1}>
          <Text bold color={SECONDARY}>
            [输入模式]
          </Text>
          <Text dimColor>Esc 取消</Text>
          <Text dimColor>{SEPARATORS.item.trim()}</Text>
          <Text color={SUCCESS}>Enter 发送</Text>
        </Box>
      )}

      {/* 输入框 */}
      <Box flexDirection="row" paddingX={1} width={width}>
        {/* Prompt symbol */}
        <Text bold color={state.inputMode ? SUCCESS : PRIMARY}>
          {PROMPT_SYMBOL}{" "}
        </Text>

        {/* 输入内容 */}
        {input && <Text>{input}</Text>}

        {/* 光标 */}
        {state.inputMode && (
          <Text dimColor>{STREAMING_CURSOR}</Text>
        )}

        {/* 占位提示 */}
        {!state.inputMode && !input && (
          <Text dimColor>按 Enter 进入输入模式...</Text>
        )}
      </Box>
    </Box>
  );
}
