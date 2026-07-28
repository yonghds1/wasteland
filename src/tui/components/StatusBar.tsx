/**
 * StatusBar - 顶部状态栏
 *
 * OpenCode 风格:暗背景,文字 + ` · ` 分隔,无 emoji。
 *
 * ## 显示内容
 *
 * wasteland · model · N tools · N agents        thinking/streaming
 */

import React from 'react';
import { Text, Box } from 'ink';
import { useAppContext } from '../context/AppContext.js';
import { t } from '../../locales/index.js';
import { wastelandTheme } from '../../theme/wasteland/index.js';
import type { TuiRuntimeContext } from '../types.js';

interface StatusBarProps {
  width: number;
  runtime: TuiRuntimeContext;
}

export function StatusBar({ width, runtime }: StatusBarProps): React.ReactElement {
  const { state } = useAppContext();
  const toolCount = state.session.tools.length;
  const runningAgents = state.session.agents.filter((a) => a.status === 'running').length;
  const sep = ' · ';

  return (
    <Box
      flexShrink={0}
      width={width}
      paddingX={1}
      backgroundColor={wastelandTheme.colors.backgroundDarker}
    >
      <Text color={wastelandTheme.colors.primary} bold>
        {t(runtime.skin.roleUi.labelKey)}
      </Text>
      <Text color={wastelandTheme.colors.muted}>{sep}</Text>
      <Text color={wastelandTheme.colors.secondary}>{runtime.providerId}</Text>
      <Text color={wastelandTheme.colors.muted}>{sep}</Text>
      <Text color={wastelandTheme.colors.muted}>
        {t('tui.statusbar.tools', { count: String(toolCount) })}
      </Text>
      {runningAgents > 0 && (
        <>
          <Text color={wastelandTheme.colors.muted}>{sep}</Text>
          <Text color={wastelandTheme.colors.success}>
            {t('tui.statusbar.runningAgents', { count: String(runningAgents) })}
          </Text>
        </>
      )}

      {/* 右侧状态 */}
      <Box flexGrow={1} justifyContent="flex-end">
        {state.session.isThinking && (
          <Text color={wastelandTheme.colors.warning}>{t(runtime.skin.roleUi.thinkingKey)}</Text>
        )}
        {state.session.isStreaming && (
          <Text color={wastelandTheme.colors.success}>{t('tui.session.messages.streaming')}</Text>
        )}
      </Box>
    </Box>
  );
}
