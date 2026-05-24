/**
 * MessageList - 消息列表（Hermes 风格）
 *
 * 显示会话消息，支持：
 * - 消息完整显示（不截断），自然换行
 * - 流式消息实时更新
 * - 滚动条回滚查看历史
 * - 工具调用单行预览
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Text, Box, useInput, measureElement } from "ink";
import { useAppContext, type Message } from "../../context/AppContext.js";

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

// 工具图标映射
const TOOL_ICONS: Record<string, string> = {
  "read-file": "📖",
  "read_file": "📖",
  "write-file": "✍️",
  "write_file": "✍️",
  "edit-file": "✏️",
  "edit_file": "✏️",
  bash: "💻",
  terminal: "💻",
  "search-files": "🔎",
  search_files: "🔎",
  "web-search": "🔍",
  web_search: "🔍",
};

// 工具动词映射
const TOOL_VERBS: Record<string, string> = {
  "read-file": "read",
  "read_file": "read",
  "write-file": "write",
  "write_file": "write",
  "edit-file": "edit",
  "edit_file": "edit",
  bash: "exec",
  terminal: "exec",
};

/**
 * 逻辑行类型
 */
type LineType = "header" | "content" | "tool-header" | "separator";

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

/**
 * 格式化工具消息预览
 */
function formatToolPreview(msg: Message): string {
  // 从 content 中提取关键信息
  const content = msg.content || "";

  // 尝试解析工具名和参数
  let toolName = "tool";
  let detail = "";
  let duration = "";

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
  const icon = TOOL_ICONS[toolName] || "⚡";
  const verb = TOOL_VERBS[toolName] || toolName;

  // 构建预览
  let preview = `${icon} ${verb}`;
  if (detail) {
    preview += `  ${detail.slice(0, 40)}${detail.length > 40 ? "..." : ""}`;
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
  streamingMessageId: string | null,
): LogicalLine[] {
  const lines: LogicalLine[] = [];
  const contentWidth = width - 2; // 减去左侧缩进

  for (const msg of messages) {
    const color = TYPE_COLORS[msg.type];

    if (msg.type === "tool") {
      // 工具消息：单行预览
      const preview = formatToolPreview(msg);
      lines.push({
        type: "tool-header",
        content: `[${msg.timestamp.slice(11, 19)}] ${preview}`,
        color,
        messageId: msg.id,
      });
    } else {
      // 普通消息：标题行 + 内容行
      lines.push({
        type: "header",
        content: `[${msg.timestamp.slice(11, 19)}] ${TYPE_LABELS[msg.type]}`,
        color,
        messageId: msg.id,
        isStreaming: msg.id === streamingMessageId,
      });

      // 内容行（自动换行）
      const content = msg.content || "";
      const wrappedLines = wrapText(content, contentWidth);
      for (const line of wrappedLines) {
        lines.push({
          type: "content",
          content: `  ${line}`,
          color,
          messageId: msg.id,
          isStreaming: msg.id === streamingMessageId,
        });
      }
    }

    // 消息间空行分隔
    lines.push({
      type: "separator",
      content: "",
      messageId: msg.id,
    });
  }

  // 添加流式内容（如果有）
  if (streamingContent && streamingMessageId) {
    // 查找最后一条 assistant 消息
    const lastAssistantMsg = [...messages].reverse().find(m => m.type === "assistant");

    if (!lastAssistantMsg || lastAssistantMsg.id !== streamingMessageId) {
      // 新的流式消息
      lines.push({
        type: "header",
        content: `[${new Date().toISOString().slice(11, 19)}] ${TYPE_LABELS.assistant}`,
        color: TYPE_COLORS.assistant,
        messageId: streamingMessageId,
        isStreaming: true,
      });
    }

    // 流式内容行
    const wrappedLines = wrapText(streamingContent, contentWidth);
    for (const line of wrappedLines) {
      lines.push({
        type: "content",
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
  height: number,
): string {
  if (totalLines <= visibleLines) return "";

  const thumbSize = Math.max(1, Math.floor(height * visibleLines / totalLines));
  const maxScroll = totalLines - visibleLines;
  const thumbPos = maxScroll > 0
    ? Math.floor((height - thumbSize) * scrollOffset / maxScroll)
    : 0;

  let bar = "";
  for (let i = 0; i < height; i++) {
    if (i >= thumbPos && i < thumbPos + thumbSize) {
      bar += "█";
    } else {
      bar += "░";
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
  const { messages } = state.session;

  // 滚动状态
  const [scrollOffset, setScrollOffset] = useState(0);
  // 是否自动滚动到底部
  const [autoScroll, setAutoScroll] = useState(true);
  // 流式内容累积器
  const [streamingContent, setStreamingContent] = useState("");
  // 流式消息 ID
  const streamingMessageId = useRef<string | null>(null);
  // 容器 ref
  const containerRef = useRef<any>(null);

  // 计算消息区可用高度：减去标题行和状态行
  const contentHeight = Math.max(height - 2, 5);
  // 计算内容宽度：减去滚动条(1)和边距(2)
  const contentWidth = Math.max(width - 3, 20);

  // 将消息转换为逻辑行
  const lines = useMemo(() => {
    return messagesToLines(
      messages,
      contentWidth,
      streamingContent,
      streamingMessageId.current,
    );
  }, [messages, contentWidth, streamingContent]);

  const totalLines = lines.length;

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && totalLines > 0) {
      setScrollOffset(Math.max(0, totalLines - contentHeight));
    }
  }, [totalLines, contentHeight, autoScroll]);

  // 监听流式消息更新
  useEffect(() => {
    // 如果正在流式输出，累积内容
    if (state.session.isStreaming) {
      // 查找最后一条 assistant 消息
      const lastMsg = [...messages].reverse().find(m => m.type === "assistant");
      if (lastMsg && lastMsg.content) {
        streamingMessageId.current = lastMsg.id;
        setStreamingContent(lastMsg.content);
      }
    } else {
      // 流式结束，清空
      setStreamingContent("");
      streamingMessageId.current = null;
    }
  }, [messages, state.session.isStreaming]);

  // 处理滚动
  const handleScroll = useCallback((direction: "up" | "down" | "pageUp" | "pageDown" | "home" | "end") => {
    const maxScroll = Math.max(0, totalLines - contentHeight);

    switch (direction) {
      case "up":
        setScrollOffset(prev => Math.max(0, prev - 1));
        setAutoScroll(false);
        break;
      case "down":
        setScrollOffset(prev => {
          const next = Math.min(maxScroll, prev + 1);
          // 如果滚动到底部，恢复自动滚动
          if (next >= maxScroll) setAutoScroll(true);
          return next;
        });
        break;
      case "pageUp":
        setScrollOffset(prev => Math.max(0, prev - contentHeight));
        setAutoScroll(false);
        break;
      case "pageDown":
        setScrollOffset(prev => {
          const next = Math.min(maxScroll, prev + contentHeight);
          if (next >= maxScroll) setAutoScroll(true);
          return next;
        });
        break;
      case "home":
        setScrollOffset(0);
        setAutoScroll(false);
        break;
      case "end":
        setScrollOffset(maxScroll);
        setAutoScroll(true);
        break;
    }
  }, [totalLines, contentHeight]);

  // 键盘事件处理
  useInput(
    (input, key) => {
      if (key.upArrow) {
        handleScroll("up");
      } else if (key.downArrow) {
        handleScroll("down");
      } else if (key.pageUp) {
        handleScroll("pageUp");
      } else if (key.pageDown) {
        handleScroll("pageDown");
      } else if (key.home || input === "g") {
        handleScroll("home");
      } else if (key.end || input === "G") {
        handleScroll("end");
      }
    },
    { isActive: !state.inputMode && !state.filterMode && !state.editMode && !state.exitConfirmPending && !state.showHelp }
  );

  // 计算可见行
  const visibleLines = lines.slice(scrollOffset, scrollOffset + contentHeight);

  // 滚动条
  const scrollbar = renderScrollbar(totalLines, contentHeight, scrollOffset, contentHeight);

  // 滚动状态指示
  const scrollInfo = totalLines > contentHeight
    ? `行 ${scrollOffset + 1}-${Math.min(scrollOffset + contentHeight, totalLines)} / ${totalLines} (${Math.round((scrollOffset + contentHeight) / totalLines * 100)}%)`
    : "";

  // 空状态
  if (messages.length === 0) {
    return (
      <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
        <Text dimColor>等待输入...</Text>
        <Text dimColor>在下方输入框输入消息</Text>
        <Text dimColor color="gray">Tab 切换页面 | q 退出</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} height={height}>
      {/* 标题栏 */}
      <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
        <Text bold underline>消息</Text>
        <Box>
          <Text dimColor>{messages.length} 条</Text>
          {state.session.isStreaming && (
            <Text color="green"> ● 流式中</Text>
          )}
        </Box>
      </Box>

      {/* 消息区域 */}
      <Box flexDirection="row" flexGrow={1}>
        {/* 内容区域 */}
        <Box
          flexDirection="column"
          flexGrow={1}
          ref={containerRef}
        >
          {visibleLines.map((line, idx) => {
            if (line.type === "separator") {
              return <Text key={`sep-${idx}`}> </Text>;
            }

            const color = line.color as any;

            return (
              <Text
                key={`${line.messageId}-${idx}`}
                color={color}
              >
                {line.content}
                {line.isStreaming && line.type === "content" && idx === visibleLines.length - 1 ? "▌" : ""}
              </Text>
            );
          })}
        </Box>

        {/* 滚动条 */}
        {scrollbar && (
          <Box flexDirection="column" width={1}>
            {scrollbar.split("").map((char, idx) => (
              <Text key={idx} dimColor={char === "░"} color={char === "█" ? "blue" : undefined}>
                {char}
              </Text>
            ))}
          </Box>
        )}
      </Box>

      {/* 滚动状态 */}
      {scrollInfo && (
        <Box flexDirection="row" justifyContent="center">
          <Text dimColor>{scrollInfo}</Text>
          {!autoScroll && <Text dimColor color="yellow"> (已暂停自动滚动)</Text>}
        </Box>
      )}
    </Box>
  );
}
