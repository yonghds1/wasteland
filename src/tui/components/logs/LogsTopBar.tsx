import React from 'react';
import { Box, Text } from 'ink';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { t } from '@locales/index.js';
import type { LogsPageState } from './types.js';

export function LogsTopBar({ state }: { state: LogsPageState }): React.ReactElement {
  return (
    <Box
      flexDirection="row"
      flexShrink={0}
      paddingX={1}
      borderStyle="single"
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      borderBottomColor={wastelandTheme.colors.borderFocused}
      justifyContent="space-between"
    >
      <Box flexDirection="row">
        <Text color={wastelandTheme.colors.primary} bold>
          {wastelandTheme.displayName}
        </Text>
        <Text color={wastelandTheme.colors.muted}>
          {' · '}
          Logs
        </Text>

        <Box flexDirection="row" marginLeft={2}>
          <Box marginRight={1}>
            <Text
              color={state.activeTab === 'history' ? wastelandTheme.colors.primary : wastelandTheme.colors.text}
              bold={state.activeTab === 'history'}
            >
              {state.activeTab === 'history' ? '▶ ' : ''}[历史日志{state.view === 'list' ? `·${state.sessionCards.length}` : ''}]
            </Text>
          </Box>
          <Box marginRight={1}>
            <Text
              color={state.activeTab === 'timeline' ? wastelandTheme.colors.primary : wastelandTheme.colors.text}
              bold={state.activeTab === 'timeline'}
            >
              {state.activeTab === 'timeline' ? '▶ ' : ''}[调用时序{state.view === 'timeline' && state.timelineMode === 'session' ? `·${state.timelineRecords.length}` : ''}]
            </Text>
          </Box>
          <Box marginRight={1}>
            <Text
              color={state.activeTab === 'insights' ? wastelandTheme.colors.primary : wastelandTheme.colors.text}
              bold={state.activeTab === 'insights'}
            >
              {state.activeTab === 'insights' ? '▶ ' : ''}[全局分析{state.activeTab === 'insights' ? `·${state.globalStats.length}` : ''}]
            </Text>
          </Box>
          <Text color={wastelandTheme.colors.muted} dimColor>
            (Alt+1~3 切换)
          </Text>
        </Box>
      </Box>

      {/* 右侧：过滤状态 Tags */}
      <Box flexDirection="row" gap={1}>
        {state.minLevel !== 'info' && <Text color={wastelandTheme.colors.warning}>[L:{state.minLevel}]</Text>}
        {state.sessionFilter && <Text color={wastelandTheme.colors.primary}>[S:{state.sessionFilter}]</Text>}
        {state.errorFocus && <Text color={wastelandTheme.colors.error} bold>[🛑 ErrorOnly]</Text>}
        {state.keywordFilter && <Text color={wastelandTheme.colors.success}>[🔍 {state.keywordFilter}]</Text>}
        {state.showConversation && <Text color={wastelandTheme.colors.secondary}>[{t('tui.conversationBadge')}]</Text>}
      </Box>
    </Box>
  );
}
