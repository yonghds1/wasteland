/**
 * default-registry.test.ts - 默认工具注册表单元测试
 *
 * 覆盖：
 * - 选项对象签名
 * - acp.agents → 注册为直接工具 `acp_<name>`
 * - spawn_agent 保持本地占位工具（不被远程 agent 覆盖）
 * - 返回值含 MCP 生命周期，无残留 A2A 生命周期壳
 */

import { describe, it, expect } from 'vitest';
import { createDefaultToolRegistry } from '../core/default-registry.js';
import { SPAWN_AGENT_DESCRIPTION } from '@tools/agent/spawn-agent/index.js';
import type { ACPSettings, AcpAgentConfig } from '@config/settings-types.js';

function makeACPSettings(agents: AcpAgentConfig[] = [], defaults?: ACPSettings['defaults']): ACPSettings {
  return { agents, ...(defaults ? { defaults } : {}) };
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
    // 无 ACP 配置时不应有 acp_ 工具
    expect(names.filter((n) => n.startsWith('acp_'))).toHaveLength(0);
  });

  it('spawn_agent 保持本地占位工具（description 不被远程 agent 覆盖）', () => {
    const { toolRegistry } = createDefaultToolRegistry({
      acp: makeACPSettings([{ name: 'codex', command: 'npx', args: ['-y', 'codex-acp'] }]),
    });

    const spawn = toolRegistry.get('spawn_agent');
    expect(spawn).toBeDefined();
    expect(spawn?.description).toBe(SPAWN_AGENT_DESCRIPTION);
  });
});

describe('createDefaultToolRegistry — ACP 直接工具', () => {
  it('acp.agents 逐个注册为 acp_<name> 工具', () => {
    const { toolRegistry } = createDefaultToolRegistry({
      acp: makeACPSettings([
        { name: 'claude_code', command: 'npx', description: 'Remote coding agent' },
        { name: 'codex', command: 'npx' },
      ]),
    });

    const names = toolRegistry.list();
    expect(names).toContain('acp_claude_code');
    expect(names).toContain('acp_codex');

    const claudeTool = toolRegistry.get('acp_claude_code');
    expect(claudeTool?.description).toBe('Remote coding agent');
    expect(claudeTool?.riskLevel).toBe('execute');
  });

  it('acp 缺省时不注册 ACP 工具', () => {
    const { toolRegistry } = createDefaultToolRegistry({});
    expect(toolRegistry.list().filter((n) => n.startsWith('acp_'))).toHaveLength(0);
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

describe('createDefaultToolRegistry — 返回值', () => {
  it('不残留旧 A2A 生命周期壳，MCP 生命周期保留', () => {
    const result = createDefaultToolRegistry({
      acp: makeACPSettings([{ name: 'codex', command: 'npx' }]),
    });

    expect(result).not.toHaveProperty('a2aRegistry');
    expect(result).not.toHaveProperty('startA2A');
    expect(result).not.toHaveProperty('stopA2A');
    expect(typeof result.startMCP).toBe('function');
    expect(typeof result.stopMCP).toBe('function');
  });
});
