/**
 * Header - 顶部状态栏 + Tab 导航
 *
 * 参考 OpenCode 的设计：
 * - 使用主题系统的颜色
 * - 添加 Session 标识
 * - 流式状态指示器更醒目
 */

import React from 'react';
import { Text, Box } from 'ink';
import { useAppContext, type PageName } from '../../context/AppContext.js';
import {
  PRIMARY,
  BORDER,
  MUTED,
  SEPARATORS,
  BACKGROUND_DARKER,
  BORDER_FOCUSED,
  BORDER_DIM,
} from '../../utils/colors.js';
import { t } from '../../../locales/index.js';

interface HeaderProps {
  width?: number;
}

export function Header({ width }: HeaderProps): React.ReactElement {
  const { state } = useAppContext();

  // Tab 配置
  const TABS: { name: PageName; label: string; key: string }[] = [
    { name: 'session', label: t('tui.header.session'), key: '1' },
    { name: 'debug', label: t('tui.header.debug'), key: '2' },
    { name: 'config', label: t('tui.header.guide'), key: '3' },
  ];

  const now = new Date();
  const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

  // Session ID 缩短显示
  const sessionId = state.sessionMetadata.id;
  const shortSessionId = sessionId.length > 16 ? `${sessionId.slice(0, 16)}...` : sessionId;

  // 焦点状态
  const isFocused = state.focusArea === 'header';
  const borderColor = isFocused ? BORDER_FOCUSED : BORDER_DIM;

  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      width={width}
      paddingX={1}
      borderStyle="single"
      borderBottom
      borderColor={borderColor}
    >
      {/* 左侧：标题 + Tab 导航 */}
      <Box flexDirection="row" gap={1}>
        {/* 标题 */}
        <Text bold color={PRIMARY}>
          {t('tui.header.title')}
        </Text>
        <Text color={MUTED}>v0.1.0</Text>

        {/* 分隔符 */}
        <Text color={BORDER}>{SEPARATORS.vertical}</Text>

        {/* Tab 导航 */}
        <Box flexDirection="row" gap={1}>
          {TABS.map((tab) => {
            const isActive = state.currentPage === tab.name;
            return (
              <Box key={tab.name} flexDirection="row">
                {isActive ? (
                  <Text bold color={PRIMARY}>
                    [{tab.label}]
                  </Text>
                ) : (
                  <Text color="gray">{tab.label}</Text>
                )}
                <Text dimColor color="gray">
                  {tab.key}
                </Text>
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* 右侧：Session + 状态 + 时间 */}
      <Box flexDirection="row" gap={1}>
        {/* Session 标识 */}
        <Text color={MUTED}>Session:</Text>
        <Text dimColor>{shortSessionId}</Text>

        {/* 分隔符 */}
        <Text color={BORDER}>{SEPARATORS.vertical}</Text>

        {/* 流式状态指示器 */}
        {state.session.isStreaming ? (
          <Text bold color="green">●</Text>
        ) : (
          <Text color="gray">○</Text>
        )}

        {/* 时间 */}
        <Text dimColor>{time}</Text>
      </Box>
    </Box>
  );
}
