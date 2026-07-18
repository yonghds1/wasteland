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
import { PRIMARY, SECONDARY, MUTED, SUCCESS, WARNING, BACKGROUND_DARKER } from '../utils/colors.js';
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
    <Box flexShrink={0} width={width} paddingX={1} backgroundColor={BACKGROUND_DARKER}>
      <Text color={PRIMARY} bold>{runtime.skin?.ui.banner.title ?? t('tui.header.title')}</Text>
      <Text color={MUTED}>{sep}</Text>
      <Text color={SECONDARY}>{runtime.providerId}</Text>
      <Text color={MUTED}>{sep}</Text>
      <Text color={MUTED}>{t('tui.statusbar.tools', { count: String(toolCount) })}</Text>
      {runningAgents > 0 && (
        <>
          <Text color={MUTED}>{sep}</Text>
          <Text color={SUCCESS}>{t('tui.statusbar.runningAgents', { count: String(runningAgents) })}</Text>
        </>
      )}

      {/* 右侧状态 */}
      <Box flexGrow={1} justifyContent="flex-end">
        {state.session.isThinking && (
          <Text color={WARNING}>{runtime.skin?.ui.messages.thinking ?? t('tui.session.messages.thinking')}</Text>
        )}
        {state.session.isStreaming && (
          <Text color={SUCCESS}>{t('tui.session.messages.streaming')}</Text>
        )}
      </Box>
    </Box>
  );
}
