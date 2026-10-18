/**
 * LogsPage - L2 Dedicated Logs Page (双栏 session 维度，磁盘分页)
 */
import React from 'react';
import { Box, Text } from 'ink';
import { wastelandTheme } from '@theme/wasteland/index.js';
import type { LogsView } from './logs-page-utils.js';
export * from './logs-page-utils.js';

import { useLogsPageState } from './logs/useLogsPageState.js';
import { SessionSidebar } from './logs/SessionSidebar.js';
import { LogCardStream } from './logs/LogCardStream.js';
import { LogsBottomBar } from './logs/LogsBottomBar.js';
import { LogsTopBar } from './logs/LogsTopBar.js';
import { LogsTimelineView } from './logs/LogsTimelineView.js';
import { projectTag } from './logs/types.js';

export { projectTag };

export interface LogsPageProps {
  initialView?: LogsView;
  /** 错误卡片展开时显示的前后上下文条数（默认前后各 5 条）。 */
  contextRadius?: number;
  /** 导出文件目录（默认跟选中 session 的项目走；测试可注入临时目录）。 */
  exportDir?: string;
}

export function LogsPage(props: LogsPageProps = {}): React.ReactElement {
  const state = useLogsPageState(props);

  return (
    <Box flexDirection="column" width="100%" height="100%">
      {/* 顶部工具栏 */}
      <LogsTopBar state={state} />

      {/* 主体：左 session 列表 + 右 卡片流 */}
      <Box flexGrow={1} flexDirection="row" width="100%">
        {/* 左栏：Session 列表 */}
        <SessionSidebar
          sessions={state.sessions}
          diskSessionsLoaded={state.diskSessionsLoaded}
          selectedSessionIdx={state.selectedSessionIdx}
          sessionScroll={state.sessionScroll}
          listHeight={state.listHeight}
          leftContentWidth={state.leftContentWidth}
          sessionTag={state.sessionTag}
        />

        {/* 右栏：卡片流 / 时间线 */}
        <Box
          flexDirection="column"
          width="60%"
          paddingLeft={1}
          paddingRight={state.cardScroll.canScrollUp || state.cardScroll.canScrollDown ? 0 : 1}
        >
          {/* 右栏 header */}
          <Box flexDirection="row" justifyContent="space-between" flexShrink={0}>
            <Box flexDirection="row">
              <Text color={wastelandTheme.colors.muted}>
                {state.selectedSessionSummary
                  ? `session: ${state.selectedSessionSummary.sessionId}${state.sessionTag(state.selectedSessionSummary)} (${state.mergedSessionEntries.length} entries${state.liveBuffer.length > 0 ? ` +${state.liveBuffer.length} live` : ''})`
                  : 'session: (none selected)'}
              </Text>
              {state.selectedSessionSummary && (
                <Text color={state.errorCount > 0 ? wastelandTheme.colors.error : wastelandTheme.colors.success}>
                  {' '}[errors={state.errorCount}]
                </Text>
              )}
              {state.liveBuffer.length > 0 && (
                <Text color={wastelandTheme.colors.success}> ●Live</Text>
              )}
            </Box>
            <Text color={wastelandTheme.colors.muted}>
              {state.view === 'timeline' && state.timelineMode === 'global'
                ? state.timelineMetric === 'calls'
                  ? `${state.globalTimelineRecords.length} tool calls (${state.globalSessionEntries.length} sessions)`
                  : `${state.globalStats.length} tools`
                : state.view === 'timeline'
                  ? `${state.timelineRecords.length} tool calls`
                  : state.sessionCards.length > 0
                  ? `${state.cardScroll.offset + 1}-${state.cardScroll.offset + state.cardWindow.length} of ${state.sessionCards.length}`
                  : state.selectedSessionLoading ? 'loading...' : '0 of 0'}
            </Text>
          </Box>

          {/* 加载中 */}
          {state.selectedSessionLoading && (
            <Box>
              <Text color={wastelandTheme.colors.muted}>
                {`Loading session entries... (${state.selectedSessionSummary?.count ?? 0} ${
                  state.selectedSessionSummary?.count === 1 ? 'entry' : 'entries'
                })`}
              </Text>
            </Box>
          )}

          {/* 时间线视图（当前 session / 全局） */}
          {state.view === 'timeline' ? (
            <LogsTimelineView state={state} />
          ) : (
            /* 列表视图：卡片流 */
            <LogCardStream
              sessionCards={state.sessionCards}
              cardWindow={state.cardWindow}
              cardScroll={state.cardScroll}
              rightListHeight={state.rightListHeight}
              selectedCardIdx={state.selectedCardIdx}
              keywordFilter={state.keywordFilter}
              errorFocus={state.errorFocus}
              selectedSessionSummary={state.selectedSessionSummary}
              selectedSessionLoading={state.selectedSessionLoading}
              cardKeyOf={state.cardKeyOf}
            />
          )}
        </Box>
      </Box>

      {/* 底部区：Omnibox 搜索框 或 快捷键提示条 + 导出提示 */}
      <LogsBottomBar
        isSearching={state.isSearching}
        searchDraft={state.searchDraft}
        terminalCols={state.terminalCols}
        helpVisible={state.helpVisible}
        view={state.view}
        timelineMode={state.timelineMode}
        timelineMetric={state.timelineMetric}
        exportStatus={state.exportStatus}
      />
    </Box>
  );
}
