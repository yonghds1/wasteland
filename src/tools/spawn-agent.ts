/**
 * spawn-agent.ts - 子 Agent 创建与事件转发
 *
 * 本文件实现 spawn_agent 工具的核心逻辑：主 Agent 调用后创建子 Agent，
 * 并将其思考、工具调用与进度事件实时转发给父 Agent / TUI，
 * 最终结果作为 tool_result / tool_failed 返回给父 Agent。
 *
 * ## 核心设计
 *
 * - 子 Agent 通过 runAgentLoop 执行（mode="single"）
 * - 子 Agent 的中间事件被转译为 agent_thinking / agent_tool_use / agent_progress
 *   三个父侧可观察事件（定义于 event-types.ts）
 * - 最终结果以 tool_result / tool_failed 形式写回父 session
 *
 * ## 使用示例
 *
 * ```typescript
 * // 在 handleSpawnAgent 中：
 * spawnChildAgentForwarding$({ context, call });
 * ```
 */

import { Observable, defer, mergeMap, of, retry, timer } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { z } from 'zod';
import { zodToJsonSchema } from '@alcyone-labs/zod-to-json-schema';

import { t } from '../locales/index.js';
import { debugLog } from '../core/runtime/debug-logger.js';
import { runAgentLoop } from '../core/runtime/agent-loop.js';
import type { SessionMetadata } from '../core/runtime/session-manager.js';
import type {
  SessionMessageRecord,
  SessionToolResultRecord,
  RuntimeEvent,
} from '../core/runtime/event-types.js';
import type { AgentTool, JsonSchema } from './tool-types.js';
import type { AgentProvider } from '../providers/provider-types.js';
import type { SessionManager } from '../core/runtime/session-manager.js';
import { ToolRegistry } from './tool-registry.js';
import type { PermissionGate } from '../core/runtime/permission-gate.js';
import type { UserInputBridge } from '../core/runtime/user-input-bridge.js';
import type {
  ProviderSettings,
  LoadedWastelandSettings,
  SubAgentSettings,
} from '../config/settings-types.js';
import type { ProviderRegistry } from '../providers/provider-registry.js';
import { PromptAssembler } from '../prompts/prompt-assembler.js';

// ============================================================
// Zod Schema
// ============================================================

export const spawnAgentInputSchema = z.object({
  name: z.string().min(1).describe('子 Agent 标识'),
  task: z.string().min(1).describe('任务描述'),
  model: z.string().optional().describe('模型选择（haiku/sonnet/opus 或具体模型名）'),
  tools: z.array(z.string()).optional().describe('限定子 Agent 可用的工具集'),
  inheritHistory: z.boolean().default(false).describe('是否继承父 Agent 的历史上下文'),
});

/**
 * 将通用模型名称映射到实际模型名称
 */
function mapModelToActualModel(model: string, providerId: string): string {
  const modelMappings: Record<string, Record<string, string>> = {
    qwen: { haiku: 'qwen-turbo', sonnet: 'qwen-plus', opus: 'qwen-max' },
    ollama: { haiku: 'llama3.2:1b', sonnet: 'llama3.2', opus: 'llama3.3:70b' },
    openai: { haiku: 'gpt-4o-mini', sonnet: 'gpt-4o', opus: 'o1' },
    'openai-compatible': { haiku: 'gpt-4o-mini', sonnet: 'gpt-4o', opus: 'o1' },
    anthropic: { haiku: 'claude-haiku-4-5-20251001', sonnet: 'claude-sonnet-4-6', opus: 'claude-opus-4-8' },
  };
  const providerMapping = modelMappings[providerId];
  if (providerMapping && providerMapping[model]) {
    return providerMapping[model];
  }
  return model;
}

/**
 * 解析 promptVariables.tools（逗号分隔字符串）为 string[]
 *
 * settings.json 的 promptVariables.tools 是字符串（如 "read-file, glob, grep"），
 * 不是数组。这里按逗号拆解并 trim，得到子 agent 的工具白名单。
 *
 * @param raw - 原始值（字符串 / 数组 / undefined）
 * @returns 工具名数组（已 trim 空格），未定义返回空数组
 */
function parseSubAgentTools(raw: unknown): string[] {
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s).trim()).filter((s) => s.length > 0);
  }
  return [];
}

