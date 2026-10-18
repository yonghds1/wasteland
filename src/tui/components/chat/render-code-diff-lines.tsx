import React from 'react';
import { Box, Text } from 'ink';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { highlightCode } from '../render/micro-highlighter.js';

/**
 * 将 Markdown 代码块逐行展平为高度为 1 的终端虚拟行元素数组
 */
export function renderCodeBlockLines(
  code: string,
  lang = 'text',
  filename: string | undefined,
  width: number,
  prefixKey: string,
  showLineNumbers = true
): React.ReactElement[] {
  const highlightedLines = highlightCode(code, lang);
  const totalLines = highlightedLines.length;
  const lineNumWidth = Math.max(2, String(totalLines).length);
  const contentWidth = Math.max(10, width - 2);

  const titleTag = filename ? `[${lang}] ${filename}` : `[${lang}]`;
  const barLen = Math.max(0, contentWidth - titleTag.length - 5);
  const topBorder = `┌─ ${titleTag} ${'─'.repeat(barLen)}┐`;
  const bottomBorder = `└${'─'.repeat(Math.max(0, contentWidth - 2))}┘`;

  const lines: React.ReactElement[] = [];

  // 1. 顶部边框
  lines.push(
    <Box key={`${prefixKey}-cbt`} width={contentWidth} height={1} overflow="hidden">
      <Text color={wastelandTheme.colors.muted} dimColor>
        {topBorder.slice(0, contentWidth)}
      </Text>
    </Box>
  );

  // 2. 逐行代码（带行号与语法高亮）
  highlightedLines.forEach((lineTokens, idx) => {
    const lineNumStr = String(idx + 1).padStart(lineNumWidth, ' ');
    lines.push(
      <Box key={`${prefixKey}-cb-${idx}`} flexDirection="row" width={contentWidth} height={1} overflow="hidden">
        <Text wrap="truncate-end">
          <Text color={wastelandTheme.colors.muted} dimColor>
            │
          </Text>
          {showLineNumbers && (
            <Text color={wastelandTheme.colors.muted} dimColor>
              {' '}
              {lineNumStr} │{' '}
            </Text>
          )}
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
        </Text>
      </Box>
    );
  });

  // 3. 底部边框
  lines.push(
    <Box key={`${prefixKey}-cbb`} width={contentWidth} height={1} overflow="hidden">
      <Text color={wastelandTheme.colors.muted} dimColor>
        {bottomBorder.slice(0, contentWidth)}
      </Text>
    </Box>
  );

  return lines;
}

/**
 * 将 Unified Diff 文本逐行展平为高度为 1 的终端虚拟行元素数组
 */
export function renderDiffLines(
  diffText: string,
  filename: string | undefined,
  width: number,
  prefixKey: string
): React.ReactElement[] {
  const rawLines = diffText.split('\n');
  const contentWidth = Math.max(10, width - 2);

  let addCount = 0;
  let delCount = 0;
  for (const line of rawLines) {
    if (line.startsWith('+') && !line.startsWith('+++')) addCount++;
    else if (line.startsWith('-') && !line.startsWith('---')) delCount++;
  }

  const statTag = `+${addCount} / -${delCount} lines`;
  const headerTitle = filename ? `[diff] ${filename} (${statTag})` : `[diff] ${statTag}`;
  const barLen = Math.max(0, contentWidth - headerTitle.length - 5);
  const topBorder = `┌─ ${headerTitle} ${'─'.repeat(barLen)}┐`;
  const bottomBorder = `└${'─'.repeat(Math.max(0, contentWidth - 2))}┘`;

  const lines: React.ReactElement[] = [];

  // 1. 顶部边框
  lines.push(
    <Box key={`${prefixKey}-dft`} width={contentWidth} height={1} overflow="hidden">
      <Text color={wastelandTheme.colors.muted} dimColor>
        {topBorder.slice(0, contentWidth)}
      </Text>
    </Box>
  );

  // 2. 逐行 diff（绿增红删）
  rawLines.forEach((line, idx) => {
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

    lines.push(
      <Box key={`${prefixKey}-df-${idx}`} flexDirection="row" width={contentWidth} height={1} overflow="hidden">
        <Text wrap="truncate-end">
          <Text color={wastelandTheme.colors.muted} dimColor>
            │{' '}
          </Text>
          <Text color={color} bold={bold} dimColor={dim}>
            {line || ' '}
          </Text>
        </Text>
      </Box>
    );
  });

  // 3. 底部边框
  lines.push(
    <Box key={`${prefixKey}-dfb`} width={contentWidth} height={1} overflow="hidden">
      <Text color={wastelandTheme.colors.muted} dimColor>
        {bottomBorder.slice(0, contentWidth)}
      </Text>
    </Box>
  );

  return lines;
}
