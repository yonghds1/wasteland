import type { AgentNode as ContextAgentNode } from '../../context/AppContext.js';

export interface AgentTreeNode extends ContextAgentNode {
  parentId?: string;
  activeTool?: string;
  children: AgentTreeNode[];
}

export interface FlatAgentTreeNode {
  node: AgentTreeNode;
  depth: number;
  isRoot: boolean;
  hasChildren: boolean;
  isCollapsed: boolean;
  prefix: string;
}
