/**
 * spawn-agent.ts - 子 Agent 创建工具
 *
 * 本文件实现了 spawn_agent 工具，允许主 Agent 创建并运行子 Agent。
 *
 * ## 核心设计
 *
 * - spawn_agent 作为普通工具注册到 ToolRegistry
 * - 子 Agent 通过 runAgentLoop 执行（mode="single"）
 * - 执行结果作为 tool_result 返回给主 Agent
 *
 * ## 使用示例
 *
 * ```typescript
 * // 主 Agent 调用
 * spawn_agent({
 *   name: "analyzer",
 *   task: "分析 UserService 代码"
 * })
 *
 * // 返回结果
 * {
 *   status: "success",
 *   output: "分析结果...",
 *   sessionPath: ".rxc/sessions/xxx-child-analyzer.jsonl"
 * }
 * ```
 */

import { catchError, defaultIfEmpty, filter, map, take, timeout } from "rxjs/operators";
import { forkJoin, from, lastValueFrom, of } from "rxjs";

import { runAgentLoop } from "../runtime/agent-loop.js";
import type { SessionMetadata } from "../runtime/session-manager.js";
import type { SessionMessageRecord } from "../runtime/event-types.js";
import type {
  AgentTool,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolInput,
} from "./tool-types.js";
import type { AgentProvider } from "../providers/provider-types.js";
import type { SessionManager } from "../runtime/session-manager.js";
import type { ToolRegistry } from "./tool-registry.js";
import type { PermissionGate } from "../runtime/permission-gate.js";

/**
 * spawn_agent 工具的输入参数
 */
export type SpawnAgentInput = {
  /** 子 Agent 标识 */
  name: string;
  /** 任务描述 */
  task: string;
  /** 可选：模型选择（haiku/sonnet/opus）- 当前未实现，预留扩展 */
  model?: string;
  /** 可选：限定工具集 - 当前未实现，预留扩展 */
  tools?: string[];
};

/**
 * spawn_agent 工具的执行上下文（扩展版）
 */
export type SpawnAgentContext = ToolExecutionContext & {
  session: SessionMetadata;
  sessionManager: SessionManager;
  provider: AgentProvider;
  toolRegistry?: ToolRegistry;
  permissionGate?: PermissionGate;
  history: SessionMessageRecord[];
};

/**
 * 创建 spawn_agent 工具
 *
 * @param context - 扩展的执行上下文
 * @returns AgentTool 实例
 */
export function createSpawnAgentTool(context: SpawnAgentContext): AgentTool {
  return {
    name: "spawn_agent",
    riskLevel: "execute",

    async execute(
      input: ToolInput,
      _toolContext: ToolExecutionContext,
    ): Promise<ToolExecutionResult> {
      const { name, task } = input as SpawnAgentInput;

      if (!name || !task) {
        return {
          status: "error",
          error: "spawn_agent requires 'name' and 'task' parameters",
        };
      }

      try {
        // 1. 创建子 Agent session
        const childSession = await context.sessionManager.createChildSession(
          context.session,
          name,
        );

        // 2. 准备子 Agent 的输入
        const childInput$ = of({
          turn: 1,
          content: task,
          source: "message" as const,
        });

        // 3. 运行子 Agent（使用已有的 childSession）
        const { events$ } = runAgentLoop({
          input$: childInput$,
          provider: context.provider,
          sessionManager: context.sessionManager,
          toolRegistry: context.toolRegistry,
          permissionGate: context.permissionGate,
          cwd: context.cwd,
          mode: "single",
          existingSession: childSession,
        });

        // 4. 等待子 Agent 完成
        let result: { success: boolean; content?: string; error?: string } = {
          success: false,
          error: "子 Agent 未返回响应",
        };

        try {
          const finalEvent = await lastValueFrom(
            events$.pipe(
              // 只取最终的 assistant_message
              filter(
                (event): event is { type: "assistant_message"; sessionId: string; turn: number; content: string } =>
                  "type" in event && event.type === "assistant_message",
              ),
              take(1),
              // 60 秒超时
              timeout(60000),
              // 如果没有值，返回 undefined
              defaultIfEmpty(undefined as unknown as { type: "assistant_message"; sessionId: string; turn: number; content: string }),
            ),
          );

          if (finalEvent && finalEvent.type === "assistant_message") {
            result = { success: true, content: finalEvent.content };
          }
        } catch (err) {
          result = {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }

        // 5. 返回结果
        if (result.success) {
          return {
            status: "success",
            output: result.content || "子 Agent 执行完成",
            data: {
              sessionPath: childSession.path,
              childId: childSession.id,
            },
          };
        } else {
          return {
            status: "error",
            error: result.error || "子 Agent 执行失败",
            data: {
              sessionPath: childSession.path,
              childId: childSession.id,
            },
          };
        }
      } catch (error) {
        return {
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/**
 * 处理并行 spawn_agent 调用
 *
 * 当主 Agent 在一个 turn 中发出多个 spawn_agent 调用时，
 * 使用 forkJoin 并行执行所有子 Agent。
 *
 * @param calls - 工具调用列表
 * @param context - 执行上下文
 * @returns Observable<RuntimeEvent>
 */
export function handleParallelSpawns(
  calls: { callId: string; input: SpawnAgentInput }[],
  context: SpawnAgentContext,
) {
  const childRuns = calls.map((call) => {
    const tool = createSpawnAgentTool(context);
    return from(
      tool.execute(call.input as ToolInput, {
        sessionId: context.sessionId,
        turn: context.turn,
        cwd: context.cwd,
      }),
    ).pipe(
      timeout(60000),
      catchError((err: Error) =>
        of({
          status: "error" as const,
          error: err.message || "timeout",
        }),
      ),
      map((result) => ({
        callId: call.callId,
        ...result,
      })),
    );
  });

  return forkJoin(childRuns);
}
