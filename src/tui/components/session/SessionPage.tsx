/**
 * SessionPage - 会话页面
 */

import React from "react";
import { Box } from "ink";
import { AgentTree } from "./AgentTree.js";
import { MessageList } from "./MessageList.js";
import { InputBar } from "./InputBar.js";
import { useAppContext } from "../../context/AppContext.js";

interface SessionPageProps {
  height?: number;
  width?: number;
  sendMessage?: (content: string) => void;
}

export function SessionPage({ height, width, sendMessage }: SessionPageProps): React.ReactElement {
  const { state } = useAppContext();
  // 内容高度 = 总高度 - InputBar(约2行)
  const contentHeight = height ? Math.max(height - 3, 5) : 20;
  // Agent 树宽度固定 25 列
  const agentTreeWidth = 25;
  // 消息列表宽度 = 总宽度 - Agent树 - 边框
  const messageWidth = width ? width - agentTreeWidth - 4 : undefined;

  return (
    <Box flexDirection="column" width={width}>
      {/* 主内容区：Agent 树 + 消息列表 */}
      <Box flexDirection="row" height={contentHeight} width={width}>
        {/* Agent 树 - 左侧固定宽度 */}
        <Box
          width={agentTreeWidth}
          flexShrink={0}
          flexDirection="column"
        >
          <AgentTree />
        </Box>

        {/* 消息列表 - 右侧填充剩余空间 */}
        <Box
          flexGrow={1}
          flexShrink={1}
          flexDirection="column"
        >
          <MessageList height={contentHeight} width={messageWidth} />
        </Box>
      </Box>

      {/* 输入框 - 底部 */}
      <InputBar width={width} sendMessage={sendMessage} />
    </Box>
  );
}
