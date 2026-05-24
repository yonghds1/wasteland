/**
 * MessageDetailModal - 消息详情弹窗
 *
 * 显示消息的完整内容
 */

import React from "react";
import { Text, Box } from "ink";
import type { Message } from "../../context/AppContext.js";

const TYPE_COLORS: Record<string, string> = {
  user: "cyan",
  assistant: "green",
  tool: "magenta",
  system: "gray",
};

const TYPE_LABELS: Record<string, string> = {
  user: "用户",
  assistant: "助手",
  tool: "工具",
  system: "系统",
};

interface MessageDetailModalProps {
  message: Message;
  width?: number;
}

export function MessageDetailModal({ message, width }: MessageDetailModalProps): React.ReactElement {
  const modalWidth = width ? Math.min(width - 4, 80) : 80;
  const color = TYPE_COLORS[message.type];

  // 按宽度换行内容
  const lines = wrapText(message.content, modalWidth - 4);

  return (
    <Box
      flexDirection="column"
      width={modalWidth}
      borderStyle="double"
      borderColor={color}
      paddingX={1}
      paddingY={0}
    >
      {/* 标题 */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color={color}>
          [{TYPE_LABELS[message.type]}]
        </Text>
        <Text dimColor>{message.timestamp.slice(11, 19)}</Text>
      </Box>

      {/* 分隔线 */}
      <Box marginBottom={1}>
        <Text dimColor>{"─".repeat(modalWidth - 4)}</Text>
      </Box>

      {/* 内容 - 支持多行 */}
      <Box flexDirection="column" flexGrow={1} marginBottom={1}>
        {lines.map((line, idx) => (
          <Text key={idx}>{line}</Text>
        ))}
      </Box>

      {/* 关闭提示 */}
      <Box justifyContent="center">
        <Text dimColor>按 Esc 或 Enter 关闭</Text>
      </Box>
    </Box>
  );
}

/**
 * 按宽度换行文本
 */
function wrapText(text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split("\n");

  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxWidth) {
      lines.push(paragraph);
    } else {
      let remaining = paragraph;
      while (remaining.length > maxWidth) {
        // 尝试在空格或标点处断行
        let breakPoint = maxWidth;
        const searchStart = Math.max(0, maxWidth - 20);
        const spaceIndex = remaining.lastIndexOf(" ", maxWidth);
        if (spaceIndex > searchStart) {
          breakPoint = spaceIndex;
        }
        lines.push(remaining.slice(0, breakPoint));
        remaining = remaining.slice(breakPoint).trimStart();
      }
      if (remaining) {
        lines.push(remaining);
      }
    }
  }

  return lines;
}
