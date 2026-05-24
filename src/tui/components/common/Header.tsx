/**
 * Header - 顶部状态栏 + Tab 导航 (Hermes 风格)
 *
 * 改进：
 * - 使用 gold/amber 色系标题
 * - 添加 Session 标识
 * - 流式状态指示器更醒目
 * - 使用 Hermes 风格分隔符
 */

import React from "react";
import { Text, Box } from "ink";
import { useAppContext, type PageName } from "../../context/AppContext.js";
import {
  GOLD,
  BRONZE,
  DARK_GOLDENROD,
  TUI_COLORS,
  SEPARATORS,
} from "../../utils/colors.js";

const TABS: { name: PageName; label: string; key: string }[] = [
  { name: "session", label: "会话", key: "1" },
  { name: "debug", label: "调试", key: "2" },
  { name: "config", label: "配置", key: "3" },
];

interface HeaderProps {
  width?: number;
}

export function Header({ width }: HeaderProps): React.ReactElement {
  const { state } = useAppContext();

  const now = new Date();
  const time = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}`;

  // Session ID 缩短显示
  const sessionId = state.sessionMetadata.id;
  const shortSessionId = sessionId.length > 16
    ? `${sessionId.slice(0, 16)}...`
    : sessionId;

  return (
    <Box
      flexDirection="row"
      justifyContent="space-between"
      width={width}
      paddingX={1}
      borderStyle="single"
      borderBottom
      borderColor={BRONZE}
    >
      <Box flexDirection="row" gap={1}>
        {/* 标题 - Gold 色系 */}
        <Text bold color={GOLD}>
          rxc
        </Text>
        <Text color={DARK_GOLDENROD}>v0.1.0</Text>

        {/* 分隔符 */}
        <Text color={BRONZE}>{SEPARATORS.vertical}</Text>

        {/* Tab 导航 */}
        <Box flexDirection="row" gap={1}>
          {TABS.map((tab) => {
            const isActive = state.currentPage === tab.name;
            return (
              <Box key={tab.name} flexDirection="row">
                {isActive ? (
                  <Text bold color={GOLD}>
                    [{tab.label}]
                  </Text>
                ) : (
                  <Text color="gray">
                    {tab.label}
                  </Text>
                )}
                <Text dimColor color="gray">
                  {tab.key}
                </Text>
              </Box>
            );
          })}
        </Box>
      </Box>

      <Box flexDirection="row" gap={1}>
        {/* Session 标识 */}
        <Text color={DARK_GOLDENROD}>
          Session:
        </Text>
        <Text dimColor>
          {shortSessionId}
        </Text>

        {/* 分隔符 */}
        <Text color={BRONZE}>{SEPARATORS.vertical}</Text>

        {/* 流式状态指示器 */}
        {state.session.isStreaming ? (
          <Text bold color="green">
            ●
          </Text>
        ) : (
          <Text color="gray">
            ○
          </Text>
        )}

        {/* 时间 */}
        <Text dimColor>
          {time}
        </Text>
      </Box>
    </Box>
  );
}
