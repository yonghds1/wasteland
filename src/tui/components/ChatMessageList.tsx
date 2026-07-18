/**
 * ChatMessageList - 聊天消息列表
 *
 * OpenCode 风格:author 标签制,去边框,靠颜色与留白区分消息。
 *
 * ## 消息呈现
 *
 * - user / assistant:author 标签(带色) + 内容,消息间留白
 * - tool / 子 Agent:紧凑单行 `⏺ ...`
 * - system:淡色单行
 */

import React from 'react';
import { Text, Box } from 'ink';
import { useAppContext, type Message } from '../context/AppContext.js';
import { t } from '../../locales/index.js';
import { getRoleGreeting, getRoleCatchphrase } from '../../skins/index.js';
import type { Skin } from '../../skins/index.js';
import {
  TEXT,
  MSG_BORDER_USER,
  MSG_BORDER_ASSISTANT,
  MSG_BORDER_TOOL,
  MSG_BORDER_SYSTEM,
  MUTED,
  PRIMARY,
  SECONDARY,
  SUCCESS,
  WARNING,
  STREAMING_CURSOR,
} from '../utils/colors.js';

interface ChatMessageListProps {
  width: number;
  skin?: Skin | null;
}

export function ChatMessageList({ width, skin }: ChatMessageListProps): React.ReactElement {
  const { state } = useAppContext();
  const messages = state.session.messages;

  return (
    <Box flexDirection="column" width={width} paddingX={1}>
      {/* 欢迎消息 */}
      {messages.length === 0 && (
        <Box flexDirection="column" alignItems="center" justifyContent="center" paddingY={2}>
          <Text color={PRIMARY} bold>
            {skin ? getRoleGreeting(skin, 'main') : t('tui.session.messages.welcome')}
          </Text>
          {skin && (
            <Text color={SECONDARY}>{getRoleCatchphrase(skin, 'main')}</Text>
          )}
          <Text color={MUTED}>
            {t('tui.session.messages.chatStartHint')}
          </Text>
        </Box>
      )}

      {/* 消息列表 */}
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} width={width} skin={skin} />
      ))}

      {/* 流式输出 */}
      {state.session.isStreaming && state.session.streamingContent && (
        <Box flexDirection="column" width={width} marginTop={1}>
          <Text color={SECONDARY} bold>
            {skin?.ui.labels.assistant ?? t('tui.session.messages.assistant')}
          </Text>
          <Text color={TEXT}>
            {state.session.streamingContent}
            <Text color={STREAMING_CURSOR}>▊</Text>
          </Text>
        </Box>
      )}

      {/* 思考状态 */}
      {state.session.isThinking && !state.session.isStreaming && (
        <Box marginTop={1}>
          <Text color={WARNING}>⏳ {skin?.ui.messages.thinking ?? t('tui.session.messages.thinking')}</Text>
        </Box>
      )}
    </Box>
  );
}

// ============================================================
// 消息项组件
// ============================================================

interface MessageItemProps {
  message: Message;
  width: number;
  skin?: Skin | null;
}

function MessageItem({ message, width, skin }: MessageItemProps): React.ReactElement {
  const labelColor = getMessageColor(message.type);
  const label = getMessageLabel(message.type, skin);

  // 工具消息 & 子 Agent 系统消息:紧凑单行(opencode 风格)
  if (message.type === 'tool' || (message.type === 'system' && message.content.startsWith('['))) {
    return (
      <Box width={width}>
        <Text color={MUTED}>  ⏺ </Text>
        <Text color={getToolColor(message.content)}>{message.content}</Text>
      </Box>
    );
  }

  // 普通系统消息:淡色单行
  if (message.type === 'system') {
    return (
      <Box width={width} marginTop={1}>
        <Text color={MUTED}>  {message.content}</Text>
      </Box>
    );
  }

  // user / assistant:author 标签 + 内容
  return (
    <Box flexDirection="column" width={width} marginTop={1}>
      <Text color={labelColor} bold>
        {label}
      </Text>
      <Text color={TEXT}>{message.content}</Text>
    </Box>
  );
}

// ============================================================
// 辅助函数
// ============================================================

function getMessageColor(type: Message['type']): string {
  switch (type) {
    case 'user':
      return MSG_BORDER_USER;
    case 'assistant':
      return MSG_BORDER_ASSISTANT;
    case 'tool':
      return MSG_BORDER_TOOL;
    case 'system':
      return MSG_BORDER_SYSTEM;
    default:
      return MUTED;
  }
}

function getMessageLabel(type: Message['type'], skin?: Skin | null): string {
  switch (type) {
    case 'user':
      return skin?.ui.labels.user ?? t('tui.session.messages.user');
    case 'assistant':
      return skin?.ui.labels.assistant ?? t('tui.session.messages.assistant');
    case 'tool':
      return t('tui.session.messages.tool');
    case 'system':
      return skin?.ui.labels.system ?? t('tui.session.messages.system');
    default:
      return t('tui.session.messages.message');
  }
}

function getToolColor(content: string): string {
  if (content.includes('✅') || content.includes('success')) {
    return SUCCESS;
  }
  if (content.includes('❌') || content.includes('error')) {
    return WARNING;
  }
  if (content.includes('🔧')) {
    return PRIMARY;
  }
  return MUTED;
}
