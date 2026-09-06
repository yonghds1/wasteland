/**
 * filter-tool-registry.test.ts - 主 agent 工具过滤单元测试
 *
 * 覆盖 Phase 2 过滤放行规则：
 * - 白名单过滤（MAIN_AGENT_TOOL_NAMES）
 * - a2a_ 前缀工具默认放行（A2A 远程 agent 直接工具）
 * - 白名单与 a2a_ 前缀重叠时去重
 */

import { describe, it, expect } from 'vitest';
import {
  MAIN_AGENT_TOOL_NAMES,
  filterToolRegistry,
} from '../agent-loop.js';
import { ToolRegistry } from '../../../tools/tool-registry.js';
import type { AgentTool } from '../../../tools/tool-types.js';

/** 构造测试用假工具 */
function fakeTool(name: string): AgentTool {
  return {
    name,
    riskLevel: 'read',
    async execute() {
      return { status: 'success', output: '' };
    },
  };
}

/** 构造含全部常见工具 + A2A 工具的完整 registry */
function makeFullRegistry(): ToolRegistry {
  return new ToolRegistry([
    fakeTool('spawn_agent'),
    fakeTool('read-file'),
    fakeTool('bash'),
    fakeTool('edit-file'),
    fakeTool('write-file'),
    fakeTool('glob'),
    fakeTool('grep'),
    fakeTool('a2a_claude-code'),
    fakeTool('a2a_codex'),
  ]);
}

describe('MAIN_AGENT_TOOL_NAMES', () => {
  it('包含核心决策工具集', () => {
    expect(MAIN_AGENT_TOOL_NAMES).toEqual([
      'spawn_agent',
      'read-file',
      'list-directory',
      'glob',
      'grep',
      'bash',
      'tui_update_panel',
    ]);
  });
});

describe('filterToolRegistry — 白名单过滤', () => {
  it('仅保留白名单中的工具（过滤 edit-file / write-file 等）', () => {
    const filtered = filterToolRegistry(makeFullRegistry(), ['spawn_agent', 'read-file', 'bash', 'a2a_']);
    // 注意：'a2a_' 本身不是工具名，不会命中白名单；a2a_ 工具由前缀放行进入
    const names = filtered.list();
    expect(names).toContain('spawn_agent');
    expect(names).toContain('read-file');
    expect(names).toContain('bash');
    expect(names).not.toContain('edit-file');
    expect(names).not.toContain('write-file');
    expect(names).not.toContain('glob');
    expect(names).not.toContain('grep');
  });

  it('白名单中不存在的工具名被跳过', () => {
    const registry = new ToolRegistry([fakeTool('read-file')]);
    const filtered = filterToolRegistry(registry, ['read-file', 'nonexistent']);
    expect(filtered.list()).toEqual(['read-file']);
  });
});

describe('filterToolRegistry — a2a_ 前缀放行', () => {
  it('a2a_ 前缀工具即使不在白名单也穿过过滤', () => {
    const filtered = filterToolRegistry(makeFullRegistry(), MAIN_AGENT_TOOL_NAMES);
    const names = filtered.list();

    expect(names).toContain('a2a_claude-code');
    expect(names).toContain('a2a_codex');
  });

  it('主 agent 最终工具集 = 白名单 + 全部 a2a_ 工具', () => {
    const filtered = filterToolRegistry(makeFullRegistry(), MAIN_AGENT_TOOL_NAMES);
    expect(filtered.list().sort()).toEqual(
      [
        'spawn_agent',
        'read-file',
        'bash',
        'list-directory',
        'glob',
        'grep',
        'a2a_claude-code',
        'a2a_codex',
      ].filter(t => makeFullRegistry().get(t)).sort()
    );
  });

  it('无 a2a_ 工具时退化为纯白名单过滤', () => {
    const registry = new ToolRegistry([
      fakeTool('spawn_agent'),
      fakeTool('read-file'),
      fakeTool('bash'),
      fakeTool('edit-file'),
    ]);
    const filtered = filterToolRegistry(registry, MAIN_AGENT_TOOL_NAMES);
    expect(filtered.list().sort()).toEqual(['bash', 'read-file', 'spawn_agent']);
  });

  it('a2a_ 工具同时出现在白名单时不重复注册', () => {
    const registry = makeFullRegistry();
    const filtered = filterToolRegistry(registry, [...MAIN_AGENT_TOOL_NAMES, 'a2a_codex']);

    const names = filtered.list();
    expect(names.filter((n) => n === 'a2a_codex')).toHaveLength(1);
    expect(names).toContain('a2a_claude-code');
  });

  it('保留的是 registry 中的同一工具实例', () => {
    const registry = makeFullRegistry();
    const filtered = filterToolRegistry(registry, MAIN_AGENT_TOOL_NAMES);
    expect(filtered.get('a2a_claude-code')).toBe(registry.get('a2a_claude-code'));
    expect(filtered.get('spawn_agent')).toBe(registry.get('spawn_agent'));
  });
});
