/**
 * agent-loop.ts - 核心 Agent 循环逻辑
 *
 * 本文件实现了 Agent 的主循环，使用 RxJS 的响应式模式来处理：
 * - 用户输入流
 * - Provider 响应流
 * - 工具调用和结果流
 *
 * ## 核心设计模式
 *
 * ### 1. defer + concat + 递归 循环模式
 * 使用 `defer` 延迟执行，`concat` 顺序拼接，通过递归实现循环。
 * 这种模式可以确保每一步都在上一步完成后才开始。
 *
 * ### 2. 数据流向
 * ```
 * 用户输入 → runAgentLoop → runTurnLoop → Provider → 工具调用 → 递归 runTurnLoop
 *                ↓
 *           RuntimeEvent 输出
 * ```
 */

import {
  EMPTY,
  Observable,
  ReplaySubject,
  catchError,
  concat,
  concatMap,
  concatWith,
  defer,
  from,
  map,
  merge,
  mergeMap,
  of,
  tap,
} from 'rxjs';

import { t } from '@locales/index.js';

import { type DebugTraceEvent } from './debug-events.js';
import { Logger } from '@core/logger/index.js';
import { UserInputBridge } from './user-input-bridge.js';
import type { AgentProvider } from '@providers/provider-types.js';
import { ToolRegistry } from '@tools/tool-registry.js';
import type {
  ChatInputTurn,
  HistoryRecord,
  RuntimeEvent,
  RuntimeMode,
  SessionMessageRecord,
  SessionToolCallRecord,
  SessionToolResultRecord,
} from './event-types.js';
import type { PermissionGate } from './permission-gate.js';
import { SessionManager, type SessionMetadata } from './session-manager.js';
import { dispatchToolCall } from './tool-dispatch.js';
import { createToolCallRecord, createToolResultRecord } from './dispatch-utils.js';
import { createTurnContext } from './turn-context.js';
import type { SkillExecutor } from '@core/skills/skill-executor.js';
import type { ProviderSettings, LoadedWastelandSettings } from '@config/settings-types.js';
import type { ProviderRegistry } from '@providers/provider-registry.js';
import { ContextManager, resolveContextWindow, truncateToolOutput, estimateTokens } from './context-manager.js';
import {
  advanceTurnState,
  appendAssistantChunk,
  completeTurnState,
  createInitialTurnState,
  failTurnState,
  recordToolCall,
  recordToolResult,
  type TurnState,
} from './turn-state.js';

import {
  createTraceEmitter,
  buildProviderFallbackMessage,
  buildMaxStepsMessage,
  type DebugTraceInput,
} from './turn-helpers.js';
import {
  persistAssistantMessage,
  createUserRecord,
  createAssistantRecord,
  createUsageRecord,
  createSessionStartRecord,
  createSessionEndRecord,
} from './session-records.js';
import {
  maybeCompactContext,
  maybeSummaryCompact,
  persistCompactionRecord,
} from './context-compaction.js';

// Re-exported for backward compatibility (test surface).
export { filterToolRegistry, MAIN_AGENT_TOOL_NAMES } from './turn-helpers.js';
// ============================================================
// 类型定义（核心循环内部）
// ============================================================

/** Agent 运行结果，包含事件流和调试流 */
type AgentRun = {
  /** 运行时事件流：包含会话、用户输入、助手响应、工具调用等事件 */
  events$: Observable<RuntimeEvent>;
  /** 调试追踪流：用于调试的详细事件流 */
  debug$: Observable<DebugTraceEvent>;
  /** 用户输入桥接器（用于 ask-user 工具） */
  userInputBridge: UserInputBridge;
};

// ============================================================
// Turn 预检 helpers（runTurnLoop 内联逻辑外提，纯搬运）
// ============================================================

/**
 * 技能命令 fast-path：命中技能命令时路由到 SkillExecutor。
 *
 * 未命中返回 null；命中但缺 toolRegistry/permissionGate 时抛错（原语义保留）。
 */
function routeSkillCommand(params: {
  skillExecutor: SkillExecutor | undefined;
  toolRegistry: ToolRegistry | undefined;
  permissionGate: PermissionGate | undefined;
  provider: AgentProvider;
  session: SessionMetadata;
  sessionManager: SessionManager;
  history: HistoryRecord[];
  cwd: string;
  turn: number;
  step: number;
  inputContent: string;
  trace: (event: DebugTraceInput) => void;
}): Observable<RuntimeEvent> | null {
  const { skillExecutor, inputContent } = params;
  if (!skillExecutor || !skillExecutor.isSkillCommand(inputContent)) {
    return null;
  }

  // 解析技能名称用于trace
  const skillName = inputContent.trim().split(/\s+/)[0]?.slice(1) ?? '';

  params.trace({
    sessionId: params.session.id,
    turn: params.turn,
    step: params.step,
    scope: 'skill',
    phase: 'started',
    message: 'routing to skill executor',
    data: {
      skillName,
      input: inputContent,
    },
  });

  // 执行技能
  if (!params.toolRegistry || !params.permissionGate) {
    throw new Error('skillExecutor requires toolRegistry and permissionGate');
  }
  return skillExecutor
    .execute({
      input: inputContent,
      sessionId: params.session.id,
      turn: params.turn,
      cwd: params.cwd,
      session: params.session,
      toolRegistry: params.toolRegistry,
      permissionGate: params.permissionGate,
      sessionManager: params.sessionManager,
      provider: params.provider,
      history: params.history.filter((r): r is SessionMessageRecord => r.type === 'message'),
      output: (msg) => {
        // 技能的进度输出（目前暂不处理，可以后续扩展）
        params.trace({
          sessionId: params.session.id,
          turn: params.turn,
          step: params.step,
          scope: 'skill',
          phase: 'progress',
          message: msg,
          data: { skillName },
        });
      },
    })
    .pipe(
      // 在技能执行事件上添加debug trace
      tap((event) => {
        if (event.type === 'skill_result') {
          params.trace({
            sessionId: params.session.id,
            turn: params.turn,
            step: params.step,
            scope: 'skill',
            phase: event.result.status,
            message: `skill ${event.result.status}`,
            data: {
              skillName: event.skillName,
              result: event.result.output,
            },
          });
        }
      })
    );
}

