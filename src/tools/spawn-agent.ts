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
 *   sessionPath: ".wasteland/sessions/xxx-child-analyzer.jsonl"
 * }
 * ```
 */

import { catchError, defaultIfEmpty, filter, map, take, timeout } from "rxjs/operators";
import { forkJoin, from, lastValueFrom, of } from "rxjs";

import { t } from "../locales/index.js";
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
import type { ProviderSettings } from "../config/settings-types.js";
import type { ProviderRegistry } from "../providers/provider-registry.js";

/**
 * 将通用模型名称映射到实际模型名称
 *
 * @param model - 通用模型名称（haiku/sonnet/opus）
 * @param providerId - Provider ID
 * @returns 实际模型名称
 */
function mapModelToActualModel(model: string, providerId: string): string {
  // 通用模型名称到各 Provider 的映射
  const modelMappings: Record<string, Record<string, string>> = {
    qwen: {
      haiku: "qwen-turbo",
      sonnet: "qwen-plus",
      opus: "qwen-max",
    },
    ollama: {
      haiku: "llama3.2:1b",
      sonnet: "llama3.2",
      opus: "llama3.3:70b",
    },
  };

  // 如果是已知的通用名称，尝试映射
  const providerMapping = modelMappings[providerId];
  if (providerMapping && providerMapping[model]) {
    return providerMapping[model];
  }

  // 否则直接返回原值（可能是具体的模型名称如 "qwen-max"）
  return model;
}

/**
 * spawn_agent 工具的输入参数
 */
export type SpawnAgentInput = {
  /** 子 Agent 标识 */
  name: string;
  /** 任务描述 */
  task: string;
  /** 可选：模型选择（haiku/sonnet/opus 或具体模型名如 qwen-max） */
  model?: string;
  /** 可选：限定工具集 - 限制子 Agent 可用的工具列表 */
  tools?: string[];
  /** 可选：是否继承父 Agent 的历史上下文，默认 false */
  inheritHistory?: boolean;
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
  /** 可选：Provider 注册表，用于根据 model 参数创建新的 Provider */
  providerRegistry?: ProviderRegistry;
  /** 可选：当前 Provider 的配置，用于创建新 Provider 时继承配置 */
  providerSettings?: ProviderSettings;
  /** 子 Agent 执行超时（毫秒），默认 120000 */
  childAgentTimeout?: number;
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
      const { name, task, tools, model, inheritHistory } = input as SpawnAgentInput;

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
        // 如果 inheritHistory 为 true，将历史上下文作为前缀添加到 task
        let taskContent = task;
        if (inheritHistory && context.history.length > 0) {
          const historySummary = context.history
            .filter((record) => record.type === "message")
            .map((record) => {
              const role = record.role === "user" ? t("tools.spawnAgent.roleUser") : t("tools.spawnAgent.roleAssistant");
              return `【${role}】\n${record.content}`;
            })
            .join("\n\n");

          if (historySummary) {
            taskContent = `${t("tools.spawnAgent.historyHeader")}\n\n${historySummary}\n\n${t("tools.spawnAgent.currentTaskHeader")}\n\n${task}`;
          }
        }

        const childInput$ = of({
          turn: 1,
          content: taskContent,
          source: "message" as const,
        });

        // 3. 处理工具限定：如果指定了 tools 参数，创建受限的 ToolRegistry
        let childToolRegistry = context.toolRegistry;
        if (tools && tools.length > 0 && context.toolRegistry) {
          const allowedTools = tools
            .map((toolName) => context.toolRegistry!.get(toolName))
            .filter((tool): tool is AgentTool => tool !== undefined);

          if (allowedTools.length > 0) {
            // 使用动态导入避免循环依赖
            const { ToolRegistry } = await import("./tool-registry.js");
            childToolRegistry = new ToolRegistry(allowedTools);
          }
        }

        // 4. 处理模型选择：如果指定了 model 参数，创建新的 Provider
        let childProvider = context.provider;
        if (model && context.providerRegistry && context.providerSettings) {
          // 将 model 参数映射到实际的模型名称
          const actualModel = mapModelToActualModel(model, context.provider.id);

          // 创建新的 Provider 配置（继承原配置，覆盖 model）
          const newSettings: ProviderSettings = {
            ...context.providerSettings,
            model: actualModel,
          };

          // 使用 ProviderRegistry 创建新的 Provider
          childProvider = context.providerRegistry.resolve(
            context.provider.id,
            newSettings
          );
        }

        // 5. 运行子 Agent（使用已有的 childSession、受限的 toolRegistry 和选择的 provider）
        const { events$ } = runAgentLoop({
          input$: childInput$,
          provider: childProvider,
          sessionManager: context.sessionManager,
          toolRegistry: childToolRegistry,
          permissionGate: context.permissionGate,
          cwd: context.cwd,
          mode: "single",
          existingSession: childSession,
          // 传递 providerRegistry 和 providerSettings 以支持嵌套 spawn
          providerRegistry: context.providerRegistry,
          providerSettings: context.providerSettings,
        });

        // 6. 等待子 Agent 完成
        let result: { success: boolean; content?: string; error?: string } = {
          success: false,
          error: t("tools.spawnAgent.noResponse"),
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
              // 子 Agent 执行超时
              timeout(context.childAgentTimeout ?? 120000),
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

        // 7. 返回结果
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
      timeout(context.childAgentTimeout ?? 120000),
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
