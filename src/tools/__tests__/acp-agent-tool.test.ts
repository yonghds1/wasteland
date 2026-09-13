/**
 * acp-agent-tool.test.ts - ACP 直接工具单测
 *
 * mock AcpClient，验证工具名、输入校验、stopReason 映射与异常兜底。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AcpPromptResult } from '@acp/acp-client.js';

const promptMock = vi.fn();
const spawnMock = vi.fn();
const disposeMock = vi.fn();

vi.mock('@acp/acp-client.js', () => ({
  AcpClient: {
    spawn: (...args: unknown[]) => spawnMock(...args),
  },
}));

import { createAcpAgentTool, acpToolName, toToolResult, ACP_TOOL_PREFIX } from '../agent/acp-agent-tool.js';
import type { AcpAgentConfig } from '@config/settings-types.js';

const agent: AcpAgentConfig = {
  name: 'claude_code',
  command: 'npx',
  args: ['-y', '@agentclientprotocol/claude-agent-acp'],
  description: '本地 Claude Code',
};

const ctx = { sessionId: 's1', turn: 1, cwd: '/tmp' };

beforeEach(() => {
  vi.clearAllMocks();
  spawnMock.mockResolvedValue({
    prompt: promptMock,
    dispose: disposeMock,
    cancel: vi.fn(),
  });
});

describe('acpToolName', () => {
  it('生成 acp_<name> 工具名', () => {
    expect(acpToolName('claude_code')).toBe('acp_claude_code');
    expect(ACP_TOOL_PREFIX).toBe('acp_');
  });
});

describe('createAcpAgentTool', () => {
  it('工具元信息：name / riskLevel / description / schema', () => {
    const tool = createAcpAgentTool(agent);
    expect(tool.name).toBe('acp_claude_code');
    expect(tool.riskLevel).toBe('execute');
    expect(tool.description).toBe('本地 Claude Code');
    expect(tool.inputSchema?.required).toEqual(['task']);
  });

  it('缺省 description 给默认值', () => {
    const tool = createAcpAgentTool({ name: 'x', command: 'x' });
    expect(tool.description).toContain('x');
  });

  it('空 task → error，不 spawn', async () => {
    const tool = createAcpAgentTool(agent);
    const r = await tool.execute({ task: '   ' }, ctx);
    expect(r.status).toBe('error');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('happy：end_turn → success，output 为聚合文本', async () => {
    promptMock.mockResolvedValue({ stopReason: 'end_turn', text: 'done!' } satisfies AcpPromptResult);
    const tool = createAcpAgentTool(agent);
    const r = await tool.execute({ task: 'refactor' }, ctx);
    expect(r).toMatchObject({ status: 'success', output: 'done!' });
    expect(spawnMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'claude_code', command: 'npx', cwd: '/tmp' })
    );
    expect(disposeMock).toHaveBeenCalledOnce();
  });

  it('agent cwd 覆盖 context.cwd', async () => {
    promptMock.mockResolvedValue({ stopReason: 'end_turn', text: 'x' });
    const tool = createAcpAgentTool({ ...agent, cwd: '/repo' });
    await tool.execute({ task: 't' }, ctx);
    expect(spawnMock).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/repo' }));
  });

  it('refusal → error', async () => {
    promptMock.mockResolvedValue({ stopReason: 'refusal', text: 'nope' });
    const tool = createAcpAgentTool(agent);
    const r = await tool.execute({ task: 't' }, ctx);
    expect(r).toMatchObject({ status: 'error', error: 'nope' });
  });

  it('max_tokens → success 且标注截断', async () => {
    promptMock.mockResolvedValue({ stopReason: 'max_tokens', text: 'partial' });
    const tool = createAcpAgentTool(agent);
    const r = await tool.execute({ task: 't' }, ctx);
    expect(r.status).toBe('success');
    expect((r as { output: string }).output).toContain('truncated');
  });

  it('end_turn 空文本 → 兜底提示', async () => {
    promptMock.mockResolvedValue({ stopReason: 'end_turn', text: '' });
    const tool = createAcpAgentTool(agent);
    const r = await tool.execute({ task: 't' }, ctx);
    expect(r.status).toBe('success');
    expect((r as { output: string }).output).toContain('no text output');
  });

  it('spawn/prompt 抛错 → error，且 finally 仍 dispose', async () => {
    spawnMock.mockRejectedValueOnce(new Error('ENOENT'));
    const tool = createAcpAgentTool(agent);
    const r = await tool.execute({ task: 't' }, ctx);
    expect(r).toMatchObject({ status: 'error', error: 'ENOENT' });

    spawnMock.mockResolvedValue({
      prompt: vi.fn().mockRejectedValue(new Error('TIMEOUT')),
      dispose: disposeMock,
    });
    const r2 = await tool.execute({ task: 't' }, ctx);
    expect(r2).toMatchObject({ status: 'error', error: 'TIMEOUT' });
    expect(disposeMock).toHaveBeenCalled();
  });
});

describe('toToolResult', () => {
  const mk = (stopReason: Parameters<typeof toToolResult>[0], text = 'out') =>
    toToolResult(stopReason, text, agent);

  it('五种 stopReason 映射齐全', () => {
    expect(mk('end_turn')).toMatchObject({ status: 'success', output: 'out' });
    expect(mk('refusal')).toMatchObject({ status: 'error' });
    expect(mk('cancelled')).toMatchObject({ status: 'error' });
    expect(mk('max_tokens').status).toBe('success');
    expect(mk('max_turn_requests').status).toBe('success');
  });

  it('data 携带 agentName / stopReason', () => {
    const r = mk('end_turn');
    expect((r as { data?: unknown }).data).toMatchObject({
      agentName: 'claude_code',
      stopReason: 'end_turn',
    });
  });
});
