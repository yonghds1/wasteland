/**
 * Footer - 底部状态栏 (Hermes 风格)
 *
 * 改进：
 * - 使用分段样式（不同颜色区分不同提示）
 * - 上下文相关提示更醒目
 * - 使用 Hermes 风格分隔符 ┊
 */

import React from "react";
import { Text, Box } from "ink";
import { useAppContext } from "../../context/AppContext.js";
import {
  GOLD,
  AMBER,
  SUCCESS,
  WARNING,
  SEPARATORS,
} from "../../utils/colors.js";

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
        <Box flexDirection="row" gap={1}>
          <Text bold color={AMBER}>
            [输入模式]
          </Text>
          <Text dimColor>Esc 取消</Text>
          <Text color={SEPARATORS.item.trim()}>{SEPARATORS.item.trim()}</Text>
          <Text color={SUCCESS}>Enter 发送</Text>
          <Text color={SEPARATORS.item.trim()}>{SEPARATORS.item.trim()}</Text>
          <Text dimColor>Ctrl+C 退出</Text>
        </Box>
      );
    }

    if (state.filterMode) {
      // 过滤模式
      return (
        <Box flexDirection="row" gap={1}>
          <Text bold color={AMBER}>
            [过滤模式]
          </Text>
          <Text dimColor>Tab 切换字段</Text>
          <Text color={SEPARATORS.item.trim()}>{SEPARATORS.item.trim()}</Text>
          <Text dimColor>←/→ 切换值</Text>
          <Text color={SEPARATORS.item.trim()}>{SEPARATORS.item.trim()}</Text>
          <Text color={WARNING}>Esc 关闭</Text>
        </Box>
      );
    }

    if (state.editMode) {
      // 编辑模式
      return (
        <Box flexDirection="row" gap={1}>
          <Text bold color={AMBER}>
            [编辑模式]
          </Text>
          <Text color={SUCCESS}>Enter 确认</Text>
          <Text color={SEPARATORS.item.trim()}>{SEPARATORS.item.trim()}</Text>
          <Text color={WARNING}>Esc 取消</Text>
        </Box>
      );
    }

    if (state.exitConfirmPending) {
      // 退出确认状态
      return (
        <Box flexDirection="row" gap={1}>
          <Text bold color="red">
            [退出确认]
          </Text>
          <Text color={SUCCESS}>y 确认退出</Text>
          <Text color={SEPARATORS.item.trim()}>{SEPARATORS.item.trim()}</Text>
          <Text color={WARNING}>n 或其他键取消</Text>
        </Box>
      );
    }

    if (state.showHelp) {
      // 帮助页面
      return (
        <Box flexDirection="row" gap={1}>
          <Text bold color="cyan">
            [帮助]
          </Text>
          <Text color={WARNING}>h 或 Esc 关闭帮助</Text>
        </Box>
      );
    }

    // 导航模式 - 显示默认快捷键
    return (
      <Box flexDirection="row" gap={1}>
        <Text color={GOLD}>h</Text>
        <Text dimColor>帮助</Text>
        <Text dimColor>{SEPARATORS.item.trim()}</Text>
        <Text color={GOLD}>Tab</Text>
        <Text dimColor>切换页面</Text>
        <Text dimColor>{SEPARATORS.item.trim()}</Text>
        <Text color={GOLD}>q</Text>
        <Text dimColor>退出</Text>
      </Box>
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
        return (
          <Box flexDirection="row" gap={1}>
            <Text dimColor>↑/↓ 滚动</Text>
            <Text dimColor>{SEPARATORS.item.trim()}</Text>
            <Text color={SUCCESS}>Enter 输入</Text>
          </Box>
        );
      case "debug":
        return (
          <Box flexDirection="row" gap={1}>
            <Text dimColor>↑/↓ 滚动</Text>
            <Text dimColor>{SEPARATORS.item.trim()}</Text>
            <Text color={GOLD}>f</Text>
            <Text dimColor>过滤</Text>
            <Text dimColor>{SEPARATORS.item.trim()}</Text>
            <Text color={GOLD}>c</Text>
            <Text dimColor>清空</Text>
          </Box>
        );
      case "config":
        return (
          <Box flexDirection="row" gap={1}>
            <Text dimColor>↑/↓ 切换</Text>
            <Text dimColor>{SEPARATORS.item.trim()}</Text>
            <Text color={GOLD}>Enter</Text>
            <Text dimColor>编辑</Text>
            <Text dimColor>{SEPARATORS.item.trim()}</Text>
            <Text color={SUCCESS}>Ctrl+S 保存</Text>
          </Box>
        );
    }
  };

  // 获取页面名称
  const getPageName = () => {
    switch (state.currentPage) {
      case "session":
        return "会话页面";
      case "debug":
        return "调试页面";
      case "config":
        return "配置页面";
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
      borderColor="#CD7F32"
    >
      <Box flexDirection="row">
        {getModeHelp()}
      </Box>

      <Box flexDirection="row" gap={1}>
        {/* 页面特定提示 */}
        {getPageSpecificHelp()}

        {/* 分隔符 */}
        <Text dimColor>{SEPARATORS.item.trim()}</Text>

        {/* 当前页面 */}
        <Text bold color={GOLD}>
          {getPageName()}
        </Text>
      </Box>
    </Box>
  );
}
