/**
 * SessionInfo - Session 信息 label
 *
 * 一行显示：Session ID 和摘要
 */

import React from 'react';
import { Text, Box } from 'ink';
import { useAppContext } from '../../context/AppContext.js';
import { SEPARATORS } from '../../utils/colors.js';
import { t } from '../../../locales/index.js';

export function SessionInfo(): React.ReactElement {
  const { state } = useAppContext();

  // 从 sessionMetadata 获取完整的 session ID
  const sessionId = state.sessionMetadata.id;

  // 获取首条用户消息作为摘要
  const firstUserMessage = state.session.messages.find((m) => m.type === 'user');
  const summary = firstUserMessage
    ? firstUserMessage.content.length > 40
      ? firstUserMessage.content.slice(0, 40) + '...'
      : firstUserMessage.content
    : t('tui.debug.noMessages');

  return (
    <Box flexDirection="row" paddingX={1} gap={1}>
      <Text bold color="cyan">
        Session
      </Text>
      <Text dimColor>{SEPARATORS.item.trim()}</Text>
      <Text dimColor>ID:</Text>
      <Text>{sessionId}</Text>
      <Text dimColor>{SEPARATORS.item.trim()}</Text>
      <Text dimColor>{t('tui.debug.summary')}</Text>
      <Text>{summary}</Text>
    </Box>
  );
}
