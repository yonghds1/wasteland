import React from 'react';
import { Box, Text } from 'ink';
import { wastelandTheme } from '@theme/wasteland/index.js';
import type { CompletionItem } from '../command-completion.js';

export interface CommandPalettePopupProps {
  candidates: CompletionItem[];
  selectedIndex: number;
  width: number;
}

export function CommandPalettePopup({
  candidates,
  selectedIndex,
  width,
}: CommandPalettePopupProps): React.ReactElement | null {
  if (candidates.length === 0) return null;

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="single"
      borderColor={wastelandTheme.colors.primary}
      paddingX={1}
    >
      <Box marginBottom={0} justifyContent="space-between">
        <Text color={wastelandTheme.colors.primary} bold>
          / 斜杠命令面板
        </Text>
        <Text color={wastelandTheme.colors.muted} dimColor>
          ↑/↓ 切换 · Tab/Enter 套用 · Esc 取消
        </Text>
      </Box>
      {candidates.map((cmd, idx) => {
        const isSelected = idx === selectedIndex;
        const aliases = cmd.aliases && cmd.aliases.length > 0 ? ` (${cmd.aliases.map((a) => `/${a}`).join(', ')})` : '';
        return (
          <Box key={cmd.name} flexDirection="row" justifyContent="space-between" overflow="hidden">
            <Box flexDirection="row" flexShrink={0}>
              <Text color={isSelected ? wastelandTheme.colors.primary : wastelandTheme.colors.muted}>
                {isSelected ? '▶ ' : '  '}
              </Text>
              <Text
                color={isSelected ? wastelandTheme.colors.textEmphasized : wastelandTheme.colors.primary}
                bold={isSelected}
              >
                /{cmd.name}
              </Text>
              <Text color={wastelandTheme.colors.muted} dimColor>
                {aliases}
              </Text>
            </Box>
            {cmd.description ? (
              <Box flexShrink={1} marginLeft={2}>
                <Text color={wastelandTheme.colors.muted} dimColor wrap="truncate">
                  {cmd.description}
                </Text>
              </Box>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}
