/**
 * InputBar - 输入框
 *
 * 使用主题系统的 prompt symbol (❯)
 * 焦点时自动进入输入模式
 */

import React, { useState, useEffect } from "react";
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
import { t } from "../../../locales/index.js";

interface InputBarProps {
  width?: number;
  sendMessage?: (content: string) => void;
}

export function InputBar({ width, sendMessage }: InputBarProps): React.ReactElement {
  const [input, setInput] = useState("");
  const { state, setInputMode } = useAppContext();
  const isFocused = state.focusArea === "inputBar";

  // 焦点切换到 inputBar 时自动进入输入模式
  useEffect(() => {
    if (isFocused && !state.inputMode) {
      setInputMode(true);
    }
  }, [isFocused, state.inputMode, setInputMode]);

  // 焦点离开 inputBar 时退出输入模式（但保留输入内容）
  useEffect(() => {
    if (!isFocused && state.inputMode) {
      setInputMode(false);
    }
  }, [isFocused, state.inputMode, setInputMode]);

  // 输入模式下捕获按键（Tab 和 Esc 由 App.tsx 处理）
  useInput(
    (char, key) => {
      // Enter 发送消息
      if (key.return) {
        if (input.trim() && sendMessage) {
          sendMessage(input.trim());
          setInput("");
        }
        return;
      }

      // Backspace / Delete 删除字符
      if (key.backspace || key.delete) {
        setInput((prev) => prev.slice(0, -1));
        return;
      }

      // Ctrl+C 由 App.tsx 处理

      // 其他字符直接输入
      if (char && !key.ctrl && !key.meta && !key.tab && !key.escape) {
        setInput((prev) => prev + char);
      }
    },
    { isActive: state.inputMode }
  );

  return (
    <Box flexDirection="column" width={width}>
      {/* 输入框 */}
      <Box flexDirection="row" paddingX={1} width={width}>
        <Text bold color={state.inputMode ? SUCCESS : isFocused ? "cyan" : PRIMARY}>
          {PROMPT_SYMBOL}{" "}
        </Text>
        {input && <Text>{input}</Text>}
        {state.inputMode && <Text dimColor>{STREAMING_CURSOR}</Text>}
        {!state.inputMode && !input && !isFocused && (
          <Text dimColor>{t("tui.session.input.tabPlaceholder")}</Text>
        )}
      </Box>
    </Box>
  );
}