/**
 * 步数守卫：超出 maxStepsPerTurn 时持久化兜底消息并终止本 turn。
 *
 * 未超限返回 null。
 */
function checkMaxStepsExceeded(params: {
  state: TurnState;
  maxStepsPerTurn: number;
  session: SessionMetadata;
  sessionManager: SessionManager;
  history: HistoryRecord[];
  contextManager: ContextManager;
  trace: (event: DebugTraceInput) => void;
}): Observable<RuntimeEvent> | null {
  // 如果超出最大步数，提前终止并返回错误消息
  if (params.state.step <= params.maxStepsPerTurn) {
    return null;
  }

  const limitedState = failTurnState(params.state);
  const message = buildMaxStepsMessage(params.maxStepsPerTurn);

  params.trace({
    sessionId: params.session.id,
    turn: limitedState.turn,
    step: limitedState.step,
    scope: 'turn',
    phase: 'turn.max_steps',
    message: 'turn reached max steps',
    data: {
      maxSteps: params.maxStepsPerTurn,
    },
  });

  // 返回持久化消息的 Observable，不再继续
  return persistAssistantMessage({
    session: params.session,
    sessionManager: params.sessionManager,
    history: params.history,
    turn: limitedState.turn,
    content: message,
    contextManager: params.contextManager,
  });
}

/**
 * 发送前预算检查：在调用 provider 前检查 prompt + history 是否接近
 * context window 上限。超限时先压缩，避免 API 因超限直接拒绝请求。
 *
 * 返回预算警告事件流（未超限时为 EMPTY），由调用方 concat 到 provider$ 之前发出。
 */
function checkBudgetAndPreCompact(params: {
  contextManager: ContextManager;
  history: HistoryRecord[];
  session: SessionMetadata;
  sessionManager: SessionManager;
  turn: number;
  step: number;
  trace: (event: DebugTraceInput) => void;
}): Observable<RuntimeEvent> {
  const estimatedTotal = params.contextManager.getPromptTokens() + params.contextManager.getTotalTokens();
  const contextWindow = params.contextManager.getContextWindow();
  if (estimatedTotal <= contextWindow * 0.9) {
    return EMPTY;
  }

  const budgetWarning$ = of<RuntimeEvent>({
    type: 'context_budget_warning',
    sessionId: params.session.id,
    turn: params.turn,
    promptTokens: params.contextManager.getPromptTokens(),
    historyTokens: params.contextManager.getTotalTokens(),
    contextWindow,
  });

  const preCompaction = maybeCompactContext({
    contextManager: params.contextManager,
    history: params.history,
    sessionId: params.session.id,
    turn: params.turn,
  });
  if (preCompaction && preCompaction.type === 'context_compacted') {
    persistCompactionRecord(params.sessionManager, params.session, preCompaction);
    params.trace({
      sessionId: params.session.id,
      turn: params.turn,
      step: params.step,
      scope: 'provider',
      phase: 'provider.pre_compact',
      message: `pre-send compaction triggered (${estimatedTotal}/${contextWindow} tokens)`,
      data: {
        estimatedTotal,
        contextWindow,
        removedCount: preCompaction.removedCount,
      },
    });
  }

  return budgetWarning$;
}

// ============================================================
// 核心函数：Turn 循环逻辑
// ============================================================

/**
 * 运行单个 Turn 的循环
 *
 * ## 设计模式：defer + concat + 递归
 *
 * 这个函数使用 `defer` 延迟执行，确保每次递归时重新计算条件。
 *
 * 数据流向：
 * ```
 * defer(() => {
 *   检查步数限制 → 如果超出，返回错误消息
 *   ↓
 *   Provider 执行 → concatMap 处理每个事件
 *   ↓                  ↓
 *   assistant_chunk → 累积状态
 *   assistant_message → 标记完成
 *   tool_call → 执行工具
 *   ↓
 *   continuation$ (递归或结束)
 * })
 * ```
 *
 * ## 为什么使用 defer？
 *
 * defer 延迟执行函数体，直到 Observable 被订阅。
 * 这使得每次递归时都能重新检查 state.step 是否超出限制。
 *
 * ## 为什么使用 concat？
 *
 * concat 确保 provider$ 完全执行完毕后，才开始 continuation$。
 * 这是实现顺序执行的关键。
 *
 * ## 状态管理模式
 *
 * 本函数使用可变状态模式：
 * - `state` 变量在 concatMap 内部通过 tap 更新
 * - 这确保了工具执行结果能正确累积到状态中
 * - 最终状态用于决定 continuation$ 的行为
 *
 * @param params - 包含会话、状态、Provider 等参数
 * @returns 发出 RuntimeEvent 的 Observable
 */
