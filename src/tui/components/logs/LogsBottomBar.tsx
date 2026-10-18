import React from 'react';
import { Box, Text } from 'ink';
import { wastelandTheme } from '@theme/wasteland/index.js';
import type { LogsView, TimelineMode, TimelineMetric } from '../logs-page-utils.js';
import { getShortcutHelp } from '../logs-page-utils.js';
import { truncateToWidth, displayWidth } from '../card-window.js';
import { SEARCH_HINT } from './types.js';

export interface LogsBottomBarProps {
  isSearching: boolean;
  searchDraft: string;
  terminalCols: number;
  helpVisible: boolean;
  view: LogsView;
  timelineMode: TimelineMode;
  timelineMetric: TimelineMetric;
  exportStatus?: string | null;
}

export function LogsBottomBar({
  isSearching,
  searchDraft,
  terminalCols,
  helpVisible,
  view,
  timelineMode,
  timelineMetric,
  exportStatus,
}: LogsBottomBarProps): React.ReactElement {
  return (
    <>
      {/* 导出状态行：最近一次导出的结果（成功含保存路径） */}
      {exportStatus && (
        <Box flexShrink={0} paddingX={1}>
          <Text
            color={
              exportStatus.startsWith('✓')
                ? wastelandTheme.colors.success
                : wastelandTheme.colors.error
            }
          >
            {truncateToWidth(exportStatus, Math.max(1, terminalCols - 2))}
          </Text>
        </Box>
      )}

      {/* 底部区：Omnibox 搜索框 或 快捷键提示条 */}
      {isSearching ? (
        <Box
          flexShrink={0}
          borderStyle={wastelandTheme.decorations.borderStyle}
          borderBottom
          borderTop
          borderLeft={false}
          borderRight={false}
          borderColor={wastelandTheme.colors.borderFocused}
          backgroundColor={wastelandTheme.colors.borderFocused}
          paddingX={1}
          flexDirection="row"
        >
          <Text color={wastelandTheme.colors.text} bold>
            {truncateToWidth(`/search ${searchDraft}_`, terminalCols - 2 - displayWidth(SEARCH_HINT))}
          </Text>
          <Text color={wastelandTheme.colors.muted}>{SEARCH_HINT}</Text>
        </Box>
      ) : (
        <Box
          flexShrink={0}
          borderStyle={wastelandTheme.decorations.borderStyle}
          borderBottom
          borderTop
          borderLeft={false}
          borderRight={false}
          borderColor={wastelandTheme.colors.borderDim}
          paddingX={1}
          flexDirection="column"
        >
          {helpVisible ? (
            <>
              <Text color={wastelandTheme.colors.muted}>
                {getShortcutHelp(view, timelineMode, timelineMetric)
                  .map((h) => `${h.keys} ${h.description}`)
                  .join(' · ')}
              </Text>
              <Text color={wastelandTheme.colors.muted}>
                [help on] · ? 隐藏 · / 搜索
              </Text>
            </>
          ) : (
            <Text color={wastelandTheme.colors.muted}>
              [help off] · ? 显示快捷键 · / 搜索 · Esc 返回
            </Text>
          )}
        </Box>
      )}
    </>
  );
}
