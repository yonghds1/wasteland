/**
 * MessageList - 消息列表
 *
 * 显示会话消息，支持：
 * - 用户消息使用 cyan + ❯ 前缀
 * - 助手消息使用 green + ◆ 前缀
 * - 工具消息使用 magenta + emoji
 * - 系统消息使用 dim gray
 * - 消息分隔线（细线 ─）
 * - 流式消息末尾显示 ▌ 光标 + ● 流式中 状态
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Text, Box, useInput } from 'ink';
import { useAppContext, type Message } from '../../context/AppContext.js';
import {
  USER_MSG,
  ASSISTANT_MSG,
  TOOL_MSG,
  SYSTEM_MSG,
  PRIMARY,
  USER_PREFIX,
  ASSISTANT_PREFIX,
  SYSTEM_PREFIX,
  STREAMING_CURSOR,
  MESSAGE_SEPARATOR,
  TOOL_ICONS,
  TOOL_VERBS,
  SEPARATORS,
} from '../../utils/colors.js';
import { t } from '../../../locales/index.js';

const TYPE_COLORS: Record<string, string> = {
  user: USER_MSG,
  assistant: ASSISTANT_MSG,
  tool: TOOL_MSG,
  system: SYSTEM_MSG,
};

function getTypeLabel(type: string): string {
  switch (type) {
    case 'user':
      return t('tui.session.messages.user');
    case 'assistant':
      return t('tui.session.messages.assistant');
    case 'tool':
      return t('tui.session.messages.tool');
    case 'system':
      return t('tui.session.messages.system');
    default:
      return type;
  }
}

const TYPE_PREFIXES: Record<string, string> = {
  user: USER_PREFIX,
  assistant: ASSISTANT_PREFIX,
  tool: '',
  system: SYSTEM_PREFIX,
};

/**
 * 逻辑行类型
 */
type LineType = 'header' | 'content' | 'tool-header' | 'separator';

interface LogicalLine {
  type: LineType;
  content: string;
  color?: string;
  messageId: string;
  isStreaming?: boolean;
}

/**
 * 按宽度换行文本
 */