function runTurnLoop(params: {
  session: SessionMetadata;
  sessionManager: SessionManager;
  provider: AgentProvider;
  context: ReturnType<typeof createTurnContext>;
  history: HistoryRecord[];
  state: TurnState;
  toolRegistry?: ToolRegistry;
  permissionGate?: PermissionGate;
  cwd: string;
  maxStepsPerTurn: number;
  trace: (event: DebugTraceInput) => void;
  /** 技能执行器（可选） */
  skillExecutor?: SkillExecutor;
  /** Provider 注册表（用于子 Agent 模型选择） */
  providerRegistry?: ProviderRegistry;
  /** Provider 配置（用于子 Agent 模型选择） */
  providerSettings?: ProviderSettings;
  /** 子 Agent 执行超时（毫秒） */
  childAgentTimeout?: number;
  /** 用户输入桥接器（用于 ask-user 工具） */
  userInputBridge?: UserInputBridge;
  /** 当前 spawn 嵌套深度（用于限制递归 spawn） */
  spawnDepth?: number;
  /** 可选：完整 loadedSettings，透传到 dispatchToolCall → spawn-agent 用于读 multiAgent 配置 */
  loadedSettings?: LoadedWastelandSettings;
  /** 上下文管理器 */
  contextManager: ContextManager;
  /** 可选：用于打断当前生成的流 */
  abort$?: Observable<void>;
}): Observable<RuntimeEvent> {
  // defer 延迟执行，确保每次递归时重新评估条件
  return defer(() => {
    // ---- 技能命令检测 ----
    // 如果输入是技能命令，路由到 SkillExecutor（详见 routeSkillCommand）
    const skillRouted$ = routeSkillCommand({
      skillExecutor: params.skillExecutor,
      toolRegistry: params.toolRegistry,
      permissionGate: params.permissionGate,
      provider: params.provider,
      session: params.session,
      sessionManager: params.sessionManager,
      history: params.history,
      cwd: params.cwd,
      turn: params.state.turn,
      step: params.state.step,
      inputContent: params.context.input.content,
      trace: params.trace,
    });
    if (skillRouted$) {
      return skillRouted$;
    }

    // ---- 检查步数限制 ----
    // 如果超出最大步数，提前终止并返回错误消息（详见 checkMaxStepsExceeded）
    const maxStepsExceeded$ = checkMaxStepsExceeded({
      state: params.state,
      maxStepsPerTurn: params.maxStepsPerTurn,
      session: params.session,
      sessionManager: params.sessionManager,
      history: params.history,
      contextManager: params.contextManager,
      trace: params.trace,
    });
    if (maxStepsExceeded$) {
      return maxStepsExceeded$;
    }

    // ---- 初始化本轮状态 ----
    // 使用可变状态，在 concatMap 内部通过 tap 更新
    let state = params.state;
    // nextAction 用于决定 continuation$ 的行为
    let nextAction: 'complete' | 'tool' | 'none' = 'none';

    // 记录 Provider 开始
    params.trace({
      sessionId: params.session.id,
      turn: state.turn,
      step: state.step,
      scope: 'provider',
      phase: 'provider.start',
      message: 'run provider step',
      data: {
        provider: params.provider.id,
        history: state.history.length,
        toolResults: state.toolResults.length,
      },
    });

    // ---- 发送前预算检查 ----
    // 在调用 provider 前检查 prompt + history 是否接近 context window 上限。
    // 超限时先压缩，避免 API 因超限直接拒绝请求。
    // 预算警告事件通过 Observable 链在 provider$ 之前发出（详见 checkBudgetAndPreCompact）。
    const budgetWarning$ = checkBudgetAndPreCompact({
      contextManager: params.contextManager,
      history: params.history,
      session: params.session,
      sessionManager: params.sessionManager,
      turn: state.turn,
      step: state.step,
      trace: params.trace,
    });

    // ---- Provider 执行阶段 ----
    // provider.runStep 返回一个 Observable<ProviderStreamEvent>。
    // 重构（恢复流式打字效果）：
    //   1) assistant_chunk 等 non-tool 事件**立即** emit（恢复打字流式）
    //   2) tool_call 累积到 buffer，不立即 emit
    //   3) 流结束后处理 tail：spawn_agent forkJoin 并行（保留 #11）+ 其他串行
    //   4) provider 错误仍转 assistant_message（之前的修复保留）
    const provider$: Observable<RuntimeEvent> = defer((): Observable<RuntimeEvent> => {
      // ---- 共享状态（闭包内 helper 可见，引用外层 state/nextAction） ----
      let streamIndex = 0;
      const toolCallBuffer: Array<{
        event: { type: 'tool_call'; call: { id: string; toolName: string; input: Record<string, unknown> } };
        index: number;
      }> = [];

      // ---- 流式处理单个 non-tool 事件（chunks 等立即 emit） ----
      function processStreamedNonToolEvent(
        event: { type: string; text?: string; call?: unknown; usage?: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number } }
      ): Observable<RuntimeEvent> {
        if (event.type === 'assistant_chunk' && event.text) {
          state = appendAssistantChunk(state, event.text);
          // 每个 chunk 单独 trace（debug 模式下写入文件，带时间戳用于验证流式）
          params.trace({
            sessionId: params.session.id,
            turn: state.turn,
            step: state.step,
            scope: 'provider',
            phase: 'provider.chunk',
            message: 'chunk received',
            data: { textLength: event.text.length, preview: event.text.slice(0, 50) },
          });
          return of<RuntimeEvent>({
            type: 'assistant_chunk',
            sessionId: params.session.id,
            turn: state.turn,
            chunk: event.text,
          });
        }
        if (event.type === 'assistant_message') {
          const content = event.text ?? '';
          state = completeTurnState(state, content);
          nextAction = 'complete';
          params.trace({
            sessionId: params.session.id,
            turn: state.turn,
            step: state.step,
            scope: 'turn',
            phase: 'turn.complete',
            message: 'turn completed',
            data: { contentLength: content.length },
          });
          const assistantRecord = createAssistantRecord(state.turn, content);
          return from(
            params.sessionManager.appendRecord(params.session, assistantRecord)
          ).pipe(
            // 推入内存 history：确保后续 turn 的 LLM 能看到自己之前的回复
            tap(() => {
              params.history.push(assistantRecord);
              params.contextManager.trackRecord(assistantRecord);
            }),
            map(
              (): RuntimeEvent => ({
                type: 'assistant_message',
                sessionId: params.session.id,
                turn: state.turn,
                content,
              })
            )
          );
        }
        // 处理 usage 事件
        if (event.type === 'usage' && event.usage) {
          const usage = event.usage;

          // 报告给上下文管理器（API 真实 token 数覆盖估算值）
          params.contextManager.reportUsage(usage);

          // 向 LogBus 发送用法追踪（TUI Logs 中可见）
          let usageMessage = `Tokens: ↑${usage.promptTokens} ↓${usage.completionTokens} = ${usage.totalTokens}`;
          if (usage.cachedTokens != null && usage.promptTokens > 0) {
            const hitRate = Math.round((usage.cachedTokens / usage.promptTokens) * 100);
            usageMessage += ` (Cache Hit: ${usage.cachedTokens}, ${hitRate}%)`;
          }

          params.trace({
            sessionId: params.session.id,
            turn: state.turn,
            step: state.step,
            scope: 'provider',
            phase: 'provider.usage',
            message: usageMessage,
            data: { usage },
          });

          const usageEvent$ = from(
            params.sessionManager.appendRecord(
              params.session,
              createUsageRecord(params.session.id, state.turn, usage)
            )
          ).pipe(
            map(
              (): RuntimeEvent => ({
                type: 'usage_update',
                sessionId: params.session.id,
                turn: state.turn,
                usage,
              })
            )
          );

          // 异步摘要压缩：defer 保证订阅时才执行，mergeMap 展平 Promise 结果。
          // 压缩事件先于 usage_update 发出（若有），并持久化到会话记录。
          const compaction$ = defer(async () => {
            const ev = await maybeSummaryCompact({
              contextManager: params.contextManager,
              history: params.history,
              provider: params.provider,
              sessionId: params.session.id,
              turn: state.turn,
              cwd: params.cwd,
              summarizationEnabled:
                params.loadedSettings?.settings?.runtime?.contextSummarization ?? true,
            });
            if (ev) persistCompactionRecord(params.sessionManager, params.session, ev);
            return ev;
          }).pipe(mergeMap((ev) => (ev ? of(ev) : EMPTY)));

          return concat(compaction$, usageEvent$);
        }
        return EMPTY;
      }

      // ---- 流结束后 tail：tool_calls 分发 + 合并 RuntimeEvents（流式）----
      // 修复：主 agent spawn 子 agent 时进度不显示
      // 根因：旧实现用 forkJoin + toArray 全量缓冲，直至全部子 agent 完成后才 concat 重放，
      //       中间的 agent_spawned/agent_thinking/agent_tool_use/agent_progress 被吞。
      // 新实现：spawn 并行用 merge 实时合并，其他工具串行用 concat，按到达顺序实时透传；
      //         history/ TurnState / compaction 按 originalIndex 排序在流结束后统一落盘，保证上下文确定性。
      function processProviderTail(): Observable<RuntimeEvent> {
        return defer(() => {
          if (toolCallBuffer.length === 0) {
            return EMPTY;
          }

          for (const { event } of toolCallBuffer) {
            state = recordToolCall(state, event.call);
          }
          nextAction = 'tool';

          const spawnEvents = toolCallBuffer.filter(
            (tc) => tc.event.call.toolName === 'spawn_agent'
          );
          const otherEvents = toolCallBuffer.filter(
            (tc) => tc.event.call.toolName !== 'spawn_agent'
          );

          type Collected = {
            call: { id: string; toolName: string; input: Record<string, unknown> };
            event: RuntimeEvent & { type: 'tool_result' | 'tool_failed' };
            originalIndex: number;
          };
          const collected: Collected[] = [];

          const wrap = (
            call: { id: string; toolName: string; input: Record<string, unknown> },
            idx: number
          ): Observable<RuntimeEvent> =>
            dispatchSingleToolCall(call, state, idx).pipe(
              tap((ev) => {
                if (ev.type === 'tool_result' || ev.type === 'tool_failed') {
                  collected.push({ call, event: ev as Collected['event'], originalIndex: idx });
                }
              })
            );

          const spawnStreams$: Observable<RuntimeEvent> =
            spawnEvents.length > 0
              ? merge(...spawnEvents.map(({ event, index }) => wrap(event.call, index)))
              : EMPTY;

          const otherStreams$: Observable<RuntimeEvent> =
            otherEvents.length > 0
              ? concat(...otherEvents.map(({ event, index }) => wrap(event.call, index)))
              : EMPTY;

          const streaming$: Observable<RuntimeEvent> =
            spawnEvents.length > 0 && otherEvents.length > 0
              ? concat(spawnStreams$, otherStreams$)
              : spawnEvents.length > 0
                ? spawnStreams$
                : otherStreams$;

          const historyPart$ = defer((): Observable<RuntimeEvent> => {
            if (collected.length === 0) return EMPTY;
            collected.sort((a, b) => a.originalIndex - b.originalIndex);
            const compactionEvents: RuntimeEvent[] = [];
            for (const { call, event } of collected) {
              const toolCallRecord: SessionToolCallRecord = createToolCallRecord(
                params.session,
                state.turn,
                call
              );
              params.history.push(toolCallRecord);
              params.contextManager.trackRecord(toolCallRecord);

              if (event.type === 'tool_result') {
                const rec: SessionToolResultRecord = createToolResultRecord({
                  session: params.session,
                  turn: state.turn,
                  call,
                  status: event.status,
                  output: truncateToolOutput(event.output),
                });
                params.history.push(rec);
                params.contextManager.trackRecord(rec);
                state = recordToolResult(state, {
                  callId: call.id,
                  toolName: event.toolName,
                  input: call.input,
                  status: event.status,
                  output: event.output,
                });
              } else {
                const rec: SessionToolResultRecord = createToolResultRecord({
                  session: params.session,
                  turn: state.turn,
                  call,
                  status: event.status,
                  error: truncateToolOutput(event.error),
                });
                params.history.push(rec);
                params.contextManager.trackRecord(rec);
                state = recordToolResult(state, {
                  callId: call.id,
                  toolName: event.toolName,
                  input: call.input,
                  status: event.status,
                  error: event.error,
                });
              }

              const compaction = maybeCompactContext({
                contextManager: params.contextManager,
                history: params.history,
                sessionId: params.session.id,
                turn: state.turn,
              });
              if (compaction) {
                persistCompactionRecord(params.sessionManager, params.session, compaction);
                compactionEvents.push(compaction);
              }
            }
            return compactionEvents.length > 0 ? from(compactionEvents) : EMPTY;
          });

          return concat(streaming$, historyPart$);
        });
      }

      const abortError$ = params.abort$
        ? params.abort$.pipe(map(() => { throw new Error('AbortError'); }))
        : EMPTY;

      return merge(
        params.provider.runStep({
          context: params.context,
          state,
        }),
        abortError$
      )
        .pipe(
          // 收集 tool_calls 到 buffer（chunks 等不缓冲）
          tap((e) => {
            if (e.type === 'tool_call' && e.call) {
              toolCallBuffer.push({
                event: e as { type: 'tool_call'; call: { id: string; toolName: string; input: Record<string, unknown> } },
                index: streamIndex,
              });
            }
            streamIndex++;
          }),
          // 流式处理 non-tool events（chunks 等立即 emit）
          mergeMap((e) => processStreamedNonToolEvent(e)),
          // provider 错误转 assistant_message（之前的修复保留：让用户看到具体错误）
          catchError((err): Observable<RuntimeEvent> => {
            const errMsg = err instanceof Error ? err.message : String(err);
            const isAbort = errMsg === 'AbortError';
            
            params.trace({
              sessionId: params.session.id,
              turn: state.turn,
              step: state.step,
              scope: 'provider',
              phase: isAbort ? 'provider.abort' : 'provider.error',
              message: isAbort ? 'provider aborted by user' : `provider failed: ${errMsg}`,
              data: { provider: params.provider.id },
            });
            const errorContent = isAbort ? `[系统] 已中断响应。` : `[错误] provider 调用失败: ${errMsg}`;
            state = completeTurnState(state, errorContent);
            return from(
              params.sessionManager.appendRecord(
                params.session,
                createAssistantRecord(state.turn, errorContent)
              )
            ).pipe(
              map(
                (): RuntimeEvent => ({
                  type: 'assistant_message',
                  sessionId: params.session.id,
                  turn: state.turn,
                  content: errorContent,
                })
              )
            );
          }),
          // 流结束后，flush tool_calls
          concatWith(defer(() => processProviderTail()))
        );
    });

    // ---- 内部辅助函数：分发单个工具调用（流式，纯透传）----
    // 职责：仅做 trace 并实时透传所有 RuntimeEvent（关键修复：不再 toArray 缓冲）。
    // history / TurnState / compaction 的落盘与排序由 processProviderTail 统一在流结束后按 originalIndex 排序处理，
    // 以保证并发 spawn 时 history 仍保持 provider 发出顺序的确定性，同时不阻塞进度实时展示。
    function dispatchSingleToolCall(
      call: { id: string; toolName: string; input: Record<string, unknown> },
      currentState: TurnState,
      _originalIndex: number
    ): Observable<RuntimeEvent> {
      if (!params.toolRegistry || !params.permissionGate) {
        const error = t('runtime.noToolRegistry');
        params.trace({
          sessionId: params.session.id,
          turn: state.turn,
          step: state.step,
          scope: 'tool',
          phase: 'tool.result',
          message: 'tool execution failed before dispatch',
          data: { tool: call.toolName, status: 'error' },
        });
        // 无 registry 时仍需记录一次失败结果以驱动 continuation 正确推进；此处直接更新 state（单分支，无并发排序问题）
        state = recordToolResult(state, {
          callId: call.id,
          toolName: call.toolName,
          input: call.input,
          status: 'error',
          error,
        });
        return of<RuntimeEvent>({
          type: 'tool_failed',
          sessionId: params.session.id,
          turn: state.turn,
          callId: call.id,
          toolName: call.toolName,
          status: 'error',
          error,
        });
      }

      const startedAt = Date.now();

      return dispatchToolCall({
        session: params.session,
        sessionManager: params.sessionManager,
        turn: state.turn,
        call,
        registry: params.toolRegistry,
        permissionGate: params.permissionGate,
        cwd: params.cwd,
        turnState: currentState,
        provider: params.provider,
        history: params.history,
        providerRegistry: params.providerRegistry,
        providerSettings: params.providerSettings,
        childAgentTimeout: params.childAgentTimeout,
        userInputBridge: params.userInputBridge,
        loadedSettings: params.loadedSettings,
        spawnDepth: params.spawnDepth,
      }).pipe(
        tap((event) => {
          if (event.type === 'tool_started') {
            params.trace({
              sessionId: params.session.id,
              turn: state.turn,
              step: state.step,
              scope: 'tool',
              phase: 'call',
              message: 'tool execution started',
              data: { toolName: event.toolName, callId: event.callId },
            });
          } else if (event.type === 'permission_decision') {
            params.trace({
              sessionId: params.session.id,
              turn: state.turn,
              step: state.step,
              scope: 'tool',
              phase: 'permission',
              message: 'permission decision resolved',
              data: {
                toolName: event.toolName,
                decision: event.decision,
                mode: event.mode,
                callId: event.callId,
              },
            });
          } else if (event.type === 'tool_result') {
            params.trace({
              sessionId: params.session.id,
              turn: state.turn,
              step: state.step,
              scope: 'tool',
              phase: 'success',
              message: 'tool execution completed',
              data: {
                toolName: event.toolName,
                status: event.status,
                ms: Date.now() - startedAt,
                callId: event.callId,
              },
            });
          } else if (event.type === 'tool_failed') {
            params.trace({
              sessionId: params.session.id,
              turn: state.turn,
              step: state.step,
              scope: 'tool',
              phase: 'error',
              message: 'tool execution failed',
              data: {
                toolName: event.toolName,
                status: event.status,
                ms: Date.now() - startedAt,
                error: event.error,
                callId: event.callId,
              },
            });
          }
        })
      );
    }

    // ---- 后续处理阶段 (continuation$) ----
    // 使用 defer 延迟执行，根据 nextAction 决定后续行为
    const continuation$ = defer(() => {
      // 情况 1: Turn 完成，无需继续
      if (nextAction === 'complete' || state.status === 'completed') {
        // EMPTY 是一个立即 complete 的 Observable，不发出任何值
        return EMPTY;
      }

      // 情况 2: 工具调用完成，需要递归调用 Provider
      if (nextAction === 'tool') {
        // 推进步数
        const nextState = advanceTurnState(state);

        params.trace({
          sessionId: params.session.id,
          turn: nextState.turn,
          step: nextState.step,
          scope: 'turn',
          phase: 'turn.advance',
          message: 'advance to next provider step',
          data: {
            toolResults: nextState.toolResults.length,
          },
        });

        // 递归调用 runTurnLoop
        // 新的状态包含增加的 step 和累积的 toolResults
        return runTurnLoop({
          ...params,
          state: nextState,
        });
      }

      // 情况 3: Provider 没有返回最终消息（异常情况）
      // 使用累积的 chunks 作为回退
      const fallbackMessage = buildProviderFallbackMessage(state);
      state = completeTurnState(state, fallbackMessage);

      params.trace({
        sessionId: params.session.id,
        turn: state.turn,
        step: state.step,
        scope: 'provider',
        phase: 'provider.empty',
        message: 'provider completed without final assistant message',
        data: {
          chunkCount: state.assistantChunks.length,
        },
      });

      return persistAssistantMessage({
        session: params.session,
        sessionManager: params.sessionManager,
        history: params.history,
        turn: state.turn,
        content: fallbackMessage,
        contextManager: params.contextManager,
      }).pipe(
        tap(() => {
          params.trace({
            sessionId: params.session.id,
            turn: state.turn,
            step: state.step,
            scope: 'turn',
            phase: 'turn.complete',
            message: 'turn completed via fallback assistant message',
            data: {
              contentLength: fallbackMessage.length,
            },
          });
        })
      );
    });

    // ---- 使用 concat 顺序拼接 ----
    // concat 确保以下执行顺序：
    // 1. provider$ 完全执行（所有事件处理完毕）
    // 2. continuation$ 开始执行（递归或结束）
    return concat(budgetWarning$, provider$, continuation$);
  });
}