/**
 * 根据 subAgentConfig 组装子 agent 的 system prompt
 *
 * 设计目的：minimax 是小模型，没有 system prompt 约束时只能"角色扮演"。
 * 这里通过 PromptAssembler + subAgentConfig.promptTemplate / promptVariables
 * 注入真实角色（researcher / developer / analyst / tester 等）。
 *
 * 行为：
 * - 若 subAgentConfig 没有 promptTemplate 或 promptVariables，返回 undefined（不传 prompt）
 * - 若 promptTemplate = 'role-worker'，使用内置 worker 模板
 * - 其他情况原样传给 PromptAssembler.assemble()
 *
 * @param params - subAgentConfig 与上下文
 * @returns 组装后的 prompt 字符串；没有可用配置时返回 undefined
 */
function assembleSubAgentPrompt(params: {
  subAgentConfig: SubAgentSettings | undefined;
  cwd: string;
  roleName: string;
  tools: string[];
}): string | undefined {
  if (!params.subAgentConfig) return undefined;

  const promptTemplate = params.subAgentConfig.promptTemplate;
  const promptVariables = params.subAgentConfig.promptVariables;

  if (!promptTemplate && !promptVariables) return undefined;

  try {
    const assembler = new PromptAssembler({ cwd: params.cwd });
    // promptTemplate 可能是 string / PromptTemplate / { template, variables }
    // 直接传给 assembler.assemble() 即可
    const ref = (promptTemplate ?? 'role-worker') as
      | string
      | { sections: unknown[]; name?: string }
      | { template: string; variables?: Record<string, unknown> };

    const result = assembler.assemble(
      ref as Parameters<typeof assembler.assemble>[0],
      {
        cwd: params.cwd,
        roleName: params.roleName,
        tools: params.tools,
        variables: {},
      },
      promptVariables as Record<string, unknown> | undefined
    );
    return result.content;
  } catch (err) {
    // prompt 组装失败不应阻塞子 agent 启动，仅记录日志
    debugLog({
      kind: 'sub_agent_prompt_error',
      roleName: params.roleName,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/** spawn_agent 工具的输入类型 */
export type SpawnAgentInput = z.infer<typeof spawnAgentInputSchema>;

/** 子 Agent 最大嵌套深度（防止递归 spawn 耗尽资源） */
const MAX_SPAWN_DEPTH = 3;

/** spawn_agent 工具的风险等级（execute：调用 spawn_agent 属于执行子任务） */
export const SPAWN_AGENT_RISK_LEVEL = 'execute' as const;

/** spawn_agent 工具的描述（展示给 LLM），placeholder 与实际工具共享以避免漂移 */
export const SPAWN_AGENT_DESCRIPTION = '创建并运行子 Agent 执行任务';

/** spawn_agent 工具的 JSON Schema（展示给 LLM），集中导出供 placeholder 复用 */
export const SPAWN_AGENT_INPUT_SCHEMA_JSON = zodToJsonSchema(spawnAgentInputSchema) as JsonSchema;

/**
 * spawn_agent 工具的执行上下文
 */
export type SpawnAgentContext = {
  sessionId: string;
  turn: number;
  cwd: string;
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
  /** 当前 spawn 嵌套深度（0 = 顶层 agent 调用） */
  depth?: number;
  /** 可选：用户输入桥接器，复用父 Agent 的 bridge 以支持子 Agent 内的 ask-user 与权限询问 */
  userInputBridge?: UserInputBridge;
  /** 可选：完整 loadedSettings，用于读 subAgents 配置（实现重试 + 角色注入） */
  loadedSettings?: LoadedWastelandSettings;
};

/**
 * 运行子 Agent 并将其事件流转发为父侧可观察的 agent_* 事件。
 *
 * 设计目的：让父 Agent 和 TUI 能实时看到子 Agent 的思考、工具调用与进度，
 * 而不仅仅是最终的文本结果。修复前，子 Agent 的中间事件（assistant_chunk、
 * tool_call_requested、tool_result 等）被完全吞掉，父侧和 TUI 只能看到
 * "开始"和"结束 + 最终文本"两个事件，是黑盒。
 *
 * 输出事件顺序：
 * 1. agent_spawned（带 childId / childSessionPath）
 * 2. agent_thinking / agent_tool_use / agent_progress（来自子 Agent 的中间事件转译）
 * 3. agent_completed（success / error / timeout）
 * 4. tool_result 或 tool_failed（作为 spawn_agent 工具在父侧的最终结果，写入父 session）
 *
 * 单订阅保证：events$ 是 cold Observable，本函数内部只订阅一次以避免子 Agent 重复执行。
 *
 * @param params - 上下文与工具调用
 * @returns RuntimeEvent 事件流
 */
export function spawnChildAgentForwarding$(params: {
  context: SpawnAgentContext;
  call: { id: string; toolName: string; input: Record<string, unknown> };
}): Observable<RuntimeEvent> {
  const { context, call } = params;
  const parentId = context.session.id;
  const timestamp = (): string => new Date().toISOString();

  // ---- 输入校验 ----
  const parsed = spawnAgentInputSchema.safeParse(call.input);
  if (!parsed.success) {
    return of<RuntimeEvent>({
      type: 'tool_failed',
      sessionId: parentId,
      turn: context.turn,
      callId: call.id,
      toolName: call.toolName,
      status: 'error',
      error: parsed.error.issues.map((i) => i.message).join(', '),
    });
  }

  const { name: childName, task: childTask, tools, model, inheritHistory } = parsed.data;

  // ---- 嵌套深度检查 ----
  const depth = context.depth ?? 0;
  if (depth >= MAX_SPAWN_DEPTH) {
    return of<RuntimeEvent>({
      type: 'tool_failed',
      sessionId: parentId,
      turn: context.turn,
      callId: call.id,
      toolName: call.toolName,
      status: 'error',
      error: `已达到子 Agent 最大嵌套深度（${MAX_SPAWN_DEPTH}），禁止继续 spawn。`,
    });
  }

  const childAgentTimeoutMs = context.childAgentTimeout ?? 120000;

  // ---- 重试配置（从 subAgents[name] 读取，默认不重试） ----
  // 失败时由外层 retry 自动重 attempt，指数退避（retryDelayMs * 2^(attempt-1)）
  const subAgentConfig = context.loadedSettings?.settings?.subAgents?.[childName];
  const maxRetries = subAgentConfig?.maxRetries ?? 0;
  const retryDelayMs = subAgentConfig?.retryDelayMs ?? 1000;

  // ---- 工具限定优先级 ----
  // subAgents.tools > minimax 传入的 tools > 全部工具（context.toolRegistry）
  // 即：配置优先于 minimax 决策，因为 minimax 是小模型，工具越少越好。
  const subAgentConfigTools = parseSubAgentTools(subAgentConfig?.promptVariables?.tools);
  const effectiveTools: string[] | undefined =
    subAgentConfigTools.length > 0
      ? subAgentConfigTools
      : (tools && tools.length > 0 ? tools : undefined);

  // ---- 模型选择优先级 ----
  // subAgentConfig.model > minimax 传入的 model
  // subAgentConfig.model 是字符串 model alias（如 "minimax_model"），
  // minimax 传入的 model 是通用名（haiku/sonnet/opus/具体模型）。
  const subAgentConfigModel = subAgentConfig?.model;
  const effectiveModel = subAgentConfigModel ?? model;

  // ---- 模型别名解析 ----
  // subAgentConfig.model 是 alias（如 "minimax_model"），需要从 settings.models
  // 解析为 provider 真正使用的 model name（如 "MiniMax-M3"）。
  // 若 alias 在 models 中找不到对应配置，保持原值（兼容 alias 即 model name 的场景）。
  let resolvedModelAlias: string | undefined = effectiveModel;
  if (subAgentConfigModel && context.loadedSettings?.settings?.models) {
    const aliasConfig = context.loadedSettings.settings.models[subAgentConfigModel];
    if (aliasConfig?.model) {
      resolvedModelAlias = aliasConfig.model;
    }
  }

  // ---- 组装子 agent 的 system prompt（如果有 subAgentConfig.promptTemplate/variables） ----
  const subAgentPrompt = assembleSubAgentPrompt({
    subAgentConfig,
    cwd: context.cwd,
    roleName: childName,
    tools: effectiveTools ?? context.toolRegistry?.list() ?? [],
  });

  // ---- 准备并启动子 Agent ----
  return defer(async () => {
    const childSession = await context.sessionManager.createChildSession(context.session, childName);

    // 处理 inheritHistory：将父历史拼成前缀
    let taskContent = childTask;
    if (inheritHistory && context.history.length > 0) {
      const historySummary = context.history
        .filter((record) => record.type === 'message')
        .map((record) => {
          const role =
            record.role === 'user'
              ? t('tools.spawnAgent.roleUser')
              : t('tools.spawnAgent.roleAssistant');
          return `【${role}】\n${record.content}`;
        })
        .join('\n\n');
      if (historySummary) {
        taskContent = `${t('tools.spawnAgent.historyHeader')}\n\n${historySummary}\n\n${t('tools.spawnAgent.currentTaskHeader')}\n\n${childTask}`;
      }
    }

    const childInput$ = of({ turn: 1, content: taskContent, source: 'message' as const });

    // 工具限定（按 effectiveTools 优先级：subAgents > minimax > 全集）
    let childToolRegistry = context.toolRegistry;
    if (effectiveTools && effectiveTools.length > 0 && context.toolRegistry) {
      const allowedTools = effectiveTools
        .map((toolName) => context.toolRegistry?.get(toolName))
        .filter((tool): tool is AgentTool => tool !== undefined);
      if (allowedTools.length > 0) {
        childToolRegistry = new ToolRegistry(allowedTools);
      }
    }

    // 模型选择（subAgentConfig.model 是 alias，minimax 传入的是通用名）
    let childProvider = context.provider;
    if (resolvedModelAlias && context.providerRegistry && context.providerSettings) {
      // subAgentConfigModel 路径下 resolvedModelAlias 已是真实 model name；
      // 否则 effectiveModel === resolvedModelAlias 且非空（守卫已保证），走通用名映射。
      const actualModel: string = subAgentConfigModel
        ? resolvedModelAlias // 来自 subAgents.model 已在 alias 解析阶段还原为真实 model name
        : mapModelToActualModel(resolvedModelAlias, context.provider.id);
      const newSettings: ProviderSettings = { ...context.providerSettings, model: actualModel };
      childProvider = context.providerRegistry.resolve(context.provider.id, newSettings);
    }

    const { events$ } = runAgentLoop({
      input$: childInput$,
      provider: childProvider,
      sessionManager: context.sessionManager,
      toolRegistry: childToolRegistry,
      permissionGate: context.permissionGate,
      cwd: context.cwd,
      mode: 'single',
      existingSession: childSession,
      providerRegistry: context.providerRegistry,
      providerSettings: context.providerSettings,
      childAgentTimeout: context.childAgentTimeout,
      userInputBridge: context.userInputBridge,
      spawnDepth: depth + 1,
      // 子 agent 的 system prompt（来自 subAgents.promptTemplate + promptVariables）
      // minimax 收到后会按角色约束行为（不再"角色扮演"）
      prompt: subAgentPrompt,
      loadedSettings: context.loadedSettings,
    });

    // 日志：记录子 agent 实际配置（验证 minimax 调用时输入 + 解析后的 model/tools）
    // 用于排查子 agent 是否按 settings.json subAgents 配置运行
    debugLog({
      kind: 'spawn_agent',
      childName,
      childId: childSession.id,
      subAgentConfigName: subAgentConfig ? childName : null,
      taskPreview: childTask.slice(0, 150),
      taskLength: childTask.length,
      providerId: childProvider.id,
      resolvedModel: resolvedModelAlias
        ? subAgentConfigModel
          ? resolvedModelAlias
          : mapModelToActualModel(resolvedModelAlias, context.provider.id)
        : (context.providerSettings?.model ?? 'inherit-parent'),
      modelParam: model ?? null,
      inheritedModel: subAgentConfigModel ?? null,
      inheritHistory: inheritHistory ?? false,
      toolsRequested: tools ?? null,
      resolvedToolNames: childToolRegistry ? childToolRegistry.list() : [],
      subAgentTools: subAgentConfigTools.length > 0 ? subAgentConfigTools : null,
      subAgentPromptPreview: subAgentPrompt ? subAgentPrompt.slice(0, 200) : null,
      subAgentPromptLength: subAgentPrompt?.length ?? 0,
      depth: depth + 1,
    });

    return { childSession, events$ };
  }).pipe(
    mergeMap(({ childSession, events$ }) => {
      const childId = childSession.id;
      const childSessionPath = childSession.path;

      const spawnedEvent: RuntimeEvent = {
        type: 'agent_spawned',
        parentId,
        childId,
        childSessionPath,
        name: childName,
        task: childTask,
      };

      // ---- 事件转译：子 agent 中间事件 → 父侧 agent_thinking / agent_tool_use / agent_progress ----
      const translateChildEvent = (e: RuntimeEvent): RuntimeEvent | null => {
        switch (e.type) {
          case 'assistant_chunk':
            return { type: 'agent_thinking', childId, childName, content: e.chunk };
          case 'tool_call_requested':
            return {
              type: 'agent_tool_use',
              childId,
              childName,
              toolName: e.toolName,
              input: e.input,
            };
          case 'tool_started':
          case 'tool_result':
          case 'tool_failed':
            return { type: 'agent_tool_use', childId, childName, toolName: e.toolName };
          case 'permission_decision':
            return {
              type: 'agent_progress',
              childId,
              childName,
              status: `permission: ${e.decision}`,
            };
          case 'agent_spawned':
            return {
              type: 'agent_progress',
              childId,
              childName,
              status: `sub-spawned: ${e.name}`,
            };
          case 'agent_completed':
            return {
              type: 'agent_progress',
              childId,
              childName,
              status: `sub-completed: ${e.status}`,
            };
          default:
            return null;
        }
      };

      // ---- 单订阅 events$，手动管理转发累积与最终结果 ----
      return new Observable<RuntimeEvent>((subscriber) => {
        const forwarded: RuntimeEvent[] = [];
        let resolved = false;

        const finish = (status: 'success' | 'error' | 'timeout', content?: string, error?: string): void => {
          if (resolved) return;
          resolved = true;

          // 1) 累积的中间转发事件
          for (const fe of forwarded) subscriber.next(fe);

          // 2) agent_completed
          subscriber.next({
            type: 'agent_completed',
            childId,
            status,
            result: content,
            error,
            sessionPath: childSessionPath,
          });

          // 3) tool_result / tool_failed + 写入父 session
          const ts = timestamp();
          if (status === 'success') {
            const output = content || t('tools.spawnAgent.executionComplete');
            subscriber.next({
              type: 'tool_result',
              sessionId: parentId,
              turn: context.turn,
              callId: call.id,
              toolName: call.toolName,
              status: 'success',
              output,
            });
            const record: SessionToolResultRecord = {
              type: 'tool_result',
              sessionId: parentId,
              turn: context.turn,
              callId: call.id,
              toolName: call.toolName,
              status: 'success',
              output,
              timestamp: ts,
            };
            context.sessionManager.appendRecord(context.session, record).catch(() => {});
          } else {
            const errMsg =
              error ||
              (status === 'timeout'
                ? `子 Agent 执行超时 (timeout: ${childAgentTimeoutMs}ms)`
                : t('tools.spawnAgent.executionFailed'));
            subscriber.next({
              type: 'tool_failed',
              sessionId: parentId,
              turn: context.turn,
              callId: call.id,
              toolName: call.toolName,
              status: 'error',
              error: errMsg,
            });
            const record: SessionToolResultRecord = {
              type: 'tool_result',
              sessionId: parentId,
              turn: context.turn,
              callId: call.id,
              toolName: call.toolName,
              status: 'error',
              error: errMsg,
              timestamp: ts,
            };
            context.sessionManager.appendRecord(context.session, record).catch(() => {});
          }

          if (status === 'success') {
            subscriber.complete();
          } else {
            // 失败：调 subscriber.error 触发外层 retry（按 subAgents.maxRetries 重试）
            subscriber.error(new Error(error || `子 Agent 失败 (${status})`));
          }
        };

        // 立即 yield agent_spawned（在中间转发事件之前）
        subscriber.next(spawnedEvent);

        const sub = events$.subscribe({
          next: (e) => {
            if (e.type === 'assistant_message') {
              finish('success', e.content);
            } else if (e.type === 'session_ended') {
              // 子 agent session 结束但未产生 assistant_message
              finish('error', undefined, t('tools.spawnAgent.noResponse'));
            } else {
              const translated = translateChildEvent(e);
              if (translated) forwarded.push(translated);
            }
          },
          error: (err) => {
            finish('error', undefined, err instanceof Error ? err.message : String(err));
          },
          complete: () => {
            // 兜底：流 complete 但未触发 assistant_message / session_ended
            finish('error', undefined, t('tools.spawnAgent.noResponse'));
          },
        });

        const timeoutHandle = setTimeout(() => {
          finish('timeout', undefined, `子 Agent 执行超时 (timeout: ${childAgentTimeoutMs}ms)`);
        }, childAgentTimeoutMs);

        return () => {
          clearTimeout(timeoutHandle);
          sub.unsubscribe();
        };
      });
    }),
    // ---- 重试逻辑：失败时按 subAgents.maxRetries 重新 attempt（指数退避） ----
    // 每次重试都会重新跑 defer → 新 childSession + 新 runAgentLoop（新 attempt）
    retry({
      count: maxRetries,
      delay: (err, count) => {
        debugLog({
          kind: 'spawn_retry',
          childName,
          attempt: count,
          maxRetries,
          error: err.message,
        });
        return timer(retryDelayMs * Math.pow(2, count - 1));
      },
    }),
    // ---- 全部重试失败：返回明确 tool_failed（避免 minimax 自己脑补） ----
    catchError((err) => of<RuntimeEvent>({
      type: 'tool_failed',
      sessionId: parentId,
      turn: context.turn,
      callId: call.id,
      toolName: call.toolName,
      status: 'error',
      error: `子 agent ${childName} 失败 ${maxRetries + 1} 次: ${err.message}`,
    })),
  );
}