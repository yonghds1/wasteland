/**
 * MessageList - 消息列表
 *
 * 参考 OpenCode 的设计：
 * - 左侧彩色粗边框区分消息类型
 * - 用户消息：紫色边框
 * - 助手消息：青色边框
 * - 工具消息：灰色边框
 * - 系统消息：橙色边框
 * - 支持打字机效果和滚动
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Text, Box, useInput } from 'ink';
import { useAppContext, type Message } from '../../context/AppContext.js';
import {
  TEXT,
  TEXT_EMPHASIZED,
  MSG_BORDER_USER,
  MSG_BORDER_ASSISTANT,
  MSG_BORDER_TOOL,
  MSG_BORDER_SYSTEM,
  BACKGROUND,
  BACKGROUND_SECONDARY,
  MUTED,
  BORDER_DIM,
  PRIMARY,
  STREAMING_CURSOR,
  TOOL_ICONS,
  TOOL_VERBS,
  SEPARATORS,
} from '../../utils/colors.js';
import { t } from '../../../locales/index.js';

// ============================================================
// 常量定义
// ============================================================

/** 左边框宽度 */
const BORDER_WIDTH = 2;

/** 消息类型到边框颜色的映射 */
const BORDER_COLORS: Record<string, string> = {
  user: MSG_BORDER_USER,
  assistant: MSG_BORDER_ASSISTANT,
  tool: MSG_BORDER_TOOL,
  system: MSG_BORDER_SYSTEM,
};

/** 消息类型标签 */
const TYPE_LABELS: Record<string, string> = {
  user: 'USER',
  assistant: 'ASSISTANT',
  tool: 'TOOL',
  system: 'SYSTEM',
};

// ============================================================
// 工具函数
// ============================================================

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
 */
