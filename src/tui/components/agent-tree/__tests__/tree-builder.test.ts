import { describe, it, expect } from 'vitest';
import { buildAgentTree, flattenAgentTree, type InputAgentNode } from '../tree-builder.js';

describe('tree-builder', () => {
  it('正确根据 parentId 构建多层级树 (Main -> Child -> Grandchild)', () => {
    const agents: InputAgentNode[] = [
      { id: 'main', name: 'Main', depth: 0, status: 'running', startTime: 100 },
      { id: 'c1', parentId: 'main', name: 'Child1', depth: 1, status: 'completed', startTime: 105 },
      { id: 'c2', parentId: 'main', name: 'Child2', depth: 1, status: 'running', startTime: 110 },
      { id: 'g1', parentId: 'c2', name: 'Grandchild1', depth: 2, status: 'running', startTime: 115 },
    ];

    const tree = buildAgentTree(agents);
    expect(tree.length).toBe(1);
    expect(tree[0]?.id).toBe('main');
    expect(tree[0]?.children.length).toBe(2);
    expect(tree[0]?.children[1]?.children.length).toBe(1);
    expect(tree[0]?.children[1]?.children[0]?.id).toBe('g1');
  });

  it('展平树结构并包含正确的折叠与树状引导线', () => {
    const agents: InputAgentNode[] = [
      { id: 'main', name: 'Main', depth: 0, status: 'running', startTime: 100 },
      { id: 'c1', parentId: 'main', name: 'Child1', depth: 1, status: 'completed', startTime: 105 },
      { id: 'c2', parentId: 'main', name: 'Child2', depth: 1, status: 'running', startTime: 110 },
    ];

    const tree = buildAgentTree(agents);
    const flatAll = flattenAgentTree(tree);
    expect(flatAll.length).toBe(3);
    expect(flatAll[0]?.prefix).toBe('');
    expect(flatAll[1]?.prefix).toBe('├─ ');
    expect(flatAll[2]?.prefix).toBe('└─ ');

    // 折叠 main
    const collapsed = new Set(['main']);
    const flatCollapsed = flattenAgentTree(tree, collapsed);
    expect(flatCollapsed.length).toBe(1);
    expect(flatCollapsed[0]?.isCollapsed).toBe(true);
  });
});
