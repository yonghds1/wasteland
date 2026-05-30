/**
 * InputBar - 输入框
 *
 * 使用主题系统的 prompt symbol (❯)
 * 焦点时自动进入输入模式
 */

import React, { useState } from 'react';
import { Text, Box, useInput } from 'ink';
import { useAppContext } from '../../context/AppContext.js';
import { PRIMARY, SUCCESS, PROMPT_SYMBOL, STREAMING_CURSOR } from '../../utils/colors.js';
import { t } from '../../../locales/index.js';

interface InputBarProps {
  width?: number;
  sendMessage?: (content: string) => void;
}

export function InputBar({ width, sendMessage }: InputBarProps): React.ReactElement {
  const [input, setInput] = useState('');
  const { state, setInputMode: _setInputMode, setFocusArea: _setFocusArea } = useAppContext();
  const isFocused = state.focusArea === 'inputBar';

  // 输入模式下捕获按键（Tab 和 Esc 由 App.tsx 处理）
  useInput(
    (char, key) => {
      // Ctrl+Enter 或 Enter 发送消息
      if (key.return) {
        // 如果是输入模式，Ctrl+Enter 发送
        if (key.ctrl || !input.trim()) {
          if (input.trim() && sendMessage) {
            sendMessage(input.trim());
            setInput('');
            // 发送后如果是 Ctrl+Enter 保持输入模式，普通 Enter (如果没内容) 退出？
            // PRD: Ctrl+Enter 发送。
          }
          return;
        }

        // 普通 Enter 在有内容时也发送
        if (input.trim() && sendMessage) {
          sendMessage(input.trim());
          setInput('');
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
    { isActive: state.inputMode && isFocused }
  );

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="single"
      borderTop
      borderColor={isFocused ? 'cyan' : 'gray'}
    >
      {/* 输入框 */}
      <Box flexDirection="row" paddingX={1} width={width}>
        <Text bold color={state.inputMode ? SUCCESS : isFocused ? 'cyan' : PRIMARY}>
          {PROMPT_SYMBOL}{' '}
        </Text>
        {input && <Text>{input}</Text>}
        {state.inputMode && <Text dimColor>{STREAMING_CURSOR}</Text>}
        {!state.inputMode && !input && (
          <Text dimColor>
            {isFocused
              ? t('tui.session.input.ctrlEnterHint')
              : t('tui.session.input.tabPlaceholder')}
          </Text>
        )}
      </Box>
    </Box>
  );
}
