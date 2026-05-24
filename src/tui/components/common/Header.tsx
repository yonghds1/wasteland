/**
 * Header - 顶部状态栏 + Tab 导航
 */

import React from "react";
import { Text, Box } from "ink";
import { useAppContext, type PageName } from "../../context/AppContext.js";

const TABS: { name: PageName; label: string }[] = [
  { name: "session", label: "会话" },
  { name: "debug", label: "调试" },
  { name: "config", label: "配置" },
];

export function Header(): React.ReactElement {
  const { state } = useAppContext();

  const now = new Date();
  const time = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;

  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      paddingX={1}
      borderStyle="single"
      borderBottom
    >
      <Box flexDirection="row" gap={2}>
        <Text bold color="cyan">
          rxc v0.1.0
        </Text>
        <Box flexDirection="row" gap={1}>
          {TABS.map((tab) => (
            <Box key={tab.name}>
              <Text
                bold={state.currentPage === tab.name}
                color={state.currentPage === tab.name ? "green" : "gray"}
              >
                [{tab.label}]
              </Text>
            </Box>
          ))}
        </Box>
      </Box>
      <Box>
        <Text dimColor>
          {state.session.isStreaming ? "● " : "○ "}
          {time}
        </Text>
      </Box>
    </Box>
  );
}
