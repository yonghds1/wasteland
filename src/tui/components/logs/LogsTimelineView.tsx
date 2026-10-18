import React from 'react';
import { Box, Text } from 'ink';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { t } from '@locales/index.js';
import { ToolTimeline } from '../ToolTimeline.js';
import { GlobalTimeline, GlobalStatsTable } from '../GlobalTimeline.js';
import type { LogsPageState } from './types.js';

export function LogsTimelineView({ state }: { state: LogsPageState }): React.ReactElement {
  if (state.selectedSessionLoading) {
    return <></>;
  }

  if (state.timelineMode === 'session') {
    return (
      <ToolTimeline
        records={state.timelineRecords}
        offset={state.timelineScroll.offset}
        onOffsetChange={state.timelineScroll.setOffset}
        height={state.timelineListHeight}
        showScrollbar={state.timelineScroll.canScrollUp || state.timelineScroll.canScrollDown}
        contentWidth={state.timelineContentWidth}
      />
    );
  }

  return (
    <>
      {state.globalTimelineLoading && (
        <Box marginTop={1}>
          <Text color={wastelandTheme.colors.muted}>
            {state.globalLoadProgress
              ? t('tui.globalTimelineLoading', {
                  done: String(state.globalLoadProgress.done),
                  total: String(state.globalLoadProgress.total),
                })
              : t('tui.globalTimelineLoading', { done: '0', total: '…' })}
          </Text>
        </Box>
      )}
      {state.timelineMetric === 'calls' ? (
        <GlobalTimeline
          records={state.globalTimelineRecords}
          offset={state.globalTimelineScroll.offset}
          onOffsetChange={state.globalTimelineScroll.setOffset}
          highlightSessionId={state.sessionFilter.trim() || undefined}
          height={state.timelineListHeight}
          showScrollbar={state.globalTimelineScroll.canScrollUp || state.globalTimelineScroll.canScrollDown}
          contentWidth={state.timelineContentWidth}
        />
      ) : (
        <GlobalStatsTable
          stats={state.globalStats}
          offset={state.globalStatsScroll.offset}
          onOffsetChange={state.globalStatsScroll.setOffset}
          height={state.timelineListHeight}
          showScrollbar={state.globalStatsScroll.canScrollUp || state.globalStatsScroll.canScrollDown}
        />
      )}
    </>
  );
}