// ============================================================
// 主入口函数：运行 Agent 循环
// ============================================================

/**
 * 运行 Agent 主循环
 *
 * ## 整体架构
 *
 * ```
 * input$ (用户输入流)
 *    ↓
 * runAgentLoop
 *    ↓
 * ┌─────────────────────────────────────┐
 * │  1. 创建 Session                     │
 * │     ↓                                │
 * │  2. start$: 发出 session_started    │
 * │     ↓                                │
 * │  3. turns$: 处理每个用户输入        │
 * │     ├─ user$: 发出 user_turn        │
 * │     └─ assistant$: runTurnLoop      │
 * │     ↓                                │
 * │  4. end$: 发出 session_ended        │
 * └─────────────────────────────────────┘
 *    ↓
 * RuntimeEvent 流
 * ```
 *
 * ## 数据流图
 *
 * ```
 *                  ┌──────────────────┐
 *                  │   input$         │  用户输入流
 *                  │ (ChatInputTurn)  │
 *                  └────────┬─────────┘
 *                           │
 *                           │ concatMap (顺序处理每个 turn)
 *                           ↓
 *                  ┌──────────────────┐
 *                  │   user$          │  持久化用户输入
 *                  └────────┬─────────┘
 *                           │
 *                           │ concat (顺序执行)
 *                           ↓
 *                  ┌──────────────────┐
 *                  │   runTurnLoop    │  Agent 响应循环
 *                  │                  │
 *                  │  ┌────────────┐  │
 *                  │  │  provider  │  │  Provider 响应
 *                  │  └─────┬──────┘  │
 *                  │        │         │
 *                  │        │ concat  │
 *                  │        ↓         │
 *                  │  ┌────────────┐  │
 *                  │  │continuation│  │  递归或结束
 *                  │  └────────────┘  │
 *                  └──────────────────┘
 * ```
 *
 * ## 关键操作符说明
 *
 * - **defer**: 延迟执行，创建 Observable 时才执行函数体
 * - **concat**: 顺序拼接多个 Observable，前一个完成后再开始下一个
 * - **concatMap**: 对每个值映射为 Observable，顺序订阅
 * - **tap**: 执行副作用（如记录追踪），不改变流
 * - **map**: 转换值
 * - **from**: 将 Promise/Iterable 转换为 Observable
 * - **of**: 创建发出单个值的 Observable
 *
 * @param params - 包含输入流、Provider、会话管理器等参数
 * @returns AgentRun 对象，包含事件流和调试流
 */
