/**
 * SessionPage - 会话页面
 */

import React from "react";
import { Box } from "ink";
import { AgentTree } from "./AgentTree.js";
import { MessageList } from "./MessageList.js";
import { InputBar } from "./InputBar.js";

interface SessionPageProps {
  height?: number;
}

export function SessionPage({ height }: SessionPageProps): React.ReactElement {
  // 内容高度 = 总高度 - InputBar(约2行)
  const contentHeight = height ? Math.max(height - 2, 5) : 20;

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" height={contentHeight}>
        <Box width={25} borderStyle="single" flexDirection="column">
          <AgentTree />
        </Box>
        <Box flexGrow={1} borderStyle="single" flexDirection="column">
          <MessageList />
        </Box>
      </Box>
      <InputBar />
    </Box>
  );
}
