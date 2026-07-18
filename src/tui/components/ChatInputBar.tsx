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

import React, { useState, useEffect } from 'react';
import { Text, Box, useInput } from 'ink';
import { useAppContext } from '../context/AppContext.js';
import { t } from '../../locales/index.js';
import type { Skin } from '../../skins/index.js';
import { PRIMARY, SECONDARY, MUTED, SUCCESS, BORDER_FOCUSED, BORDER_DIM } from '../utils/colors.js';

interface ChatInputBarProps {
  width: number;
  skin?: Skin | null;
  sendMessage: (content: string) => void;
}

export function ChatInputBar({ width, skin, sendMessage }: ChatInputBarProps): React.ReactElement {
  const { state, setInputMode, setFocusArea } = useAppContext();
  const [input, setInput] = useState('');

  // 自动进入输入模式
  useEffect(() => {
    if (!state.inputMode && !state.showHelp && !state.exitConfirmPending) {
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
    if (inputChar && !key.ctrl && !key.meta && inputChar !== '\r' && inputChar !== '\n') {
      setInput((prev) => prev + inputChar);
    }
  });

  const isCommand = input.startsWith('/');
  const lines = input.split('\n');
  const promptColor = isCommand ? SECONDARY : PRIMARY;
  const contentColor = isCommand ? SECONDARY : SUCCESS;
  // 皮肤输入提示符（如 wasteland>）
  const promptSymbol = skin?.ui.prompts.input ?? '❯';
  const promptIndent = ' '.repeat(promptSymbol.length + 1);

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      {/* 输入区(多行) */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderTop
        borderColor={state.inputMode ? BORDER_FOCUSED : BORDER_DIM}
        paddingX={1}
      >
        {input ? (
          lines.map((line, i) => (
            <Box key={i} flexDirection="row">
              <Text color={promptColor} bold>{i === 0 ? `${promptSymbol} ` : promptIndent}</Text>
              <Text color={contentColor}>
                {line}
                {i === lines.length - 1 && <Text color={PRIMARY}>▌</Text>}
              </Text>
            </Box>
          ))
        ) : (
          <Box flexDirection="row">
            <Text color={promptColor} bold>{promptSymbol} </Text>
            <Text color={MUTED}>{t('tui.session.input.placeholder')}</Text>
          </Box>
        )}
      </Box>

      {/* 快捷键提示 */}
      <Box paddingLeft={1}>
        <Text color={MUTED}>{t('tui.session.input.hintMultiline')}</Text>
      </Box>
    </Box>
  );
}
