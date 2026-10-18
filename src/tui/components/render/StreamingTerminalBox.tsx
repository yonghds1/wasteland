import React from 'react';
import { Box, Text } from 'ink';
import { wastelandTheme } from '@theme/wasteland/index.js';

export interface StreamingTerminalBoxProps {
  command: string;
  status: 'running' | 'success' | 'failed';
  tailLines?: string[];
  durationMs?: number;
  width: number;
  expanded?: boolean;
}

export function StreamingTerminalBox({
  command,
  status,
  tailLines = [],
  durationMs,
  width,
  expanded = false,
}: StreamingTerminalBoxProps): React.ReactElement {
  const contentWidth = Math.max(10, width - 2);

  const statusIcon =
    status === 'running' ? '⟳' : status === 'success' ? '✓' : '✗';
  const statusColor =
    status === 'running'
      ? wastelandTheme.colors.warning
      : status === 'success'
        ? wastelandTheme.colors.success
        : wastelandTheme.colors.error;

  const durationStr = durationMs !== undefined ? ` · ${durationMs}ms` : '';
  const header = `${statusIcon} $ ${command}${durationStr}`;

  if (!expanded && status !== 'running') {
    // 紧凑完成徽章
    return (
      <Box flexDirection="row" width={contentWidth} height={1}>
        <Text color={statusColor} bold>
          {header}
        </Text>
      </Box>
    );
  }

  // 运行中或展开态：展示带边框的终端盒
  const barLen = Math.max(0, contentWidth - header.length - 5);
  const topBorder = `┌─ ${header} ${'─'.repeat(barLen)}┐`;
  const bottomBorder = `└${'─'.repeat(Math.max(0, contentWidth - 2))}┘`;

  const visibleLines = expanded ? tailLines : tailLines.slice(-3);

  return (
    <Box flexDirection="column" width={contentWidth} marginY={0}>
      <Text color={statusColor} bold>
        {topBorder.slice(0, contentWidth)}
      </Text>

      {visibleLines.length === 0 ? (
        <Box flexDirection="row" width={contentWidth}>
          <Text color={wastelandTheme.colors.muted} dimColor>
            │ (waiting for output...)
          </Text>
        </Box>
      ) : (
        visibleLines.map((line, idx) => (
          <Box key={idx} flexDirection="row" width={contentWidth} overflow="hidden">
            <Text color={wastelandTheme.colors.muted} dimColor>
              │{' '}
            </Text>
            <Box flexGrow={1} overflow="hidden">
              <Text color={wastelandTheme.colors.text} dimColor={status !== 'running'}>
                {line}
              </Text>
            </Box>
            <Text color={wastelandTheme.colors.muted} dimColor>
              {' '}│
            </Text>
          </Box>
        ))
      )}

      <Text color={statusColor} dimColor>
        {bottomBorder.slice(0, contentWidth)}
      </Text>
    </Box>
  );
}
