/**
 * acp-inheritance.test.ts - 子 agent 继承 acp_ 工具链路测试
 *
 * 验证关键链路：
 * 主 agent 过滤后 registry（含 acp_*，见 filterToolRegistry 放行）
 *   → dispatch-handler 把它作为 SpawnAgentContext.toolRegistry 传给子 agent
 *   → buildChildToolRegistry 默认继承分支（无 tools 白名单时）
 *   → 子 agent 拿到 acp_ 工具（"子 agent 默认可调"）
 */

import { describe, it, expect } from 'vitest';
import { buildChildToolRegistry } from '../context-builder.js';
import { ToolRegistry } from '../../../core/tool-registry.js';
import type { AgentTool } from '../../../core/tool-types.js';
import { reportResultTool } from '../../../interaction/report-result.js';
import type { SpawnAgentContext } from '../types.js';

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

/**
 * 构造父 context：toolRegistry 模拟主 agent 过滤后的 registry
 * （spawn_agent / read-file / bash + acp_*，见 filterToolRegistry）
 */
function makeParentContext(): SpawnAgentContext {
  const registry = new ToolRegistry([
    fakeTool('spawn_agent'),
    fakeTool('read-file'),
    fakeTool('bash'),
    fakeTool('acp_claude_code'),
    fakeTool('acp_codex'),
  ]);
  // buildChildToolRegistry 仅消费 context.toolRegistry，其余字段不参与逻辑
  return { toolRegistry: registry } as unknown as SpawnAgentContext;
}

describe('buildChildToolRegistry — acp_ 工具继承', () => {
  it('无 tools 白名单时子 agent 继承父 registry 的全部 acp_ 工具', () => {
    const childRegistry = buildChildToolRegistry(undefined, makeParentContext(), reportResultTool);

    expect(childRegistry).toBeDefined();
    const names = childRegistry?.list() ?? [];
    expect(names).toContain('acp_claude_code');
    expect(names).toContain('acp_codex');
    // 同时继承其他父工具 + 强制注入 report_result
    expect(names).toContain('spawn_agent');
    expect(names).toContain('read-file');
    expect(names).toContain('bash');
    expect(names).toContain('report_result');
  });

  it('空白名单数组同样走继承分支', () => {
    const childRegistry = buildChildToolRegistry([], makeParentContext(), reportResultTool);

    const names = childRegistry?.list() ?? [];
    expect(names).toContain('acp_claude_code');
    expect(names).toContain('acp_codex');
  });

  it('配置 tools 白名单时仅取白名单工具（acp_ 需显式列出）+ report_result', () => {
    const childRegistry = buildChildToolRegistry(
      ['read-file', 'acp_codex'],
      makeParentContext(),
      reportResultTool
    );

    const names = childRegistry?.list() ?? [];
    expect(names).toContain('read-file');
    expect(names).toContain('acp_codex');
    expect(names).toContain('report_result');
    // 未列出的工具不进入子 registry
    expect(names).not.toContain('acp_claude_code');
    expect(names).not.toContain('bash');
  });
});
