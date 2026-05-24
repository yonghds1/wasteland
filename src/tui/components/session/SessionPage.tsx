/**
 * SessionPage - 会话页面
 */

import React from "react";
import { Box, useStdout } from "ink";
import { AgentTree } from "./AgentTree.js";
import { MessageList } from "./MessageList.js";
import { InputBar } from "./InputBar.js";

export function SessionPage({ height }: { height?: number }): React.ReactElement {
  // 内容高度 = 总高度 - InputBar(约2行)
  const contentHeight = height ? Math.max(height - 3, 5) : 20;

  // Agent 树宽度固定 25 列
  const agentTreeWidth = 25;

  return (
    <Box flexDirection="column">
      {/* 主内容区：Agent 树 + 消息列表 */}
      <Box flexDirection="row" height={contentHeight}>
        {/* Agent 树 - 左侧固定宽度 */}
        <Box
          width={agentTreeWidth}
          borderStyle="single"
          borderColor="gray"
          flexDirection="column"
        >
          <AgentTree />
        </Box>

        {/* 消息列表 - 右侧填充剩余空间 */}
        <Box
          flexGrow={1}
          borderStyle="single"
          borderColor="gray"
          flexDirection="column"
        >
          <MessageList height={contentHeight - 2} />
        </Box>
      </Box>

      {/* 输入框 - 底部 */}
      <InputBar />
    </Box>
  );
}
