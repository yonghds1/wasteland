/**
 * SessionPage - 会话页面
 */

import React from "react";
import { Text, Box } from "ink";
import { AgentTree } from "./AgentTree.js";
import { MessageList } from "./MessageList.js";
import { InputBar } from "./InputBar.js";

export function SessionPage(): React.ReactElement {
  return (
    <Box flexDirection="column" height="100%">
      <Box flexDirection="row" flexGrow={1}>
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
