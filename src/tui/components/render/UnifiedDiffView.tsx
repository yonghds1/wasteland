import React from 'react';
import { Box, Text } from 'ink';
import { wastelandTheme } from '@theme/wasteland/index.js';

export interface UnifiedDiffViewProps {
  diffText: string;
  filename?: string;
  width: number;
}

export function UnifiedDiffView({ diffText, filename, width }: UnifiedDiffViewProps): React.ReactElement {
  const lines = diffText.split('\n');
  const contentWidth = Math.max(10, width - 2);

  // 统计添加和删除的行数
  let addCount = 0;
  let delCount = 0;
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) addCount++;
    else if (line.startsWith('-') && !line.startsWith('---')) delCount++;
  }

  const statTag = `+${addCount} / -${delCount} lines`;
  const headerTitle = filename ? `[diff] ${filename} (${statTag})` : `[diff] ${statTag}`;
  const barLen = Math.max(0, contentWidth - headerTitle.length - 5);
  const topBorder = `┌─ ${headerTitle} ${'─'.repeat(barLen)}┐`;
  const bottomBorder = `└${'─'.repeat(Math.max(0, contentWidth - 2))}┘`;

  return (
    <Box flexDirection="column" width={contentWidth} marginY={0}>
      <Text color={wastelandTheme.colors.muted} dimColor>
        {topBorder.slice(0, contentWidth)}
      </Text>

      {lines.map((line, idx) => {
        let color: string | undefined;
        let bold = false;
        let dim = false;

        if (line.startsWith('+') && !line.startsWith('+++')) {
          color = 'green';
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          color = 'red';
        } else if (line.startsWith('@@')) {
          color = 'cyan';
          dim = true;
        } else if (line.startsWith('---') || line.startsWith('+++')) {
          color = 'yellow';
          bold = true;
        } else {
          dim = true;
        }

        return (
          <Box key={idx} flexDirection="row" width={contentWidth} overflow="hidden">
            <Text color={wastelandTheme.colors.muted} dimColor>
              │{' '}
            </Text>
            <Box flexGrow={1} overflow="hidden">
              <Text color={color} bold={bold} dimColor={dim}>
                {line || ' '}
              </Text>
            </Box>
            <Text color={wastelandTheme.colors.muted} dimColor>
              {' '}│
            </Text>
          </Box>
        );
      })}

      <Text color={wastelandTheme.colors.muted} dimColor>
        {bottomBorder.slice(0, contentWidth)}
      </Text>
    </Box>
  );
}
