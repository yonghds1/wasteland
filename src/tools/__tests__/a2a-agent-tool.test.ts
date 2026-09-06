/**
 * a2a-agent-tool.test.ts - A2A 远程 Agent 直接工具单元测试
 *
 * 覆盖：
 * - 工具名 / description / riskLevel / inputSchema
 * - execute：sendTaskAsync + waitForTask 终态提取（artifacts / status.message）
 * - 错误处理：failed / canceled / rejected / 网络错误 / 超时 / 缺失 task
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  A2A_TOOL_PREFIX,
  a2aToolName,
  createA2AAgentTool,
} from '../agent/a2a-agent-tool.js';
import type { A2AAgentConfig } from '@config/settings-types.js';
import type { Task } from '@acp/a2a-types.js';

// ---- mock A2AClient ----
const sendTaskAsync = vi.fn();
const waitForTask = vi.fn();
const clientConstructor = vi.fn();

vi.mock('../../acp/a2a-client.js', () => ({
  A2AClient: class {
    constructor(options: unknown) {
      clientConstructor(options);
    }
    sendTaskAsync = sendTaskAsync;
    waitForTask = waitForTask;
  },
}));

function makeAgent(overrides: Partial<A2AAgentConfig> = {}): A2AAgentConfig {
  return {
    name: 'claude-code',
    url: 'http://localhost:9200',
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-123',
    sessionId: 'session-456',
    status: { state: 'completed' },
    artifacts: [
      {
        parts: [{ type: 'text', text: 'artifact line 1' }, { type: 'text', text: 'artifact line 2' }],
      },
    ],
    ...overrides,
  };
}

const ctx = { sessionId: 's1', turn: 1, cwd: '/tmp' };

describe('a2aToolName / A2A_TOOL_PREFIX', () => {
  it('前缀为 a2a_', () => {
    expect(A2A_TOOL_PREFIX).toBe('a2a_');
  });

  it('工具名 = a2a_<agent.name>', () => {
    expect(a2aToolName('claude-code')).toBe('a2a_claude-code');
    expect(a2aToolName('codex')).toBe('a2a_codex');
  });
});

describe('createA2AAgentTool — 元数据', () => {
  it('工具名使用 a2a_ 前缀 + agent name', () => {
    const tool = createA2AAgentTool(makeAgent());
    expect(tool.name).toBe('a2a_claude-code');
  });

  it('description 优先使用 agent.description', () => {
    const tool = createA2AAgentTool(makeAgent({ description: 'Remote coding agent' }));
    expect(tool.description).toBe('Remote coding agent');
  });

  it('description 缺省时给默认值', () => {
    const tool = createA2AAgentTool(makeAgent());
    expect(tool.description).toBe('Remote A2A agent: claude-code');
  });

  it('riskLevel 为 execute（远程 agent 执行任意动作）', () => {
    const tool = createA2AAgentTool(makeAgent());
    expect(tool.riskLevel).toBe('execute');
  });

  it('inputSchema 声明必填 task 字符串字段', () => {
    const tool = createA2AAgentTool(makeAgent());
    expect(tool.inputSchema).toEqual({
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: expect.any(String),
        },
      },
      required: ['task'],
    });
  });
});

describe('createA2AAgentTool — execute 成功路径', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sendTaskAsync + waitForTask 保证拿到终态，并提取 artifacts 文本', async () => {
    sendTaskAsync.mockResolvedValue('task-123');
    waitForTask.mockResolvedValue(makeTask());

    const tool = createA2AAgentTool(makeAgent());
    const result = await tool.execute({ task: 'Review this code' }, ctx);

    // 异步发送 + 轮询终态（不是只 sendTask 就返回 working 态）
    expect(sendTaskAsync).toHaveBeenCalledWith('Review this code');
    expect(waitForTask).toHaveBeenCalledWith('task-123');

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.output).toBe('artifact line 1\nartifact line 2');
      expect(result.data).toEqual({
        taskId: 'task-123',
        sessionId: 'session-456',
        agentName: 'claude-code',
        agentUrl: 'http://localhost:9200',
        state: 'completed',
      });
    }
  });

  it('无 artifacts 时 fallback 到 status.message 文本', async () => {
    sendTaskAsync.mockResolvedValue('task-1');
    waitForTask.mockResolvedValue(
      makeTask({
        artifacts: undefined,
        status: {
          state: 'completed',
          message: { role: 'agent', parts: [{ type: 'text', text: 'done via message' }] },
        },
      })
    );

    const tool = createA2AAgentTool(makeAgent());
    const result = await tool.execute({ task: 'do it' }, ctx);

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.output).toBe('done via message');
    }
  });

  it('artifacts 为空文本时 fallback 到 status.message，再 fallback 到兜底文案', async () => {
    sendTaskAsync.mockResolvedValue('task-2');
    waitForTask.mockResolvedValue(makeTask({ artifacts: [], status: { state: 'completed' } }));

    const tool = createA2AAgentTool(makeAgent());
    const result = await tool.execute({ task: 'do it' }, ctx);

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.output).toBe('Task completed');
    }
  });

  it('使用 agent.url 和 agent.token 构造 A2AClient', async () => {
    sendTaskAsync.mockResolvedValue('task-3');
    waitForTask.mockResolvedValue(makeTask());

    const tool = createA2AAgentTool(makeAgent({ token: 'secret-token' }));
    await tool.execute({ task: 'ping' }, ctx);

    expect(clientConstructor).toHaveBeenCalledWith({
      baseUrl: 'http://localhost:9200',
      token: 'secret-token',
    });
  });
});

describe('createA2AAgentTool — execute 错误处理', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('缺失 task 字段返回 error（不调用 client）', async () => {
    const tool = createA2AAgentTool(makeAgent());
    const result = await tool.execute({}, ctx);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error).toContain('task');
    }
    expect(sendTaskAsync).not.toHaveBeenCalled();
  });

  it('空白 task 返回 error', async () => {
    const tool = createA2AAgentTool(makeAgent());
    const result = await tool.execute({ task: '   ' }, ctx);

    expect(result.status).toBe('error');
    expect(sendTaskAsync).not.toHaveBeenCalled();
  });

  it('failed 终态返回 error，携带状态消息文本', async () => {
    sendTaskAsync.mockResolvedValue('task-f');
    waitForTask.mockResolvedValue(
      makeTask({
        status: {
          state: 'failed',
          message: { role: 'agent', parts: [{ type: 'text', text: 'boom: compile error' }] },
        },
      })
    );

    const tool = createA2AAgentTool(makeAgent());
    const result = await tool.execute({ task: 'build' }, ctx);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error).toBe('boom: compile error');
    }
  });

  it('failed 无消息时使用默认错误文案', async () => {
    sendTaskAsync.mockResolvedValue('task-f2');
    waitForTask.mockResolvedValue(makeTask({ status: { state: 'failed' } }));

    const tool = createA2AAgentTool(makeAgent());
    const result = await tool.execute({ task: 'build' }, ctx);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error).toBe('Remote agent task failed');
    }
  });

  it('canceled 终态返回 error', async () => {
    sendTaskAsync.mockResolvedValue('task-c');
    waitForTask.mockResolvedValue(makeTask({ status: { state: 'canceled' } }));

    const tool = createA2AAgentTool(makeAgent());
    const result = await tool.execute({ task: 'x' }, ctx);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error).toContain('canceled');
    }
  });

  it('rejected 终态返回 error', async () => {
    sendTaskAsync.mockResolvedValue('task-r');
    waitForTask.mockResolvedValue(makeTask({ status: { state: 'rejected' } }));

    const tool = createA2AAgentTool(makeAgent());
    const result = await tool.execute({ task: 'x' }, ctx);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error).toContain('rejected');
    }
  });

  it('网络失败（sendTaskAsync reject）返回 error 结果而非抛异常', async () => {
    sendTaskAsync.mockRejectedValue(new Error('ECONNREFUSED'));

    const tool = createA2AAgentTool(makeAgent());
    const result = await tool.execute({ task: 'x' }, ctx);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error).toBe('ECONNREFUSED');
    }
  });

  it('waitForTask 超时返回 error 结果', async () => {
    sendTaskAsync.mockResolvedValue('task-t');
    waitForTask.mockRejectedValue(new Error('Timeout waiting for task task-t to complete'));

    const tool = createA2AAgentTool(makeAgent());
    const result = await tool.execute({ task: 'x' }, ctx);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error).toContain('Timeout');
    }
  });

  it('非 Error 抛出物转字符串', async () => {
    sendTaskAsync.mockRejectedValue('raw failure');

    const tool = createA2AAgentTool(makeAgent());
    const result = await tool.execute({ task: 'x' }, ctx);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error).toBe('raw failure');
    }
  });
});
