import type { AgentNode as ContextAgentNode } from '../../context/AppContext.js';
import type { AgentTreeNode, FlatAgentTreeNode } from './types.js';

export type InputAgentNode = ContextAgentNode & {
  parentId?: string;
  activeTool?: string;
};

/**
 * 将平铺的 Agent 列表根据 parentId 组织成树状结构
 */
export function buildAgentTree(agents: InputAgentNode[]): AgentTreeNode[] {
  if (agents.length === 0) return [];

  const nodeMap = new Map<string, AgentTreeNode>();

  for (const a of agents) {
    nodeMap.set(a.id, {
      ...a,
      children: [],
    });
  }

  const roots: AgentTreeNode[] = [];

  for (const a of agents) {
    const current = nodeMap.get(a.id);
    if (!current) continue;

    // 如果指定了 parentId 且父节点存在
    const parent = a.parentId ? nodeMap.get(a.parentId) : undefined;
    if (parent && parent.id !== a.id) {
      parent.children.push(current);
    } else {
      // 否则为根节点（Main Agent 或无父级）
      roots.push(current);
    }
  }

  return roots;
}

/**
 * 将树状结构展平为带树状引导线（├─, └─, │  ）的平铺列表供 Ink 渲染与键盘光标导航
 */
export function flattenAgentTree(
  roots: AgentTreeNode[],
  collapsedIds: Set<string> = new Set()
): FlatAgentTreeNode[] {
  const result: FlatAgentTreeNode[] = [];

  function traverse(
    node: AgentTreeNode,
    depth: number,
    isRoot: boolean,
    parentPrefix: string,
    isLastChild: boolean
  ): void {
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsedIds.has(node.id);

    let currentPrefix: string;
    let nextChildPrefix: string;

    if (isRoot) {
      currentPrefix = '';
      nextChildPrefix = '';
    } else {
      currentPrefix = parentPrefix + (isLastChild ? '└─ ' : '├─ ');
      nextChildPrefix = parentPrefix + (isLastChild ? '   ' : '│  ');
    }

    result.push({
      node,
      depth,
      isRoot,
      hasChildren,
      isCollapsed,
      prefix: currentPrefix,
    });

    if (hasChildren && !isCollapsed) {
      node.children.forEach((child, idx) => {
        const last = idx === node.children.length - 1;
        traverse(child, depth + 1, false, nextChildPrefix, last);
      });
    }
  }

  roots.forEach((root) => {
    traverse(root, 0, true, '', true);
  });

  return result;
}
