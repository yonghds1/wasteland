/**
 * MessageList - 消息列表
 *
 * 显示会话消息，支持滚动和选中高亮
 */

import React, { useState, useEffect } from "react";
import { Text, Box, useInput } from "ink";
import { useAppContext } from "../../context/AppContext.js";

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

interface MessageListProps {
  height?: number;
}

export function MessageList({ height }: MessageListProps): React.ReactElement {
  const { state } = useAppContext();
  const { messages } = state.session;
  const [scrollOffset, setScrollOffset] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState(0);

  // 可见行数（减去标题和滚动指示器）
  const visibleLines = height ? Math.max(height - 3, 3) : 10;

  // 新消息自动滚动到底部
  useEffect(() => {
    if (messages.length > 0) {
      setScrollOffset(Math.max(0, messages.length - visibleLines));
      setSelectedIdx(messages.length - 1);
    }
  }, [messages.length, visibleLines]);

  // 键盘滚动（仅在导航模式下处理）
  // useInput 只在导航模式下活跃，避免与输入模式冲突
  useInput(
    (input, key) => {
      if (key.upArrow) {
        setSelectedIdx((prev) => Math.max(0, prev - 1));
        if (selectedIdx <= scrollOffset && scrollOffset > 0) {
          setScrollOffset((prev) => Math.max(0, prev - 1));
        }
      }
      if (key.downArrow) {
        setSelectedIdx((prev) => Math.min(messages.length - 1, prev + 1));
        if (selectedIdx >= scrollOffset + visibleLines - 1) {
          setScrollOffset((prev) => Math.min(Math.max(0, messages.length - visibleLines), prev + 1));
        }
      }
    },
    // 仅在导航模式且不在特殊模式下时处理
    { isActive: !state.inputMode && !state.filterMode && !state.editMode && !state.exitConfirmPending && !state.showHelp }
  );

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

  // 计算可见消息
  const visibleMessages = messages.slice(scrollOffset, scrollOffset + visibleLines);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* 标题栏 */}
      <Box flexDirection="row" justifyContent="space-between" paddingX={1}>
        <Text bold underline>消息</Text>
        <Text dimColor>{messages.length} 条</Text>
      </Box>

      {/* 消息列表 */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {visibleMessages.map((msg, idx) => {
          const actualIdx = scrollOffset + idx;
          const isSelected = actualIdx === selectedIdx;
          const color = TYPE_COLORS[msg.type];

          return (
            <Box key={msg.id} flexDirection="row">
              {/* 选中指示器 */}
              <Text>{isSelected ? "›" : " "}</Text>
              {/* 时间戳 */}
              <Text dimColor>[{msg.timestamp.slice(11, 19)}]</Text>
              {/* 类型标签 */}
              <Text color={color} bold> [{TYPE_LABELS[msg.type]}]</Text>
              {/* 内容 */}
              <Text> {msg.content.length > 50 ? msg.content.slice(0, 47) + "..." : msg.content}</Text>
            </Box>
          );
        })}
      </Box>

      {/* 滚动指示器 */}
      {messages.length > visibleLines && (
        <Box flexDirection="row" justifyContent="center">
          <Text dimColor>
            {scrollOffset > 0 ? "▲ " : "  "}
            {scrollOffset + 1}-{Math.min(scrollOffset + visibleLines, messages.length)} / {messages.length}
            {scrollOffset + visibleLines < messages.length ? " ▼" : "  "}
          </Text>
        </Box>
      )}
    </Box>
  );
}
