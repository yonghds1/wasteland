/**
 * ExitConfirm - 退出确认提示
 *
 * 简单的退出确认提示组件
 */

import React from "react";
import { Text, Box } from "ink";

interface ExitConfirmProps {
  width?: number;
}

export function ExitConfirm({ width }: ExitConfirmProps): React.ReactElement {
  const modalWidth = width ? Math.min(width - 4, 40) : 40;

  return (
    <Box
      flexDirection="column"
      width={modalWidth}
      borderStyle="double"
      borderColor="yellow"
      paddingX={2}
      paddingY={1}
    >
      {/* 警告图标和消息 */}
      <Box justifyContent="center" marginBottom={1}>
        <Text bold color="yellow">
          ⚠ 确认退出
        </Text>
      </Box>

      {/* 分隔线 */}
      <Box marginBottom={1}>
        <Text dimColor>{"─".repeat(modalWidth - 6)}</Text>
      </Box>

      {/* 确认提示 */}
      <Box justifyContent="center">
        <Text>
          按 <Text bold color="green">y</Text> 确认退出
        </Text>
      </Box>
      <Box justifyContent="center">
        <Text>
          按 <Text bold color="red">n</Text> 或其他键取消
        </Text>
      </Box>
    </Box>
  );
}
