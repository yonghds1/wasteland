/**
 * default-registry.test.ts - 默认工具注册表单元测试
 *
 * 覆盖 Phase 2 A2A 重设计：
 * - 选项对象签名（替代 4 个位置参数）
 * - a2a.agents → 注册为直接工具 `a2a_<name>`
 * - a2a.servers → 不注册为工具（本机托管职责，与工具无关）
 * - spawn_agent 保持本地占位工具（不再被 A2A 覆盖）
 * - 返回值不再包含旧 A2A 生命周期壳（startA2A / stopA2A / a2aRegistry）
 */

import { describe, it, expect } from 'vitest';
import { createDefaultToolRegistry } from '../core/default-registry.js';
import { SPAWN_AGENT_DESCRIPTION } from '@tools/agent/spawn-agent/index.js';
import type { A2ASettings } from '@config/settings-types.js';

function makeA2ASettings(
  agents: A2ASettings['agents'] = [],
  servers: A2ASettings['servers'] = {}
): A2ASettings {
  return { agents, servers };
}

describe('createDefaultToolRegistry — 基础工具', () => {
  it('无选项时注册全部内置工具（含 spawn_agent 占位）', () => {
    const { toolRegistry } = createDefaultToolRegistry();

    const names = toolRegistry.list();
    expect(names).toContain('read-file');
    expect(names).toContain('bash');
    expect(names).toContain('edit-file');
    expect(names).toContain('write-file');
    expect(names).toContain('spawn_agent');
    // 无 A2A 配置时不应有 a2a_ 工具
    expect(names.filter((n) => n.startsWith('a2a_'))).toHaveLength(0);
  });

  it('spawn_agent 保持本地占位工具（description 不被 A2A 覆盖）', () => {
    const { toolRegistry } = createDefaultToolRegistry({
      a2a: makeA2ASettings([{ name: 'codex', url: 'http://localhost:9300' }]),
    });

    const spawn = toolRegistry.get('spawn_agent');
    expect(spawn).toBeDefined();
    expect(spawn?.description).toBe(SPAWN_AGENT_DESCRIPTION);
  });
});

describe('createDefaultToolRegistry — A2A 直接工具', () => {
  it('a2a.agents 逐个注册为 a2a_<name> 工具', () => {
    const { toolRegistry } = createDefaultToolRegistry({
      a2a: makeA2ASettings([
        { name: 'claude-code', url: 'http://localhost:9200', description: 'Remote coding agent' },
        { name: 'codex', url: 'http://localhost:9300' },
      ]),
    });

    const names = toolRegistry.list();
    expect(names).toContain('a2a_claude-code');
    expect(names).toContain('a2a_codex');

    const claudeTool = toolRegistry.get('a2a_claude-code');
    expect(claudeTool?.description).toBe('Remote coding agent');
    expect(claudeTool?.riskLevel).toBe('execute');
  });

  it('a2a.servers 不注册为工具', () => {
    const { toolRegistry } = createDefaultToolRegistry({
      a2a: makeA2ASettings([], {
        'claude-code': {
          enabled: true,
          port: 9200,
          command: 'claude',
          description: 'Local server',
        },
      }),
    });

    const names = toolRegistry.list();
    expect(names.filter((n) => n.startsWith('a2a_'))).toHaveLength(0);
    expect(names).not.toContain('claude-code');
  });

  it('a2a 缺省时不注册 A2A 工具', () => {
    const { toolRegistry } = createDefaultToolRegistry({});
    expect(toolRegistry.list().filter((n) => n.startsWith('a2a_'))).toHaveLength(0);
  });
});

describe('createDefaultToolRegistry — MCP', () => {
  it('配置 mcpServers 时创建 mcpRegistry 并添加占位工具', () => {
    const result = createDefaultToolRegistry({
      mcpServers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@mcp/filesystem'],
        },
      },
    });

    expect(result.mcpRegistry).toBeDefined();
    expect(result.toolRegistry.list()).toContain('filesystem/*');
  });

  it('未配置 mcpServers 时 mcpRegistry 为 undefined', () => {
    const result = createDefaultToolRegistry();
    expect(result.mcpRegistry).toBeUndefined();
  });
});

describe('createDefaultToolRegistry — 返回值（旧 A2A 生命周期壳已移除）', () => {
  it('不再返回 a2aRegistry / startA2A / stopA2A', () => {
    const result = createDefaultToolRegistry({
      a2a: makeA2ASettings([{ name: 'codex', url: 'http://localhost:9300' }]),
    });

    expect(result).not.toHaveProperty('a2aRegistry');
    expect(result).not.toHaveProperty('startA2A');
    expect(result).not.toHaveProperty('stopA2A');
    // MCP 生命周期保留
    expect(typeof result.startMCP).toBe('function');
    expect(typeof result.stopMCP).toBe('function');
  });
});