export function runAgentLoop(params: {
  input$: Observable<ChatInputTurn>;
  provider: AgentProvider;
  sessionManager: SessionManager;
  toolRegistry?: ToolRegistry;
  permissionGate?: PermissionGate;
  cwd: string;
  mode: RuntimeMode;
  maxStepsPerTurn?: number;
  /** 可选：已有的 session（用于子 Agent） */
  existingSession?: SessionMetadata;
  /** 可选：技能执行器 */
  skillExecutor?: SkillExecutor;
  /** 可选：角色的 system prompt（静态） */
  prompt?: string;
  /** 可选：动态 prompt 解析函数（每 turn 调用，支持 /mode 实时切换） */
  resolvePrompt?: () => string;
  /** 可选：Provider 注册表（用于子 Agent 模型选择） */
  providerRegistry?: ProviderRegistry;
  /** 可选：Provider 配置（用于子 Agent 模型选择） */
  providerSettings?: ProviderSettings;
  /** 可选：子 Agent 执行超时（毫秒） */
  childAgentTimeout?: number;
  /** 可选：用户输入桥接器（用于 ask-user 工具） */
  userInputBridge?: UserInputBridge;
  /** 可选：当前 spawn 嵌套深度（用于限制递归 spawn） */
  spawnDepth?: number;
  /** 可选：是否启用 debug 日志落盘（写入 .wasteland/debug.log） */
  debug?: boolean;
  /** 可选：完整 loadedSettings，透传到 dispatchToolCall → spawn-agent 用于读 multiAgent 配置 */
  loadedSettings?: LoadedWastelandSettings;
  /** 可选：初始历史记录（用于 resume 会话时恢复之前的上下文） */
  initialHistory?: HistoryRecord[];
  /** 可选：用于打断当前生成的流 */
  abort$?: Observable<void>;
}): AgentRun {
  // 创建调试追踪的 Subject
  // 使用 ReplaySubject 缓冲近期事件供迟到的订阅者接收（限 200 条避免长会话内存膨胀）
  const debugSubject = new ReplaySubject<DebugTraceEvent>(200);
  const baseTrace = createTraceEmitter(debugSubject);
  // 统一 trace 入口：debug 开启时同时写入 .wasteland/debug.log，
  // 方便 `tail -f` 实时观察流式、工具调用、错误等
  const trace = (event: DebugTraceInput): void => {
    baseTrace(event);
    if (params.debug) {
      Logger.debug({
        sessionId: event.sessionId,
        turn: event.turn,
        step: event.step,
        scope: event.scope as Parameters<typeof Logger.debug>[0]['scope'],
        message: event.phase
          ? `${event.phase}${event.message ? `: ${event.message}` : ''}`
          : (event.message ?? 'trace'),
        data: event.data,
      });
    }
  };
  const maxStepsPerTurn = params.maxStepsPerTurn ?? 30;

  // 用户输入桥接器（用于 ask-user 工具）
  // 如果未提供，创建新的实例。仅内部创建的实例在会话结束时由本循环销毁；
  // 复用外部传入的（如子 Agent 复用父 Agent 的 bridge）生命周期由所有者管理。
  const ownsUserInputBridge = !params.userInputBridge;
  const userInputBridge = params.userInputBridge ?? new UserInputBridge();

  // ---- 主事件流 ----
  // 使用 defer 延迟执行异步的会话创建
  const events$ = defer(
    async () =>
      // 如果传入了已有 session，使用它；否则创建新会话
      params.existingSession ??
      params.sessionManager.startSession({
        cwd: params.cwd,
        mode: params.mode,
        providerId: params.provider.id,
      })
  ).pipe(
    // concatMap: 将 Promise 结果转换为 Observable，顺序处理
    // 不同于 switchMap，concatMap 不会取消前一个
    concatMap((session) => {
      // 内存中的历史记录（用于上下文）
      // resume 时通过 initialHistory 恢复之前的对话历史（含 tool_call/tool_result）
      const history: HistoryRecord[] = params.initialHistory ? [...params.initialHistory] : [];

      // 上下文管理器（自动压缩）
      // 从模型配置读取 context window，未配置时使用内置默认值
      const modelName = params.providerSettings?.model ?? '';
      // models 以别名（如 minimax_model）为 key，而 modelName 是 provider 模型名
      // （如 MiniMax-M3）。需按 model.model === modelName 匹配别名，否则取不到 contextWindow。
      const modelConfig = Object.entries(
        params.loadedSettings?.settings?.models ?? {}
      ).find(([, cfg]) => cfg?.model?.toLowerCase() === modelName.toLowerCase())?.[1];
      const contextWindow = resolveContextWindow(modelName, modelConfig?.contextWindow);
      const contextManager = new ContextManager({
        contextWindow,
        compactionThreshold:
          params.loadedSettings?.settings?.runtime?.compactionThreshold ?? 0.8,
        summarizationThreshold:
          params.loadedSettings?.settings?.runtime?.summarizationThreshold ?? 0.95,
        compactionBudgetRatio:
          params.loadedSettings?.settings?.runtime?.compactionBudgetRatio ?? 0.6,
      });

      // resume 时初始化 token 计数：恢复的历史已有实际 token 量，
      // 用估算值填充，避免首次压缩判断从 0 开始导致不准
      for (const record of history) {
        contextManager.trackRecord(record);
      }

      // 追踪 system prompt token：prompt 不在 history 中，但占 context window 空间。
      // 需在压缩判断前设置，否则 needsCompaction 会低估实际使用量。
      const initialPrompt = params.resolvePrompt ? params.resolvePrompt() : params.prompt;
      if (initialPrompt) {
        contextManager.setPromptTokens(estimateTokens(initialPrompt));
      }

      // ---- 会话开始阶段 ----
      // 持久化会话开始记录，发出 session_started 事件
      const start$ = defer(() =>
        from(params.sessionManager.appendRecord(session, createSessionStartRecord(session)))
      ).pipe(
        tap(() => {
          trace({
            sessionId: session.id,
            scope: 'session',
            phase: 'session.start',
            message: 'session started',
            data: {
              mode: session.mode,
              provider: session.providerId,
            },
          });
        }),
        map(
          (): RuntimeEvent => ({
            type: 'session_started',
            sessionId: session.id,
            sessionPath: session.path,
            mode: session.mode,
          })
        )
      );

      // ---- Turn 处理阶段 ----
      // 使用 concatMap 顺序处理每个用户输入
      // 注：不再限制 maxTurns，由 context window 自然耗尽管理；
      // maxStepsPerTurn 仍保留以防止单轮工具死循环
      const turns$ = params.input$.pipe(
        concatMap((turn) => {
          // 创建历史快照（用于传递给 Provider）
          const historySnapshot = [...history];

          // 动态 prompt：优先使用 resolvePrompt（支持 /mode 实时切换），否则用静态 params.prompt
          const currentPrompt = params.resolvePrompt ? params.resolvePrompt() : params.prompt;

          const context = createTurnContext({
            sessionId: session.id,
            input: turn,
            cwd: params.cwd,
            history: historySnapshot,
            // params.toolRegistry 直接透传：主 agent 入口（chat / resume / tui）
            // 应当在调用 runAgentLoop 之前用 filterToolRegistry() 过滤一次，
            // 让 minimax 只看到 MAIN_AGENT_TOOL_NAMES；sub-agents 由
            // spawn-agent 根据 multiAgent.tools 自行过滤。
            toolRegistry: params.toolRegistry,
            prompt: currentPrompt,
          });

          // 创建用户记录
          const userRecord = createUserRecord(turn);

          // user$: 持久化用户输入，发出 user_turn 事件
          const user$ = from(params.sessionManager.appendRecord(session, userRecord)).pipe(
            tap(() => {
              history.push(userRecord);
              contextManager.trackRecord(userRecord);
              trace({
                sessionId: session.id,
                turn: turn.turn,
                step: 1,
                scope: 'turn',
                phase: 'turn.input',
                message: 'user turn received',
                data: {
                  source: turn.source,
                },
              });
            }),
            map(
              (): RuntimeEvent => ({
                type: 'user_turn',
                sessionId: session.id,
                turn: turn.turn,
                content: turn.content,
                source: turn.source,
              })
            )
          );

          // assistant$, 运行 Agent 响应循环
          const assistant$ = runTurnLoop({
            session,
            sessionManager: params.sessionManager,
            provider: params.provider,
            context,
            history,
            state: createInitialTurnState({
              sessionId: session.id,
              input: turn,
              cwd: params.cwd,
              history: historySnapshot,
            }),
            toolRegistry: params.toolRegistry,
            permissionGate: params.permissionGate,
            cwd: params.cwd,
            maxStepsPerTurn,
            trace,
            skillExecutor: params.skillExecutor,
            providerRegistry: params.providerRegistry,
            providerSettings: params.providerSettings,
            childAgentTimeout: params.childAgentTimeout,
            userInputBridge,
            spawnDepth: params.spawnDepth,
            contextManager,
            // 透传 loadedSettings：runTurnLoop 读 contextSummarization 配置
            loadedSettings: params.loadedSettings,
            abort$: params.abort$,
          });

          // concat 确保先处理 user$，再处理 assistant$
          return concat(user$, assistant$);
        })
      );

      // ---- 会话结束阶段 ----
      // 持久化会话结束记录，发出 session_ended 事件
      const end$ = defer(() =>
        from(params.sessionManager.appendRecord(session, createSessionEndRecord(session.id)))
      ).pipe(
        tap(() => {
          // 仅销毁内部创建的桥接器；复用外部传入的不在此销毁
          // （子 Agent 复用父 Agent 的 bridge 时，由父会话/UI 层管理其生命周期）
          if (ownsUserInputBridge) {
            userInputBridge.destroy();
          }

          trace({
            sessionId: session.id,
            scope: 'session',
            phase: 'session.end',
            message: 'session ended',
          });
        }),
        map(
          (): RuntimeEvent => ({
            type: 'session_ended',
            sessionId: session.id,
          })
        )
      );

      // 使用 concat 顺序执行三个阶段
      // 这确保了：start$ → turns$ → end$ 的顺序
      return concat(start$, turns$, end$);
    }),
    // 错误处理：记录错误追踪
    tap({
      error: (error) => {
        trace({
          sessionId: 'runtime',
          scope: 'session',
          phase: 'session.error',
          message: error instanceof Error ? error.message : String(error),
        });
      },
    })
  );

  // ---- 返回结果 ----
  // 包装 events$ 以确保 debugSubject 正确完成
  return {
    events$: new Observable<RuntimeEvent>((subscriber) => {
      const subscription = events$.subscribe({
        next: (event) => subscriber.next(event),
        error: (error) => {
          debugSubject.complete();
          subscriber.error(error);
        },
        complete: () => {
          debugSubject.complete();
          subscriber.complete();
        },
      });

      // 返回清理函数
      return () => {
        subscription.unsubscribe();
        debugSubject.complete();
      };
    }),
    // asObservable(): 将 Subject 转换为 Observable，防止外部调用 next
    debug$: debugSubject.asObservable(),
    // 用户输入桥接器
    userInputBridge,
  };
}
