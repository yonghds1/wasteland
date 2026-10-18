import React from 'react';
import { Box, Text } from 'ink';
import { wastelandTheme } from '@theme/wasteland/index.js';
import type { ProjectSessionSummary } from '@core/logger/data-store.js';
import { formatTimeShort, truncate } from '../logs-page-utils.js';
import { truncateToWidth, displayWidth } from '../card-window.js';
import { ScrollableBox, type UseScrollResult } from '../ScrollableBox.js';
import { SESSION_ROW_HEIGHT } from './types.js';

export interface SessionSidebarProps {
  sessions: ProjectSessionSummary[];
  diskSessionsLoaded: boolean;
  selectedSessionIdx: number;
  sessionScroll: UseScrollResult;
  listHeight: number;
  leftContentWidth: number;
  sessionTag: (s: ProjectSessionSummary) => string;
}

export function SessionSidebar({
  sessions,
  diskSessionsLoaded,
  selectedSessionIdx,
  sessionScroll,
  listHeight,
  leftContentWidth,
  sessionTag,
}: SessionSidebarProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      width="40%"
      borderStyle={wastelandTheme.decorations.borderStyle}
      borderTop={false}
      borderBottom={false}
      borderLeft={false}
      borderRight
      borderColor={wastelandTheme.colors.borderDim}
      paddingX={1}
    >
      {/* header（单行：超出左栏宽截断，保证不换行撑屏） */}
      <Box flexDirection="row" flexShrink={0}>
        <Text color={wastelandTheme.colors.muted}>
          {truncateToWidth(
            `${truncate('time range', 20)} | ${truncate('sessionId', 16)} | ${truncate('cnt', 4)} | summary`,
            leftContentWidth
          )}
        </Text>
      </Box>

      {/* 使用 ScrollableBox（固定高度 + 按需滚动条；行高恒 1，窗口数学精确）。
          空态文案渲染进本槽（与列表互斥，槽位本就空闲）：Ink 不裁剪纵向溢出，
          独立 marginTop 块会在 listHeight 之外再加行 → 撑屏，故作为 children 渲染。 */}
      <ScrollableBox
        offset={sessionScroll.offset}
        onOffsetChange={sessionScroll.setOffset}
        totalItems={sessions.length}
        itemHeight={SESSION_ROW_HEIGHT}
        height={listHeight}
        showScrollbar={false}
      >
        {sessions.length === 0 ? (
          <Box flexDirection="row">
            <Text color={wastelandTheme.colors.muted}>
              {truncateToWidth(
                diskSessionsLoaded
                  ? '(no sessions — run a session to generate logs)'
                  : '(loading sessions...)',
                leftContentWidth
              )}
            </Text>
          </Box>
        ) : (
          sessions.map((session, idx) => {
            const isSelected = idx === selectedSessionIdx;
            // 选中行：高亮背景带 + 最亮文本色 + bold + > 前缀（聚焦位置清晰可辨）
            const lineColor = isSelected
              ? wastelandTheme.colors.textEmphasized
              : wastelandTheme.colors.text;
            const lineBg = isSelected
              ? wastelandTheme.colors.backgroundSecondary
              : undefined;
            const indent = isSelected ? '> ' : '  ';
            const timeRange = `${formatTimeShort(session.firstTime)}-${formatTimeShort(session.lastTime)}`;
            const statusIcon = session.hasError ? '✗' : '✓';
            const statusColor = session.hasError
              ? wastelandTheme.colors.error
              : wastelandTheme.colors.success;
            // 单行保证：固定段 53 列（indent 2 + time 20 + 分隔 9 + sid 16 + cnt 4 + icon 1 + 空格 1），
            // 消息与项目标签按显示宽度分配剩余列，超出截断（Ink 会换行，单 Text 行必须事先截到宽度内）。
            const tailBudget = Math.max(0, leftContentWidth - 53);
            const fittedMessage = truncateToWidth(session.lastMessage, Math.min(30, tailBudget));
            const fittedTag = truncateToWidth(
              sessionTag(session),
              Math.max(0, tailBudget - displayWidth(fittedMessage))
            );

            return (
              <Box key={session.sessionId} flexDirection="row">
                <Text color={lineColor} backgroundColor={lineBg} bold={isSelected}>
                  {indent}
                  {truncate(timeRange, 20)}
                  {' | '}
                  {truncate(session.sessionId, 16)}
                  {' | '}
                  {String(session.count).padStart(4)}
                  {' | '}
                  <Text color={statusColor}>{statusIcon}</Text>
                  {' '}
                  {fittedMessage}
                  {fittedTag}
                </Text>
              </Box>
            );
          })
        )}
      </ScrollableBox>
    </Box>
  );
}
