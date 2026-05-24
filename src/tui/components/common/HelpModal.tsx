/**
 * HelpModal - 帮助弹窗
 *
 * 显示所有快捷键帮助信息
 */

import React from "react";
import { Text, Box } from "ink";

interface HelpModalProps {
  width?: number;
}

export function HelpModal({ width }: HelpModalProps): React.ReactElement {
  const modalWidth = width ? Math.min(width - 4, 60) : 60;

  return (
    <Box
      flexDirection="column"
      width={modalWidth}
      borderStyle="double"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
    >
      {/* 标题 */}
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color="cyan">
          快捷键帮助
        </Text>
      </Box>

      {/* 分隔线 */}
      <Box marginBottom={1}>
        <Text dimColor>{"─".repeat(modalWidth - 6)}</Text>
      </Box>

      {/* 导航模式 */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="green">
          导航模式（默认）
        </Text>
        <Box flexDirection="column" paddingLeft={2}>
          <Text>
            <Text bold>h</Text> 显示此帮助
          </Text>
          <Text>
            <Text bold>q</Text> 退出（需确认）
          </Text>
          <Text>
            <Text bold>Tab</Text> / <Text bold>Shift+Tab</Text> 切换页面
          </Text>
          <Text>
            <Text bold>Enter</Text> 进入输入模式（会话页面）
          </Text>
          <Text>
            <Text bold>↑/↓</Text> 滚动列表
          </Text>
        </Box>
      </Box>

      {/* 输入模式 */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="yellow">
          输入模式
        </Text>
        <Box flexDirection="column" paddingLeft={2}>
          <Text>
            <Text bold>Esc</Text> 取消输入，回到导航模式
          </Text>
          <Text>
            <Text bold>Enter</Text> 发送消息，回到导航模式
          </Text>
          <Text>
            <Text bold>Ctrl+C</Text> 全局退出（需确认）
          </Text>
        </Box>
      </Box>

      {/* 页面特定快捷键 */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="magenta">
          会话页面
        </Text>
        <Box flexDirection="column" paddingLeft={2}>
          <Text>
            <Text bold>↑/↓</Text> 滚动消息
          </Text>
          <Text>
            <Text bold>Enter</Text> 进入输入模式
          </Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="blue">
          调试页面
        </Text>
        <Box flexDirection="column" paddingLeft={2}>
          <Text>
            <Text bold>f</Text> 进入过滤模式
          </Text>
          <Text>
            <Text bold>c</Text> 清空日志
          </Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="cyan">
          配置页面
        </Text>
        <Box flexDirection="column" paddingLeft={2}>
          <Text>
            <Text bold>↑/↓</Text> 切换配置区域
          </Text>
          <Text>
            <Text bold>Enter</Text> 进入编辑模式
          </Text>
          <Text>
            <Text bold>Ctrl+S</Text> 保存配置
          </Text>
          <Text>
            <Text bold>Ctrl+R</Text> 重置配置
          </Text>
        </Box>
      </Box>

      {/* 关闭提示 */}
      <Box justifyContent="center" marginTop={1}>
        <Text dimColor>按 h 或 Esc 关闭</Text>
      </Box>
    </Box>
  );
}
