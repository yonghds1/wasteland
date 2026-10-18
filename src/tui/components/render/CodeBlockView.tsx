import React from 'react';
import { Box, Text } from 'ink';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { highlightCode } from './micro-highlighter.js';

export interface CodeBlockViewProps {
  code: string;
  lang?: string;
  filename?: string;
  width: number;
  showLineNumbers?: boolean;
}

export function CodeBlockView({
  code,
  lang = 'text',
  filename,
  width,
  showLineNumbers = true,
}: CodeBlockViewProps): React.ReactElement {
  const highlightedLines = highlightCode(code, lang);
  const totalLines = highlightedLines.length;
  const lineNumWidth = Math.max(2, String(totalLines).length);
  const contentWidth = Math.max(10, width - 2);

  // 顶部标题栏
  const titleTag = filename ? `[${lang}] ${filename}` : `[${lang}]`;
  const barLen = Math.max(0, contentWidth - titleTag.length - 5);
  const topBorder = `┌─ ${titleTag} ${'─'.repeat(barLen)}┐`;
  const bottomBorder = `└${'─'.repeat(Math.max(0, contentWidth - 2))}┘`;

  return (
    <Box flexDirection="column" width={contentWidth} marginY={0}>
      <Text color={wastelandTheme.colors.muted} dimColor>
        {topBorder.slice(0, contentWidth)}
      </Text>

      {highlightedLines.map((lineTokens, idx) => {
        const lineNumStr = String(idx + 1).padStart(lineNumWidth, ' ');
        return (
          <Box key={idx} flexDirection="row" width={contentWidth} overflow="hidden">
            <Text color={wastelandTheme.colors.muted} dimColor>
              │
            </Text>
            {showLineNumbers && (
              <Text color={wastelandTheme.colors.muted} dimColor>
                {' '}
                {lineNumStr} │{' '}
              </Text>
            )}
            <Box flexDirection="row" flexGrow={1} overflow="hidden">
              {lineTokens.map((t, tIdx) => (
                <Text
                  key={tIdx}
                  color={t.color}
                  dimColor={t.dim}
                  bold={t.bold}
                  italic={t.italic}
                >
                  {t.text}
                </Text>
              ))}
            </Box>
            <Text color={wastelandTheme.colors.muted} dimColor>
              │
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
