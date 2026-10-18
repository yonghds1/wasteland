import React from 'react';
import { Box, Text } from 'ink';
import { wastelandTheme } from '@theme/wasteland/index.js';

export interface MentionPopupProps {
  candidates: string[];
  selectedIndex: number;
  width: number;
}

export function MentionPopup({ candidates, selectedIndex, width }: MentionPopupProps): React.ReactElement | null {
  if (candidates.length === 0) return null;

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="single"
      borderColor={wastelandTheme.colors.secondary}
      paddingX={1}
    >
      <Box marginBottom={0} justifyContent="space-between">
        <Text color={wastelandTheme.colors.secondary} bold>
          @ 引用工作区文件
        </Text>
        <Text color={wastelandTheme.colors.muted} dimColor>
          ↑/↓ 切换 · Tab/Enter 套用 · Esc 取消
        </Text>
      </Box>
      {candidates.map((filePath, idx) => {
        const isSelected = idx === selectedIndex;
        return (
          <Box key={filePath} flexDirection="row" overflow="hidden">
            <Text color={isSelected ? wastelandTheme.colors.primary : wastelandTheme.colors.muted}>
              {isSelected ? '▶ ' : '  '}
            </Text>
            <Text color={isSelected ? wastelandTheme.colors.textEmphasized : wastelandTheme.colors.text} bold={isSelected}>
              📄 {filePath}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