function formatToolPreview(msg: Message): string {
  const content = msg.content || '';
  let toolName = 'tool';
  let detail = '';

  const pathMatch = content.match(/path:\s*([^\n]+)/);
  if (pathMatch) {
    detail = pathMatch[1].trim();
  }

  const cmdMatch = content.match(/command:\s*([^\n]+)/);
  if (cmdMatch) {
    detail = cmdMatch[1].trim();
  }

  const nameMatch = content.match(/^(\w+[-_]?\w*)/);
  if (nameMatch) {
    toolName = nameMatch[1];
  }

  const icon = TOOL_ICONS[toolName] || TOOL_ICONS.default;
  const verb = (TOOL_VERBS[toolName] || TOOL_VERBS.default).padEnd(9);

  let preview = `${icon} ${verb}`;
  if (detail) {
    preview += ` ${detail.slice(0, 40)}${detail.length > 40 ? '...' : ''}`;
  }

  return preview;
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

// ============================================================
// 消息项组件（OpenCode 风格）
// ============================================================

interface MessageItemProps {
  message: Message;
  width: number;
  isStreaming: boolean;
}

function MessageItem({ message, width, isStreaming }: MessageItemProps): React.ReactElement {
  const borderColor = BORDER_COLORS[message.type] || MUTED;
  const typeLabel = TYPE_LABELS[message.type] || message.type.toUpperCase();
  const contentWidth = width - BORDER_WIDTH - 2;

  return (
    <Box flexDirection="row" width={width}>
      {/* 左侧粗边框（OpenCode 风格） */}
      <Box width={BORDER_WIDTH} flexDirection="column" alignItems="center">
        <Text color={borderColor}>│</Text>
      </Box>

      {/* 消息内容 */}
      <Box flexDirection="column" width={contentWidth} paddingLeft={1} paddingRight={1}>
        {/* 消息头部：类型标签 + 时间戳 */}
        <Box justifyContent="space-between" width={contentWidth}>
          <Text bold color={borderColor}>
            {typeLabel}
          </Text>
          <Text dimColor color={MUTED}>
            {message.timestamp.slice(11, 19)}
          </Text>
        </Box>

        {/* 消息内容 */}
        <Box marginTop={0}>
          <Text color={TEXT}>{message.content}</Text>
          {isStreaming && <Text color={PRIMARY}>{STREAMING_CURSOR}</Text>}
        </Box>

        {/* 工具调用详情 */}
        {message.type === 'tool' && (
          <Box flexDirection="column" marginTop={1} paddingLeft={2}>
            <Text color={MUTED}>{SEPARATORS.branch}</Text>
            <Text color={TEXT_EMPHASIZED}> {formatToolPreview(message)}</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ============================================================
// 主组件
// ============================================================

interface MessageListProps {
  height?: number;
  width?: number;
}

// 打字机效果配置
const TYPEWRITER_BATCH_SIZE = 5;
const TYPEWRITER_INTERVAL_MS = 16;

export function MessageList({ height = 20, width = 80 }: MessageListProps): React.ReactElement {
  const { state } = useAppContext();
  const { messages, streamingContent, streamingMessageId } = state.session;

  // 打字机效果：显示缓冲区
  const [displayContent, setDisplayContent] = useState('');
  const displayContentRef = useRef(displayContent);

  // 滚动状态
  const [scrollOffset, setScrollOffset] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);

  // 打字机效果：逐步显示流式内容
  useEffect(() => {
    if (!streamingMessageId && streamingContent.length > 0) {
      setDisplayContent(streamingContent);
      return;
    }

    if (streamingContent.length > displayContentRef.current.length) {
      const timer = setTimeout(() => {
        const nextLength = Math.min(
          displayContentRef.current.length + TYPEWRITER_BATCH_SIZE,
          streamingContent.length
        );
        const newContent = streamingContent.slice(0, nextLength);
        displayContentRef.current = newContent;
        setDisplayContent(newContent);
      }, TYPEWRITER_INTERVAL_MS);
      return () => clearTimeout(timer);
    }
  }, [streamingContent, streamingMessageId]);

  // 流式消息结束时，重置显示缓冲区
  useEffect(() => {
    if (!streamingMessageId) {
      displayContentRef.current = '';
      setDisplayContent('');
    }
  }, [streamingMessageId]);

  // 计算尺寸
  const contentHeight = Math.max(height - 2, 5);
  const contentWidth = Math.max(width - BORDER_WIDTH - 3, 20);

  // 过滤要显示的消息
  const displayMessages = useMemo(() => {
    const filtered: Message[] = [];
    let lastAssistantMessage: Message | null = null;

    for (const msg of messages) {
      if (msg.type === 'user' || msg.type === 'system') {
        filtered.push(msg);
      } else if (msg.type === 'assistant') {
        lastAssistantMessage = msg;
      } else if (msg.type === 'tool') {
        // 工具消息：显示内容摘要
        filtered.push(msg);
      }
    }

    if (lastAssistantMessage) {
      filtered.push(lastAssistantMessage);
    }

    return filtered;
  }, [messages]);

  // 计算总行数（用于滚动）
  const totalLines = useMemo(() => {
    let count = 0;
    for (const msg of displayMessages) {
      count += 2; // 标题行 + 空行
      const wrappedLines = wrapText(msg.content, contentWidth);
      count += wrappedLines.length;
    }
    if (streamingContent && streamingMessageId) {
      count += 2;
      const wrappedLines = wrapText(streamingContent, contentWidth);
      count += wrappedLines.length;
    }
    return count;
  }, [displayMessages, contentWidth, streamingContent, streamingMessageId]);

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

  // 键盘事件处理
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

  // 滚动条
  const scrollbar = renderScrollbar(totalLines, contentHeight, scrollOffset, contentHeight);

  // 滚动状态指示
  const scrollInfo =
    totalLines > contentHeight
      ? `行 ${scrollOffset + 1}-${Math.min(scrollOffset + contentHeight, totalLines)} / ${totalLines}`
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
      borderColor={state.focusArea === 'messageList' ? 'cyan' : BORDER_DIM}
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
              <Text bold color="yellow">●</Text>
              <Text color="yellow">{t('tui.session.messages.thinking')}</Text>
            </>
          )}
          {state.session.isStreaming && !state.session.isThinking && (
            <>
              <Text bold color="green">●</Text>
              <Text color="green">{t('tui.session.messages.streaming')}</Text>
            </>
          )}
        </Box>
      </Box>

      {/* 消息区域 */}
      <Box flexDirection="row" flexGrow={1}>
        {/* 内容区域 */}
        <Box flexDirection="column" flexGrow={1}>
          {displayMessages.map((msg) => (
            <MessageItem
              key={msg.id}
              message={msg}
              width={width}
              isStreaming={msg.id === streamingMessageId}
            />
          ))}

          {/* 流式消息 */}
          {streamingContent && streamingMessageId && (
            <MessageItem
              message={{
                id: streamingMessageId,
                type: 'assistant',
                agentId: 'assistant',
                content: streamingContent,
                timestamp: new Date().toISOString(),
              }}
              width={width}
              isStreaming={true}
            />
          )}
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
