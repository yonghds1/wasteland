/**
 * a2a-spawn-agent.ts - A2A 版本的 spawn_agent 工具
 *
 * 本文件实现了支持远程 A2A Agent 调用的 spawn_agent 工具。
 * 当目标 Agent 名称匹配已注册的远程 Agent 时，通过 A2A 协议发送任务；
 * 否则回退到本地 spawn_agent 执行。
 *
 * ## 使用示例
 *
 * ```typescript
 * const tool = createA2ASpawnAgentTool({
 *   localSpawnTool: localSpawnAgentTool,
 *   a2aRegistry: registry,
 * });
 *
 * // 调用远程 Agent
 * const result = await tool.execute(
 *   { name: 'remote-analyzer', task: 'Review this code' },
 *   { sessionId: 's1', turn: 1, cwd: '/tmp' }
 * );
 *
 * // 调用本地 Agent（回退）
 * const result2 = await tool.execute(
 *   { name: 'local-agent', task: 'Do something' },
 *   { sessionId: 's1', turn: 1, cwd: '/tmp' }
 * );
 * ```
 */

import type {
  AgentTool,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolInput,
  JsonSchema,
} from './tool-types.js';
import type { A2AAgentRegistry } from '../acp/a2a-registry.js';
import { A2AClient } from '../acp/a2a-client.js';

/**
 * 创建 A2A 版本的 spawn_agent 工具
 *
 * 支持调用本地和远程 A2A Agent：
 * - 远程 Agent: 通过 A2A 协议发送任务到远程 Agent
 * - 本地 Agent: 回退到现有的本地 spawn_agent 执行
 *
 * @param options - 工具配置
 * @param options.localSpawnTool - 本地 spawn_agent 工具实例
 * @param options.a2aRegistry - A2A Agent 注册表
 * @returns AgentTool 实例
 */
export function createA2ASpawnAgentTool(options: {
  localSpawnTool: AgentTool;
  a2aRegistry: A2AAgentRegistry;
}): AgentTool {
  return {
    name: 'spawn_agent',
    riskLevel: 'execute',
    description: '创建并运行子 Agent（支持本地和远程 A2A Agent）',
    // 复用本地 spawn_agent 的 inputSchema
    inputSchema: options.localSpawnTool.inputSchema,

    async execute(
      input: ToolInput,
      ctx: ToolExecutionContext
    ): Promise<ToolExecutionResult> {
      // 1. 解析输入
      const { name, task } = input as { name?: string; task?: string };
      if (!name || !task) {
        return {
          status: 'error',
          error: 'Missing required fields: name, task',
        };
      }

      // 2. 检查是否是远程 A2A Agent
      const remoteAgent = options.a2aRegistry.findByName(name);
      if (remoteAgent) {
        // 远程调用：通过 A2A 协议发送任务
        const client = new A2AClient({
          baseUrl: remoteAgent.url,
        });

        try {
          const result = await client.sendTask(task);

          // 检查任务状态
          if (result.status.state === 'failed') {
            const errorMessage =
              result.status.message?.parts
                ?.filter((p) => p.type === 'text')
                .map((p) => (p as { type: 'text'; text: string }).text)
                .join('\n') ?? 'Remote agent task failed';
            return { status: 'error', error: errorMessage };
          }

          if (result.status.state === 'canceled') {
            return { status: 'error', error: 'Remote agent task was canceled' };
          }

          // 提取结果文本
          const output =
            result.artifacts
              ?.flatMap((a) => a.parts)
              .filter((p) => p.type === 'text')
              .map((p) => (p as { type: 'text'; text: string }).text)
              .join('\n') ??
            result.status.message?.parts
              ?.filter((p) => p.type === 'text')
              .map((p) => (p as { type: 'text'; text: string }).text)
              .join('\n') ??
            'Task completed';

          return {
            status: 'success',
            output,
            data: {
              taskId: result.id,
              sessionId: result.sessionId,
              agentName: name,
              agentUrl: remoteAgent.url,
            },
          };
        } catch (error) {
          return {
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      // 3. 回退到本地 spawn_agent
      return options.localSpawnTool.execute(input, ctx);
    },
  };
}
