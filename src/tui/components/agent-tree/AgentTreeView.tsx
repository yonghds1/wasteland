import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { buildAgentTree, flattenAgentTree } from './tree-builder.js';
import { AgentTreeNodeRow } from './AgentTreeNodeRow.js';
import { AgentAbortRegistry } from '../../../tools/agent/spawn-agent/abort-registry.js';
import type { AgentNode } from '../../context/AppContext.js';

export interface AgentTreeViewProps {
  agents: AgentNode[];
  width: number;
  height?: number;
  isActive?: boolean;
  onSelectAgent?: (agentId: string | undefined) => void;
  onNotification?: (msg: string) => void;
}

export function AgentTreeView({
  agents,
  width,
  height,
  isActive = false,
  onSelectAgent,
  onNotification,
}: AgentTreeViewProps): React.ReactElement {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [selectedIndex, setSelectedIndex] = useState(0);

  const treeRoots = useMemo(() => buildAgentTree(agents), [agents]);
  const flatNodes = useMemo(
    () => flattenAgentTree(treeRoots, collapsedIds),
    [treeRoots, collapsedIds]
  );

  // 键盘操作（仅当获得焦点或在 InspectorPanel 中激活时生效）
  useInput(
    (input, key) => {
      if (!isActive || flatNodes.length === 0) return;

      if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex((prev) => Math.min(flatNodes.length - 1, prev + 1));
        return;
      }

      const current = flatNodes[selectedIndex];
      if (!current) return;

      // Enter 或 Space: 切换折叠 / 展开
      if (key.return || input === ' ') {
        if (current.hasChildren) {
          setCollapsedIds((prev) => {
            const next = new Set(prev);
            if (next.has(current.node.id)) {
              next.delete(current.node.id);
            } else {
              next.add(current.node.id);
            }
            return next;
          });
        }
        return;
      }

      // v: 切换视口联动
      if (input === 'v' || input === 'V') {
        const targetId = current.isRoot ? undefined : current.node.id;
        onSelectAgent?.(targetId);
        onNotification?.(`✓ 已切换视口至: ${current.node.name}`);
        return;
      }

      // k: 单独中止子 Agent
      if (input === 'k' || input === 'K') {
        if (current.isRoot) {
          onNotification?.('⚠️ 无法中止 Main Agent。如需退出请按 Ctrl+C。');
          return;
        }
        if (current.node.status === 'running') {
          const ok = AgentAbortRegistry.getInstance().abort(current.node.id);
          if (ok) {
            onNotification?.(`✓ 已向子 Agent "${current.node.name}" 发送中止信号。`);
          } else {
            onNotification?.(`⚠️ 子 Agent "${current.node.name}" 未注册独立信号或已退出。`);
          }
        } else {
          onNotification?.(`ℹ️ Agent "${current.node.name}" 当前不是运行中状态。`);
        }
      }
    },
    { isActive }
  );

  if (flatNodes.length === 0) {
    return (
      <Box width={width} height={1}>
        <Text color={wastelandTheme.colors.muted} dimColor>
          暂无活跃子 Agent
        </Text>
      </Box>
    );
  }

  const availableHeight = height ?? flatNodes.length;
  const visibleNodes = flatNodes.slice(0, availableHeight);

  return (
    <Box flexDirection="column" width={width}>
      {visibleNodes.map((item, idx) => (
        <AgentTreeNodeRow
          key={item.node.id}
          item={item}
          isSelected={isActive && idx === selectedIndex}
          width={width}
        />
      ))}
    </Box>
  );
}
