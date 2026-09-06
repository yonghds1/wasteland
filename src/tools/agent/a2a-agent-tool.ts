/**
 * a2a-agent-tool.ts - A2A 远程 Agent 直接工具
 *
 * 每个配置的远程 A2A agent（`settings.a2a.agents`）成为一个直接工具
 * `a2a_<name>`，供主 agent 与子 agent 直接调用（single / multi 模式统一机制）。
 *
 * ## 与旧设计的区别
 *
 * 旧设计把 A2A 寄生在 `spawn_agent` 路由里（per-agent mode:'a2a'/a2aServer），
 * 那条路由已被 pre-dispatch hook 截胡、永不可达（孤儿死代码，已删除）。
 * 新设计中 A2A 是独立工具，不再覆盖 spawn_agent。
 *
 * ## 执行流程
 *
 * ```
 * execute({ task })
 *   ↓
 * A2AClient.sendTaskAsync(task)  → taskId（非阻塞，服务端可能仍 working）
 *   ↓
 * A2AClient.waitForTask(taskId)  → 轮询直到终态
 *   ↓                                (completed / failed / canceled / rejected)
 * 提取 artifacts / status.message 文本 → ToolExecutionResult
 * ```
 */

import { A2AClient } from '@acp/a2a-client.js';
import type { MessagePart, Task } from '@acp/a2a-types.js';
import type { A2AAgentConfig } from '@config/settings-types.js';
import type {
  AgentTool,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolInput,
} from '../core/tool-types.js';

/**
 * A2A 工具名前缀
 *
 * 每个配置的远程 agent 注册为 `a2a_<name>` 工具。
 * 主 agent 工具过滤（filterToolRegistry）放行此前缀，
 * 子 agent 经父 registry 继承默认也能调用。
 */
export const A2A_TOOL_PREFIX = 'a2a_';

/**
 * 由远程 agent 名称生成工具名
 *
 * @param agentName - A2A agent 配置名称（如 `claude-code`）
 * @returns 工具名（如 `a2a_claude-code`）
 */
export function a2aToolName(agentName: string): string {
  return `${A2A_TOOL_PREFIX}${agentName}`;
}

// ============================================================
// 辅助函数：结果提取
// ============================================================

/**
 * 从 MessagePart 列表提取文本内容
 *
 * 仅提取 `type: 'text'` 的 part，用换行拼接。
 * 无文本内容时返回 undefined（便于调用方逐级 fallback）。
 *
 * @param parts - 消息 part 列表
 * @returns 拼接后的文本，或 undefined
 */
function extractTextParts(parts: readonly MessagePart[] | undefined): string | undefined {
  if (!parts) return undefined;
  const text = parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
  return text.length > 0 ? text : undefined;
}

/**
 * 将终态 Task 转换为 ToolExecutionResult
 *
 * - failed / canceled / rejected → error（携带状态消息文本）
 * - completed → success，输出优先取 artifacts 文本，
 *   其次 status.message 文本，最后兜底 'Task completed'
 * - 其他状态（理论上 waitForTask 已保证终态）→ error 防御性处理
 *
 * @param task - 到达终态的任务对象
 * @param agent - 对应的 agent 配置（用于 data 元信息）
 * @returns 工具执行结果
 */
function toToolResult(task: Task, agent: A2AAgentConfig): ToolExecutionResult {
  const state = task.status.state;
  const statusText = extractTextParts(task.status.message?.parts);

  if (state === 'failed') {
    return {
      status: 'error',
      error: statusText ?? 'Remote agent task failed',
    };
  }

  if (state === 'canceled') {
    return { status: 'error', error: 'Remote agent task was canceled' };
  }

  if (state === 'rejected') {
    return { status: 'error', error: statusText ?? 'Remote agent task was rejected' };
  }

  if (state !== 'completed') {
    // waitForTask 只在终态返回，此分支为防御性处理（如服务端返回 unknown 状态）
    return {
      status: 'error',
      error: `Remote agent task ended in unexpected state: ${state}`,
    };
  }

  const output =
    (task.artifacts && extractTextParts(task.artifacts.flatMap((a) => a.parts))) ??
    statusText ??
    'Task completed';

  return {
    status: 'success',
    output,
    data: {
      taskId: task.id,
      sessionId: task.sessionId,
      agentName: agent.name,
      agentUrl: agent.url,
      state,
    },
  };
}

// ============================================================
// 工具工厂
// ============================================================

/**
 * 创建一个远程 A2A agent 的直接调用工具
 *
 * 工具名为 `a2a_<agent.name>`，description 来自 `agent.description`
 * （缺省时给默认值），供 LLM 发现工具用途。
 *
 * @param agent - A2A agent 配置（name / url / token? / description?）
 * @returns AgentTool 实例
 *
 * @example
 * ```typescript
 * const tool = createA2AAgentTool({
 *   name: 'claude-code',
 *   url: 'http://localhost:9200',
 *   description: 'Remote coding agent',
 * });
 * // tool.name === 'a2a_claude-code'
 * const result = await tool.execute(
 *   { task: 'Review this code' },
 *   { sessionId: 's1', turn: 1, cwd: '/tmp' }
 * );
 * ```
 */
export function createA2AAgentTool(agent: A2AAgentConfig): AgentTool {
  return {
    name: a2aToolName(agent.name),
    // 远程 agent 会执行任意动作，按最高风险等级走权限闸门
    riskLevel: 'execute',
    description: agent.description ?? `Remote A2A agent: ${agent.name}`,
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: '发送给远程 Agent 的任务描述',
        },
      },
      required: ['task'],
    },

    async execute(
      input: ToolInput,
      _context: ToolExecutionContext
    ): Promise<ToolExecutionResult> {
      const { task } = input as { task?: unknown };
      if (typeof task !== 'string' || task.trim().length === 0) {
        return {
          status: 'error',
          error: 'Missing required field: task',
        };
      }

      const client = new A2AClient({
        baseUrl: agent.url,
        // 仅透传已解析的明文字 token；未解析的 $auth ref 不发送（避免 Bearer [object Object]）
        token: typeof agent.token === 'string' ? agent.token : undefined,
      });

      try {
        // 异步发送任务（非阻塞），再轮询等待终态，
        // 避免只 sendTask 就返回 working 态导致结果缺失。
        const taskId = await client.sendTaskAsync(task);
        const result = await client.waitForTask(taskId);
        return toToolResult(result, agent);
      } catch (error) {
        // 网络失败 / 超时 / HTTP 错误等统一转 error 结果（工具契约不抛异常）
        return {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
