import React from 'react';
import { Box, Text } from 'ink';
import { wastelandTheme } from '@theme/wasteland/index.js';
import type { FlatAgentTreeNode } from './types.js';

export interface AgentTreeNodeRowProps {
  item: FlatAgentTreeNode;
  isSelected: boolean;
  width: number;
}

export function AgentTreeNodeRow({
  item,
  isSelected,
  width,
}: AgentTreeNodeRowProps): React.ReactElement {
  const { node, hasChildren, isCollapsed, prefix } = item;

  // 折叠与叶子节点指示符
  const arrow = hasChildren ? (isCollapsed ? '▶ ' : '▼ ') : '● ';

  // 状态颜色与徽章文本
  let statusBadge: string;
  let statusColor: string;

  switch (node.status) {
    case 'completed':
      statusBadge = '[DONE]';
      statusColor = wastelandTheme.colors.success;
      break;
    case 'failed':
    case 'timeout':
      statusBadge = '[FAIL]';
      statusColor = wastelandTheme.colors.error;
      break;
    case 'idle':
      statusBadge = '[IDLE]';
      statusColor = wastelandTheme.colors.muted;
      break;
    default:
      statusBadge = '[RUN]';
      statusColor = wastelandTheme.colors.primary;
      break;
  }

  const roleText = node.roleName ? ` (${node.roleName})` : '';
  const toolText = node.activeTool ? ` ⚡${node.activeTool}` : '';
  const stepText = node.stepCount ? ` [${node.stepCount}s]` : '';

  return (
    <Box
      flexDirection="row"
      width={width}
      height={1}
      overflow="hidden"
    >
      <Text wrap="truncate-end">
        <Text color={wastelandTheme.colors.muted} dimColor>
          {prefix}
        </Text>
        <Text color={hasChildren ? wastelandTheme.colors.textEmphasized : wastelandTheme.colors.muted}>
          {arrow}
        </Text>
        <Text color={statusColor} bold>
          {statusBadge}{' '}
        </Text>
        <Text
          color={isSelected ? wastelandTheme.colors.primary : wastelandTheme.colors.text}
          bold={isSelected}
        >
          {node.name}
          {roleText}
        </Text>
        {toolText && (
          <Text color={wastelandTheme.colors.secondary}>
            {toolText}
          </Text>
        )}
        {stepText && (
          <Text color={wastelandTheme.colors.muted} dimColor>
            {stepText}
          </Text>
        )}
      </Text>
    </Box>
  );
}
