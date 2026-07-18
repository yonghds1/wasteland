/**
 * ChatArea - 单聊天区域
 *
 * OpenCode 风格的单视口界面，所有内容在一个可滚动区域。
 *
 * ## 布局
 *
 * ```
 * ┌─────────────────────────────────────────────────────────┐
 * │ StatusBar (顶部状态栏)                                   │
 * ├─────────────────────────────────────────────────────────┤
 * │                                                         │
 * │  MessageList (消息列表)                                  │
 * │                                                         │
 * ├─────────────────────────────────────────────────────────┤
 * │ InputBar (输入框)                                        │
 * └─────────────────────────────────────────────────────────┘
 * ```
 */

import React from 'react';
import { Box, useStdout } from 'ink';
import { StatusBar } from './StatusBar.js';
import { ChatMessageList } from './ChatMessageList.js';
import { ChatInputBar } from './ChatInputBar.js';
import type { TuiRuntimeContext } from '../types.js';

interface ChatAreaProps {
  runtime: TuiRuntimeContext;
  sendMessage: (content: string) => void;
}

export function ChatArea({ runtime, sendMessage }: ChatAreaProps): React.ReactElement {
  const { stdout } = useStdout();
  const terminalRows = stdout?.rows ?? 24;
  const terminalColumns = stdout?.columns ?? 80;

  return (
    <Box flexDirection="column" width={terminalColumns} height={terminalRows}>
      {/* 顶部状态栏(固定高度) */}
      <StatusBar width={terminalColumns} runtime={runtime} />

      {/* 消息列表(占剩余空间) */}
      <Box flexGrow={1} width={terminalColumns} overflow="hidden">
        <ChatMessageList width={terminalColumns} skin={runtime.skin} />
      </Box>

      {/* 底部输入框(自然高度) */}
      <ChatInputBar width={terminalColumns} skin={runtime.skin} sendMessage={sendMessage} />
    </Box>
  );
}
