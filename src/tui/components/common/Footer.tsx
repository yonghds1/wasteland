/**
 * Footer - 底部状态栏
 *
 * 根据当前模式动态显示快捷键提示
 */

import React from "react";
import { Text, Box } from "ink";
import { useAppContext } from "../../context/AppContext.js";

interface FooterProps {
  width?: number;
}

export function Footer({ width }: FooterProps): React.ReactElement {
  const { state } = useAppContext();

  // 根据模式返回不同的帮助文本
  const getModeHelp = () => {
    if (state.inputMode) {
      // 输入模式
      return (
        <Text dimColor>
          <Text bold color="yellow">
            [输入模式]
          </Text>{" "}
          Esc 取消 | Enter 发送 | Ctrl+C 退出
        </Text>
      );
    }

    if (state.filterMode) {
      // 过滤模式
      return (
        <Text dimColor>
          <Text bold color="yellow">
            [过滤模式]
          </Text>{" "}
          Tab 切换字段 | ←/→ 切换值 | Esc 关闭
        </Text>
      );
    }

    if (state.editMode) {
      // 编辑模式
      return (
        <Text dimColor>
          <Text bold color="yellow">
            [编辑模式]
          </Text>{" "}
          Enter 确认 | Esc 取消
        </Text>
      );
    }

    if (state.exitConfirmPending) {
      // 退出确认状态
      return (
        <Text dimColor>
          <Text bold color="yellow">
            [退出确认]
          </Text>{" "}
          y 确认退出 | n 或其他键取消
        </Text>
      );
    }

    if (state.showHelp) {
      // 帮助页面
      return (
        <Text dimColor>
          <Text bold color="cyan">
            [帮助]
          </Text>{" "}
          h 或 Esc 关闭帮助
        </Text>
      );
    }

    // 导航模式 - 显示默认快捷键
    return (
      <Text dimColor>
        <Text bold color="green">
          [导航模式]
        </Text>{" "}
        h 帮助 | Tab 切换页面 | q 退出
      </Text>
    );
  };

  // 根据页面返回特定提示
  const getPageSpecificHelp = () => {
    // 如果在特殊模式下，不显示页面特定提示
    if (state.inputMode || state.filterMode || state.editMode || state.exitConfirmPending || state.showHelp) {
      return null;
    }

    switch (state.currentPage) {
      case "session":
        return <Text dimColor>↑/↓ 滚动 | Enter 输入</Text>;
      case "debug":
        return <Text dimColor>f 过滤 | c 清空</Text>;
      case "config":
        return <Text dimColor>↑/↓ 切换 | Enter 编辑 | Ctrl+S 保存</Text>;
    }
  };

  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      width={width}
      paddingX={1}
      borderStyle="single"
      borderTop
    >
      {getModeHelp()}
      {getPageSpecificHelp()}
    </Box>
  );
}
