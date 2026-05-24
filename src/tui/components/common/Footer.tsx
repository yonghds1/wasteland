/**
 * Footer - 底部状态栏
 */

import React from "react";
import { Text, Box } from "ink";
import { useAppContext } from "../../context/AppContext.js";

export function Footer(): React.ReactElement {
  const { state } = useAppContext();

  const getPageHelp = () => {
    switch (state.currentPage) {
      case "session":
        return "↑/↓ 滚动 | a Agent | m 消息";
      case "debug":
        return "f 过滤 | e 导出 | c 清空";
      case "config":
        return "Tab 切换 | Enter 保存 | r 重置";
    }
  };

  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      paddingX={1}
      borderStyle="single"
      borderTop
    >
      <Text dimColor>
        Tab 切换页面 | q 退出 | ? 帮助
      </Text>
      <Text dimColor>{getPageHelp()}</Text>
    </Box>
  );
}