function wrapText(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [text];

  const lines: string[] = [];
  const paragraphs = text.split('\n');

  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxWidth) {
      lines.push(paragraph);
    } else {
      let remaining = paragraph;
      while (remaining.length > maxWidth) {
        // 尝试在空格或标点处断行
        let breakPoint = maxWidth;
        const searchStart = Math.max(0, maxWidth - 20);
        const spaceIndex = remaining.lastIndexOf(' ', maxWidth);
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

/**
 * 格式化工具消息预览
 * 格式: ┊ {emoji} {verb:9} {detail}  {duration}
 */
function formatToolPreview(msg: Message): string {
  // 从 content 中提取关键信息
  const content = msg.content || '';

  // 尝试解析工具名和参数
  let toolName = 'tool';
  let detail = '';
  const duration = '';

  // 如果 content 包含路径信息
  const pathMatch = content.match(/path:\s*([^\n]+)/);
  if (pathMatch) {
    detail = pathMatch[1].trim();
  }

  // 如果 content 包含命令信息
  const cmdMatch = content.match(/command:\s*([^\n]+)/);
  if (cmdMatch) {
    detail = cmdMatch[1].trim();
  }

  // 从消息内容推断工具名
  const nameMatch = content.match(/^(\w+[-_]?\w*)/);
  if (nameMatch) {
    toolName = nameMatch[1];
  }

  // 获取图标和动词
  const icon = TOOL_ICONS[toolName] || TOOL_ICONS.default;
  const verb = (TOOL_VERBS[toolName] || TOOL_VERBS.default).padEnd(9);

  // 构建预览
  let preview = `${SEPARATORS.tool} ${icon} ${verb}`;
  if (detail) {
    preview += ` ${detail.slice(0, 40)}${detail.length > 40 ? '...' : ''}`;
  }
  if (duration) {
    preview += `  ${duration}`;
  }

  return preview;
}

/**
 * 将消息列表转换为逻辑行
 */
function messagesToLines(
  messages: Message[],
  width: number,
  streamingContent: string,
  streamingMessageId: string | null
): LogicalLine[] {
  const lines: LogicalLine[] = [];
  const contentWidth = width - 2; // 减去左侧缩进

  for (const msg of messages) {
    const color = TYPE_COLORS[msg.type];
    const prefix = TYPE_PREFIXES[msg.type];

    if (msg.type === 'tool') {
      // 工具消息：单行预览
      const preview = formatToolPreview(msg);
      lines.push({
        type: 'tool-header',
        content: `[${msg.timestamp.slice(11, 19)}] ${preview}`,
        color,
        messageId: msg.id,
      });
    } else {
      // 普通消息：标题行 + 内容行
      // 格式: [timestamp] prefix label
      const label = getTypeLabel(msg.type);
      const isStreaming = msg.id === streamingMessageId;
      lines.push({
        type: 'header',
        content: `[${msg.timestamp.slice(11, 19)}] ${prefix} ${label}`,
        color,
        messageId: msg.id,
        isStreaming,
      });

      // 内容行（自动换行）
      const content = msg.content || '';
      const wrappedLines = wrapText(content, contentWidth);
      for (const line of wrappedLines) {
        lines.push({
          type: 'content',
          content: `  ${line}`,
          color,
          messageId: msg.id,
          isStreaming,
        });
      }
    }

    // 消息间细线分隔
    lines.push({
      type: 'separator',
      content: MESSAGE_SEPARATOR,
      messageId: msg.id,
    });
  }

  // 添加流式内容（如果有）
  if (streamingContent && streamingMessageId) {
    // 查找最后一条 assistant 消息
    const lastAssistantMsg = [...messages].reverse().find((m) => m.type === 'assistant');

    if (!lastAssistantMsg || lastAssistantMsg.id !== streamingMessageId) {
      // 新的流式消息
      lines.push({
        type: 'header',
        content: `[${new Date().toISOString().slice(11, 19)}] ${ASSISTANT_PREFIX} ${t('tui.session.messages.assistant')}`,
        color: TYPE_COLORS.assistant,
        messageId: streamingMessageId,
        isStreaming: true,
      });
    }

    // 流式内容行
    const wrappedLines = wrapText(streamingContent, contentWidth);
    for (const line of wrappedLines) {
      lines.push({
        type: 'content',
        content: `  ${line}`,
        color: TYPE_COLORS.assistant,
        messageId: streamingMessageId,
        isStreaming: true,
      });
    }
  }

  return lines;
}

/**
 * 渲染滚动条
 */
function renderScrollbar(
  totalLines: number,
  visibleLines: number,
  scrollOffset: number,
  height: number
): string {
  if (totalLines <= visibleLines) return '';

  const thumbSize = Math.max(1, Math.floor((height * visibleLines) / totalLines));
  const maxScroll = totalLines - visibleLines;
  const thumbPos =
    maxScroll > 0 ? Math.floor(((height - thumbSize) * scrollOffset) / maxScroll) : 0;

  let bar = '';
  for (let i = 0; i < height; i++) {
    if (i >= thumbPos && i < thumbPos + thumbSize) {
      bar += '█';
    } else {
      bar += '░';
    }
  }
  return bar;
}

interface MessageListProps {
  height?: number;
  width?: number;
}

export function MessageList({ height = 20, width = 80 }: MessageListProps): React.ReactElement {
  const { state } = useAppContext();
  const { messages, streamingContent, streamingMessageId } = state.session;

  // 滚动状态
  const [scrollOffset, setScrollOffset] = useState(0);
  // 是否自动滚动到底部
  const [autoScroll, setAutoScroll] = useState(true);

  // 计算消息区可用高度：减去标题行和状态行
  const contentHeight = Math.max(height - 2, 5);
  // 计算内容宽度：减去滚动条(1)和边距(2)
  const contentWidth = Math.max(width - 3, 20);

  // 将消息转换为逻辑行
  const lines = useMemo(() => {
    return messagesToLines(messages, contentWidth, streamingContent, streamingMessageId);
  }, [messages, contentWidth, streamingContent, streamingMessageId]);

  const totalLines = lines.length;

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && totalLines > 0) {
      setScrollOffset(Math.max(0, totalLines - contentHeight));
    }
  }, [totalLines, contentHeight, autoScroll]);

  // 处理滚动
  const handleScroll = useCallback(
    (direction: 'up' | 'down' | 'pageUp' | 'pageDown' | 'home' | 'end') => {
      const maxScroll = Math.max(0, totalLines - contentHeight);

      switch (direction) {
        case 'up':
          setScrollOffset((prev) => Math.max(0, prev - 1));
          setAutoScroll(false);
          break;
        case 'down':
          setScrollOffset((prev) => {
            const next = Math.min(maxScroll, prev + 1);
            // 如果滚动到底部，恢复自动滚动
            if (next >= maxScroll) setAutoScroll(true);
            return next;
          });
          break;
        case 'pageUp':
          setScrollOffset((prev) => Math.max(0, prev - contentHeight));
          setAutoScroll(false);
          break;
        case 'pageDown':
          setScrollOffset((prev) => {
            const next = Math.min(maxScroll, prev + contentHeight);
            if (next >= maxScroll) setAutoScroll(true);
            return next;
          });
          break;
        case 'home':
          setScrollOffset(0);
          setAutoScroll(false);
          break;
        case 'end':
          setScrollOffset(maxScroll);
          setAutoScroll(true);
          break;
      }
    },
    [totalLines, contentHeight]
  );

  // 键盘事件处理 - 基于焦点区域激活
  useInput(
    (input, key) => {
      if (key.upArrow) {
        handleScroll('up');
      } else if (key.downArrow) {
        handleScroll('down');
      } else if (key.pageUp) {
        handleScroll('pageUp');
      } else if (key.pageDown) {
        handleScroll('pageDown');
      } else if (key.home || input === 'g') {
        handleScroll('home');
      } else if (key.end || input === 'G') {
        handleScroll('end');
      }
    },
    {
      isActive:
        state.focusArea === 'messageList' &&
        !state.inputMode &&
        !state.filterMode &&
        !state.editMode &&
        !state.exitConfirmPending &&
        !state.showHelp,
    }
  );

  // 计算可见行
  const visibleLines = lines.slice(scrollOffset, scrollOffset + contentHeight);

  // 滚动条
  const scrollbar = renderScrollbar(totalLines, contentHeight, scrollOffset, contentHeight);

  // 滚动状态指示
  const scrollInfo =
    totalLines > contentHeight
      ? `行 ${scrollOffset + 1}-${Math.min(scrollOffset + contentHeight, totalLines)} / ${totalLines} (${Math.round(((scrollOffset + contentHeight) / totalLines) * 100)}%)`
      : '';

  // 空状态
  if (messages.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
        <Text color={PRIMARY}>{t('tui.session.messages.welcome')}</Text>
        <Text dimColor>{t('tui.session.messages.startHint')}</Text>
        <Text dimColor color="gray">
          {t('tui.session.messages.tabHint')}
        </Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      height={height}
      borderStyle="single"
      borderColor={state.focusArea === 'messageList' ? 'cyan' : 'gray'}
    >
      {/* 标题栏 */}
      <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
        <Box flexDirection="row" gap={1}>
          <Text bold color={PRIMARY}>
            {t('tui.session.messages.title')}
          </Text>
          <Text dimColor>
            {t('tui.session.messages.count', { count: String(messages.length) })}
          </Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          {state.session.isThinking && (
            <>
              <Text bold color="yellow">
                ●
              </Text>
              <Text color="yellow">{t('tui.session.messages.thinking')}</Text>
            </>
          )}
          {state.session.isStreaming && !state.session.isThinking && (
            <>
              <Text bold color="green">
                ●
              </Text>
              <Text color="green">{t('tui.session.messages.streaming')}</Text>
            </>
          )}
        </Box>
      </Box>

      {/* 消息区域 */}
      <Box flexDirection="row" flexGrow={1}>
        {/* 内容区域 */}
        <Box flexDirection="column" flexGrow={1}>
          {visibleLines.map((line, idx) => {
            if (line.type === 'separator') {
              // 分隔线 - 使用 dim 细线
              return (
                <Text key={`sep-${idx}`} dimColor color="gray">
                  {line.content}
                </Text>
              );
            }

            const color = line.color as any;

            // 判断是否是最后一条流式内容行
            const isLastStreamingLine =
              line.isStreaming && line.type === 'content' && idx === visibleLines.length - 1;

            return (
              <Text key={`${line.messageId}-${idx}`} color={color}>
                {line.content}
                {isLastStreamingLine ? STREAMING_CURSOR : ''}
              </Text>
            );
          })}
        </Box>

        {/* 滚动条 */}
        {scrollbar && (
          <Box flexDirection="column" width={1}>
            {scrollbar.split('').map((char, idx) => (
              <Text key={idx} dimColor={char === '░'} color={char === '█' ? PRIMARY : undefined}>
                {char}
              </Text>
            ))}
          </Box>
        )}
      </Box>

      {/* 滚动状态 */}
      {scrollInfo && (
        <Box flexDirection="row" justifyContent="center" gap={1}>
          <Text dimColor>{scrollInfo}</Text>
          {!autoScroll && <Text color="yellow">{t('tui.session.messages.autoScrollPaused')}</Text>}
        </Box>
      )}
    </Box>
  );
}
