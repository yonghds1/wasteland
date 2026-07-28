/**
 * ChatInputBar - 聊天输入框
 *
 * OpenCode 风格多行输入:Shift/Alt+Enter 换行,Enter 发送。
 *
 * ## 快捷键
 *
 * - Enter: 发送消息
 * - Shift/Alt+Enter: 换行
 * - Esc: 取消输入
 */

import React, { useState, useEffect, useRef } from 'react';
import { Text, Box, useInput } from 'ink';
import { useAppContext } from '../context/AppContext.js';
import { t } from '../../locales/index.js';
import { wastelandTheme } from '../../theme/wasteland/index.js';

interface ChatInputBarProps {
  width: number;
  sendMessage: (content: string) => void;
}

export function ChatInputBar({ width, sendMessage }: ChatInputBarProps): React.ReactElement {
  const { state, setInputMode, setFocusArea } = useAppContext();
  const [input, setInput] = useState('');

  // 自动进入输入模式（但用户按 Esc 主动退出后不自动拉回，需按 Enter 重新进入）
  const prevInputModeRef = useRef(state.inputMode);
  useEffect(() => {
    const wasInputMode = prevInputModeRef.current;
    prevInputModeRef.current = state.inputMode;

    if (!state.inputMode && !state.showHelp && !state.exitConfirmPending) {
      // inputMode 刚从 true 变 false（用户主动 Esc 退出）时不自动拉回
      if (wasInputMode) {
        return;
      }
      setFocusArea('inputBar');
      setInputMode(true);
    }
  }, [state.inputMode, state.showHelp, state.exitConfirmPending]);

  useInput((inputChar, key) => {
    // 只在输入模式时处理
    if (!state.inputMode) {
      return;
    }

    // Enter:Shift/Alt+Enter 换行,否则发送
    if (key.return) {
      if (key.shift || key.meta) {
        setInput((prev) => prev + '\n');
      } else if (input.trim()) {
        sendMessage(input);
        setInput('');
      }
      return;
    }

    // Esc 退出输入模式
    if (key.escape) {
      setInputMode(false);
      setFocusArea(null);
      return;
    }

    // Backspace 删除末字符(含换行)
    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
      return;
    }

    // 普通字符输入(保留 Shift 以支持大写,Enter 已在上方拦截)
    if (
      inputChar &&
      !key.ctrl &&
      !key.meta &&
      inputChar !== '\r' &&
      inputChar !== '\n' &&
      !key.tab
    ) {
      setInput((prev) => prev + inputChar);
    }
  });

  const isCommand = input.startsWith('/');
  const lines = input.split('\n');
  const promptColor = isCommand ? wastelandTheme.colors.secondary : wastelandTheme.colors.primary;
  const contentColor = isCommand ? wastelandTheme.colors.secondary : wastelandTheme.colors.success;
  // 主题输入提示符
  const promptSymbol = wastelandTheme.decorations.prompt;
  const promptIndent = ' '.repeat(promptSymbol.length + 1);

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      {/* 输入区(多行) */}
      <Box
        flexDirection="column"
        borderStyle={wastelandTheme.decorations.borderStyle}
        borderTop
        borderColor={
          state.inputMode ? wastelandTheme.colors.borderFocused : wastelandTheme.colors.borderDim
        }
        paddingX={1}
      >
        {input ? (
          lines.map((line, i) => (
            <Box key={i} flexDirection="row">
              <Text color={promptColor} bold>
                {i === 0 ? `${promptSymbol} ` : promptIndent}
              </Text>
              <Text color={contentColor}>
                {line}
                {i === lines.length - 1 && (
                  <Text color={wastelandTheme.colors.primary}>
                    {wastelandTheme.decorations.streamingCursor}
                  </Text>
                )}
              </Text>
            </Box>
          ))
        ) : (
          <Box flexDirection="row">
            <Text color={promptColor} bold>
              {promptSymbol}{' '}
            </Text>
            <Text color={wastelandTheme.colors.muted}>{t('tui.session.input.placeholder')}</Text>
          </Box>
        )}
      </Box>

      {/* 快捷键提示 */}
      <Box paddingLeft={1}>
        <Text color={wastelandTheme.colors.muted}>{t('tui.session.input.hintMultiline')}</Text>
      </Box>
    </Box>
  );
}
