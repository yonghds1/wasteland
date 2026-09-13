/**
 * acp-agent-tool.ts - ACP 远程 Agent 直接工具
 *
 * 每个配置的 ACP agent（`settings.acp.agents`）成为一个直接工具
 * `acp_<name>`，供主 agent 与子 agent 调用（single / multi 模式统一机制）。
 *
 * 一次 `prompt()` 即完整生命周期，`stopReason` 即终态，无轮询。
 * 子进程按调用起停（spawn → prompt → dispose），无常驻。
 *
 * ## 执行流程
 *
 * ```
 * execute({ task })
 *   ↓
 * AcpClient.spawn(agent)        → initialize 握手
 *   ↓
 * client.prompt(task)           → { stopReason, text }
 *   ↓
 * stopReason 映射 ToolExecutionResult；dispose 回收子进程
 * ```
 */

import { AcpClient, type AcpStopReason } from '@acp/acp-client.js';
import type { AcpAgentConfig } from '@config/settings-types.js';
import type {
  AgentTool,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolInput,
} from '../core/tool-types.js';

/**
 * ACP 工具名前缀
 *
 * 每个配置的 agent 注册为 `acp_<name>` 工具。
 * 主 agent 工具过滤（filterToolRegistry）放行此前缀，
 * 子 agent 经父 registry 继承默认也能调用。
 */
export const ACP_TOOL_PREFIX = 'acp_';

/**
 * 由 agent 名称生成工具名
 */
export function acpToolName(agentName: string): string {
  return `${ACP_TOOL_PREFIX}${agentName}`;
}

// ============================================================
// 结果映射
// ============================================================

/**
 * stopReason → ToolExecutionResult
 *
 * - end_turn → success（text 为空时兜底提示文案）
 * - max_tokens / max_turn_requests → success 但标注截断
 * - refusal → error
 * - cancelled → error（超时/取消路径走不到这里，防御性保留）
 */
export function toToolResult(
  stopReason: AcpStopReason,
  text: string,
  agent: AcpAgentConfig
): ToolExecutionResult {
  const base = { agentName: agent.name, agentCommand: agent.command };

  if (stopReason === 'refusal') {
    return {
      status: 'error',
      error: text || 'Remote agent refused the task',
      data: { ...base, stopReason },
    };
  }
  if (stopReason === 'cancelled') {
    return { status: 'error', error: 'Remote agent task was cancelled', data: { ...base, stopReason } };
  }
  if (stopReason === 'max_tokens' || stopReason === 'max_turn_requests') {
    return {
      status: 'success',
      output: `${text || '(empty)'}\n\n[warning: agent response truncated (${stopReason})]`,
      data: { ...base, stopReason, truncated: true },
    };
  }

  return {
    status: 'success',
    output: text || 'Agent completed the task with no text output',
    data: { ...base, stopReason },
  };
}

// ============================================================
// 工具工厂
// ============================================================

/**
 * 创建一个 ACP agent 的直接调用工具
 *
 * @param agent - ACP agent 配置（name / command / args / env / cwd / description）
 * @param promptTimeoutMs - 单次任务超时（毫秒），默认 300s
 */
export function createAcpAgentTool(
  agent: AcpAgentConfig,
  promptTimeoutMs?: number
): AgentTool {
  return {
    name: acpToolName(agent.name),
    // 远程 agent 会执行任意动作，按最高风险等级走权限闸门
    riskLevel: 'execute',
    description: agent.description ?? `ACP remote agent: ${agent.name}`,
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
      context: ToolExecutionContext
    ): Promise<ToolExecutionResult> {
      const { task } = input as { task?: unknown };
      if (typeof task !== 'string' || task.trim().length === 0) {
        return { status: 'error', error: 'Missing required field: task' };
      }

      let client: AcpClient | undefined;
      try {
        client = await AcpClient.spawn({
          name: agent.name,
          command: agent.command,
          args: agent.args,
          env: agent.env,
          cwd: agent.cwd ?? context.cwd,
          promptTimeoutMs,
        });
        const result = await client.prompt(task);
        return toToolResult(result.stopReason, result.text, agent);
      } catch (error) {
        // 网络/进程/协议/超时统一转 error 结果（工具契约不抛异常）
        return {
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        await client?.dispose();
      }
    },
  };
}
