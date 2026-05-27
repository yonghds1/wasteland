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

import { EMPTY, Observable, ReplaySubject, Subject, concat, concatMap, defer, from, map, of, tap } from "rxjs";

import { createDebugTraceEvent, type DebugTraceEvent } from "./debug-events.js";
import type { AgentProvider } from "../providers/provider-types.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import type {
  ChatInputTurn,
  RuntimeEvent,
  RuntimeMode,
  SessionMessageRecord,
  SessionRecord,
} from "./event-types.js";
import type { PermissionGate } from "./permission-gate.js";
import { SessionManager, type SessionMetadata } from "./session-manager.js";
import { dispatchToolCall } from "./tool-dispatch.js";
import { createTurnContext } from "./turn-context.js";
import type { SkillExecutor } from "../skills/skill-executor.js";
import type { ProviderSettings } from "../config/settings-types.js";
import type { ProviderRegistry } from "../providers/provider-registry.js";
import {
  advanceTurnState,
  appendAssistantChunk,
  completeTurnState,
  createInitialTurnState,
  failTurnState,
  recordToolCall,
  recordToolResult,
  type TurnState,
} from "./turn-state.js";

// ============================================================
// 工具函数：时间戳和记录创建
// ============================================================

/**
 * 创建易读的时间戳字符串
 * 格式: 2026-05-24 11:30:00 (本地时间，精确到秒)
 */
function createTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

/**
 * 创建用户消息记录
 * @param turn - 用户输入轮次
 * @returns 用于持久化的用户消息记录
 */
function createUserRecord(turn: ChatInputTurn): SessionMessageRecord {
  return {
    type: "message",
    role: "user",
    turn: turn.turn,
    content: turn.content,
    source: turn.source,
    timestamp: createTimestamp(),
  };
}

/**
 * 创建助手消息记录
 * @param turn - 当前轮次号
 * @param content - 助手回复内容
 * @returns 用于持久化的助手消息记录
 */
function createAssistantRecord(turn: number, content: string): SessionMessageRecord {
  return {
    type: "message",
    role: "assistant",
    turn,
    content,
    timestamp: createTimestamp(),
  };
}

/**
 * 创建会话开始记录
 * @param session - 会话元数据
 * @returns 用于持久化的会话开始记录
 */
function createSessionStartRecord(session: SessionMetadata): SessionRecord {
  return {
    type: "session",
    sessionId: session.id,
    mode: session.mode,
    cwd: session.cwd,
    provider: session.providerId,
    timestamp: createTimestamp(),
    parentId: session.parentId,
    childName: session.childName,
  };
}

/**
 * 创建会话结束记录
 * @param sessionId - 会话 ID
 * @returns 用于持久化的会话结束记录
 */
function createSessionEndRecord(sessionId: string): SessionRecord {
  return {
    type: "session_end",
    sessionId,
    timestamp: createTimestamp(),
  };
}

// ============================================================
// 类型定义
// ============================================================

/** 调试追踪事件的输入参数（不含时间戳） */
type DebugTraceInput = Omit<DebugTraceEvent, "timestamp">;

/** Agent 运行结果，包含事件流和调试流 */
type AgentRun = {
  /** 运行时事件流：包含会话、用户输入、助手响应、工具调用等事件 */
  events$: Observable<RuntimeEvent>;
  /** 调试追踪流：用于调试的详细事件流 */
  debug$: Observable<DebugTraceEvent>;
};

// ============================================================
// 辅助函数：消息持久化和追踪
// ============================================================

/**
 * 持久化助手消息并发送 RuntimeEvent
 *
 * 数据流向：
 * 1. 创建助手消息记录
 * 2. 通过 SessionManager 追加到会话文件
 * 3. 将记录添加到内存历史
 * 4. 发出 assistant_message 事件
 *
 * @param params - 包含会话、管理器、历史、轮次和内容的参数
 * @returns 发出 assistant_message 事件的 Observable
 */
function persistAssistantMessage(params: {
  session: SessionMetadata;
  sessionManager: SessionManager;
  history: SessionMessageRecord[];
  turn: number;
  content: string;
}): Observable<RuntimeEvent> {
  const assistantRecord = createAssistantRecord(params.turn, params.content);

  // from() 将 Promise 转换为 Observable
  // 使用 tap 在副作用中更新内存历史
  return from(params.sessionManager.appendRecord(params.session, assistantRecord)).pipe(
    tap(() => {
      params.history.push(assistantRecord);
    }),
    map(
      (): RuntimeEvent => ({
        type: "assistant_message",
        sessionId: params.session.id,
        turn: params.turn,
        content: params.content,
      }),
    ),
  );
}

/**
 * 创建调试追踪发射器
 * @param subject - 用于发射调试事件的 Subject
 * @returns 发射调试事件的函数
 */
function createTraceEmitter(subject: Subject<DebugTraceEvent>) {
  return (event: DebugTraceInput): void => {
    subject.next(createDebugTraceEvent(event));
  };
}

// ============================================================
// 辅助函数：消息构建
// ============================================================

/**
 * 构建 Provider 未返回最终消息时的回退内容
 * @param state - 当前 turn 状态
 * @returns 用于显示的回退消息
 */
function buildProviderFallbackMessage(state: TurnState): string {
  // 如果有累积的 chunk，拼接它们
  if (state.assistantChunks.length > 0) {
    return state.assistantChunks.join("");
  }

  // 否则返回默认消息
  return "当前 provider 未返回最终消息。";
}

/**
 * 构建达到最大步数限制的提示消息
 * @param maxStepsPerTurn - 单轮最大步数
 * @returns 提示消息
 */
function buildMaxStepsMessage(maxStepsPerTurn: number): string {
  return `当前单轮已达到最大工具步数限制（${maxStepsPerTurn}）。`;
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
  history: SessionMessageRecord[];
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
}): Observable<RuntimeEvent> {
  // defer 延迟执行，确保每次递归时重新评估条件
  return defer(() => {
    // ---- 技能命令检测 ----
    // 如果输入是技能命令，路由到 SkillExecutor
    const inputContent = params.context.input.content;
    if (params.skillExecutor && params.skillExecutor.isSkillCommand(inputContent)) {
      // 解析技能名称用于trace
      const skillName = inputContent.trim().split(/\s+/)[0]?.slice(1) ?? "";

      params.trace({
        sessionId: params.session.id,
        turn: params.state.turn,
        step: params.state.step,
        scope: "skill",
        phase: "started",
        message: "routing to skill executor",
        data: {
          skillName,
          input: inputContent,
        },
      });

      // 执行技能
      return params.skillExecutor.execute({
        input: inputContent,
        sessionId: params.session.id,
        turn: params.state.turn,
        cwd: params.cwd,
        session: params.session,
        toolRegistry: params.toolRegistry!,
        permissionGate: params.permissionGate!,
        sessionManager: params.sessionManager,
        provider: params.provider,
        history: params.history,
        output: (msg) => {
          // 技能的进度输出（目前暂不处理，可以后续扩展）
          params.trace({
            sessionId: params.session.id,
            turn: params.state.turn,
            step: params.state.step,
            scope: "skill",
            phase: "progress",
            message: msg,
            data: { skillName },
          });
        },
      }).pipe(
        // 在技能执行事件上添加debug trace
        tap((event) => {
          if (event.type === "skill_result") {
            params.trace({
              sessionId: params.session.id,
              turn: params.state.turn,
              step: params.state.step,
              scope: "skill",
              phase: event.result.status,
              message: `skill ${event.result.status}`,
              data: {
                skillName: event.skillName,
                result: event.result.output,
              },
            });
          }
        }),
      );
    }

    // ---- 检查步数限制 ----
    // 如果超出最大步数，提前终止并返回错误消息
    if (params.state.step > params.maxStepsPerTurn) {
      const limitedState = failTurnState(params.state);
      const message = buildMaxStepsMessage(params.maxStepsPerTurn);

      params.trace({
        sessionId: params.session.id,
        turn: limitedState.turn,
        step: limitedState.step,
        scope: "turn",
        phase: "turn.max_steps",
        message: "turn reached max steps",
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
      });
    }

    // ---- 初始化本轮状态 ----
    // 使用可变状态，在 concatMap 内部通过 tap 更新
    let state = params.state;
    // nextAction 用于决定 continuation$ 的行为
    let nextAction: "complete" | "tool" | "none" = "none";

    // 记录 Provider 开始
    params.trace({
      sessionId: params.session.id,
      turn: state.turn,
      step: state.step,
      scope: "provider",
      phase: "provider.start",
      message: "run provider step",
      data: {
        provider: params.provider.id,
        history: state.history.length,
        toolResults: state.toolResults.length,
      },
    });

    // ---- Provider 执行阶段 ----
    // provider.runStep 返回一个 Observable<ProviderStreamEvent>
    // 使用 concatMap 顺序处理每个事件，确保事件顺序正确
    const provider$ = params.provider.runStep({
      context: params.context,
      state,
    }).pipe(
      // concatMap: 对每个事件进行处理，返回新的 Observable
      // 与 switchMap 不同，concatMap 保证事件按顺序处理
      concatMap((event) => {
        // 非 chunk 事件记录追踪
        if (event.type !== "assistant_chunk") {
          params.trace({
            sessionId: params.session.id,
            turn: state.turn,
            step: state.step,
            scope: "provider",
            phase: "provider.event",
            message: "provider emitted event",
            data: {
              type: event.type,
              toolName: event.type === "tool_call" ? event.call.toolName : undefined,
            },
          });
        }

        // ---- 处理 assistant_chunk 事件 ----
        // assistant_chunk 是流式响应的文本片段，需要累积起来
        if (event.type === "assistant_chunk") {
          // 将 chunk 追加到状态中
          state = appendAssistantChunk(state, event.text);

          // 发出 assistant_chunk RuntimeEvent 供 UI 显示
          return of<RuntimeEvent>({
            type: "assistant_chunk",
            sessionId: params.session.id,
            turn: state.turn,
            chunk: event.text,
          });
        }

        // ---- 处理 assistant_message 事件 ----
        // assistant_message 是 Provider 返回的最终完整消息，
        // 表示当前 turn 完成，无需工具调用
        if (event.type === "assistant_message") {
          // 标记 turn 为完成状态
          state = completeTurnState(state, event.text);
          // 标记 turn 完成
          nextAction = "complete";

          // 持久化消息并发出事件
          // 使用 tap 在持久化完成后记录追踪
          return persistAssistantMessage({
            session: params.session,
            sessionManager: params.sessionManager,
            history: params.history,
            turn: state.turn,
            content: event.text,
          }).pipe(
            tap(() => {
              params.trace({
                sessionId: params.session.id,
                turn: state.turn,
                step: state.step,
                scope: "turn",
                phase: "turn.complete",
                message: "turn completed",
                data: {
                  contentLength: event.text.length,
                },
              });
            }),
          );
        }

        // ---- 处理 tool_call 事件 ----
        // tool_call 表示 Agent 想要调用工具
        // 需要进行权限检查，然后执行工具
        state = recordToolCall(state, event.call);
        nextAction = "tool";

        // 检查是否配置了工具执行所需的基础设施
        if (!params.toolRegistry || !params.permissionGate) {
          const error = "当前运行时未配置 tool registry 或 permission gate。";

          // 记录错误结果
          state = recordToolResult(state, {
            callId: event.call.id,
            toolName: event.call.toolName,
            input: event.call.input,
            status: "error",
            error,
          });

          params.trace({
            sessionId: params.session.id,
            turn: state.turn,
            step: state.step,
            scope: "tool",
            phase: "tool.result",
            message: "tool execution failed before dispatch",
            data: {
              tool: event.call.toolName,
              status: "error",
            },
          });

          // 发出失败事件
          return of<RuntimeEvent>({
            type: "tool_failed",
            sessionId: params.session.id,
            turn: state.turn,
            callId: event.call.id,
            toolName: event.call.toolName,
            status: "error",
            error,
          });
        }

        // 记录开始时间用于计算耗时
        const startedAt = Date.now();

        // 分发工具调用
        // dispatchToolCall 返回工具执行事件的 Observable
        return dispatchToolCall({
          session: params.session,
          sessionManager: params.sessionManager,
          turn: state.turn,
          call: event.call,
          registry: params.toolRegistry,
          permissionGate: params.permissionGate,
          cwd: params.cwd,
          turnState: state,
          // 多 Agent 支持
          provider: params.provider,
          history: params.history,
          providerRegistry: params.providerRegistry,
          providerSettings: params.providerSettings,
          childAgentTimeout: params.childAgentTimeout,
        }).pipe(
          // tap 用于副作用：更新状态和记录追踪
          // 注意：这里更新外层的 state 变量，这是关键！
          // 工具执行结果必须累积到状态中，供下一次递归使用
          tap((toolEvent) => {
            if (toolEvent.type === "tool_started") {
              params.trace({
                sessionId: params.session.id,
                turn: state.turn,
                step: state.step,
                scope: "tool",
                phase: "call",
                message: "tool execution started",
                data: {
                  toolName: toolEvent.toolName,
                  callId: toolEvent.callId,
                },
              });

              return;
            }

            if (toolEvent.type === "permission_decision") {
              params.trace({
                sessionId: params.session.id,
                turn: state.turn,
                step: state.step,
                scope: "tool",
                phase: "permission",
                message: "permission decision resolved",
                data: {
                  toolName: toolEvent.toolName,
                  decision: toolEvent.decision,
                  mode: toolEvent.mode,
                  callId: toolEvent.callId,
                },
              });

              return;
            }

            // tool_result: 工具执行成功
            // 更新状态，记录工具结果
            if (toolEvent.type === "tool_result") {
              // 从 toolCalls 中查找原始 input
              const originalCall = state.toolCalls.find((tc) => tc.id === toolEvent.callId);

              state = recordToolResult(state, {
                callId: toolEvent.callId,
                toolName: toolEvent.toolName,
                input: originalCall?.input ?? {},
                status: toolEvent.status,
                output: toolEvent.output,
              });

              params.trace({
                sessionId: params.session.id,
                turn: state.turn,
                step: state.step,
                scope: "tool",
                phase: "success",
                message: "tool execution completed",
                data: {
                  toolName: toolEvent.toolName,
                  status: toolEvent.status,
                  ms: Date.now() - startedAt,
                  callId: toolEvent.callId,
                },
              });

              return;
            }

            // tool_failed: 工具执行失败
            // 同样需要更新状态，记录失败结果
            if (toolEvent.type === "tool_failed") {
              // 从 toolCalls 中查找原始 input
              const originalCall = state.toolCalls.find((tc) => tc.id === toolEvent.callId);

              state = recordToolResult(state, {
                callId: toolEvent.callId,
                toolName: toolEvent.toolName,
                input: originalCall?.input ?? {},
                status: toolEvent.status,
                error: toolEvent.error,
              });

              params.trace({
                sessionId: params.session.id,
                turn: state.turn,
                step: state.step,
                scope: "tool",
                phase: "error",
                message: "tool execution failed",
                data: {
                  toolName: toolEvent.toolName,
                  status: toolEvent.status,
                  ms: Date.now() - startedAt,
                  error: toolEvent.error,
                  callId: toolEvent.callId,
                },
              });
            }
          }),
        );
      }),
    );

    // ---- 后续处理阶段 (continuation$) ----
    // 使用 defer 延迟执行，根据 nextAction 决定后续行为
    const continuation$ = defer(() => {
      // 情况 1: Turn 完成，无需继续
      if (nextAction === "complete" || state.status === "completed") {
        // EMPTY 是一个立即 complete 的 Observable，不发出任何值
        return EMPTY;
      }

      // 情况 2: 工具调用完成，需要递归调用 Provider
      if (nextAction === "tool") {
        // 推进步数
        const nextState = advanceTurnState(state);

        params.trace({
          sessionId: params.session.id,
          turn: nextState.turn,
          step: nextState.step,
          scope: "turn",
          phase: "turn.advance",
          message: "advance to next provider step",
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
        scope: "provider",
        phase: "provider.empty",
        message: "provider completed without final assistant message",
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
      }).pipe(
        tap(() => {
          params.trace({
            sessionId: params.session.id,
            turn: state.turn,
            step: state.step,
            scope: "turn",
            phase: "turn.complete",
            message: "turn completed via fallback assistant message",
            data: {
              contentLength: fallbackMessage.length,
            },
          });
        }),
      );
    });

    // ---- 使用 concat 顺序拼接 ----
    // concat 确保以下执行顺序：
    // 1. provider$ 完全执行（所有事件处理完毕）
    // 2. continuation$ 开始执行（递归或结束）
    return concat(provider$, continuation$);
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
  /** 可选：角色的 system prompt */
  prompt?: string;
  /** 可选：Provider 注册表（用于子 Agent 模型选择） */
  providerRegistry?: ProviderRegistry;
  /** 可选：Provider 配置（用于子 Agent 模型选择） */
  providerSettings?: ProviderSettings;
  /** 可选：子 Agent 执行超时（毫秒） */
  childAgentTimeout?: number;
}): AgentRun {
  // 创建调试追踪的 Subject
  // 使用 ReplaySubject 确保所有事件都能被订阅者接收
  const debugSubject = new ReplaySubject<DebugTraceEvent>();
  const trace = createTraceEmitter(debugSubject);
  const maxStepsPerTurn = params.maxStepsPerTurn ?? 8;

  // ---- 主事件流 ----
  // 使用 defer 延迟执行异步的会话创建
  const events$ = defer(async () =>
    // 如果传入了已有 session，使用它；否则创建新会话
    params.existingSession ?? params.sessionManager.startSession({
      cwd: params.cwd,
      mode: params.mode,
      providerId: params.provider.id,
    }),
  ).pipe(
    // concatMap: 将 Promise 结果转换为 Observable，顺序处理
    // 不同于 switchMap，concatMap 不会取消前一个
    concatMap((session) => {
      // 内存中的历史记录（用于上下文）
      const history: SessionMessageRecord[] = [];

      // ---- 会话开始阶段 ----
      // 持久化会话开始记录，发出 session_started 事件
      const start$ = defer(() =>
        from(params.sessionManager.appendRecord(session, createSessionStartRecord(session))),
      ).pipe(
        tap(() => {
          trace({
            sessionId: session.id,
            scope: "session",
            phase: "session.start",
            message: "session started",
            data: {
              mode: session.mode,
              provider: session.providerId,
            },
          });
        }),
        map(
          (): RuntimeEvent => ({
            type: "session_started",
            sessionId: session.id,
            sessionPath: session.path,
            mode: session.mode,
          }),
        ),
      );

      // ---- Turn 处理阶段 ----
      // 使用 concatMap 顺序处理每个用户输入
      const turns$ = params.input$.pipe(
        concatMap((turn) => {
          // 创建历史快照（用于传递给 Provider）
          const historySnapshot = [...history];
          const context = createTurnContext({
            sessionId: session.id,
            input: turn,
            cwd: params.cwd,
            history: historySnapshot,
            toolRegistry: params.toolRegistry,
            prompt: params.prompt,
          });

          // 创建用户记录
          const userRecord = createUserRecord(turn);

          // user$: 持久化用户输入，发出 user_turn 事件
          const user$ = from(params.sessionManager.appendRecord(session, userRecord)).pipe(
            tap(() => {
              history.push(userRecord);
              trace({
                sessionId: session.id,
                turn: turn.turn,
                step: 1,
                scope: "turn",
                phase: "turn.input",
                message: "user turn received",
                data: {
                  source: turn.source,
                },
              });
            }),
            map(
              (): RuntimeEvent => ({
                type: "user_turn",
                sessionId: session.id,
                turn: turn.turn,
                content: turn.content,
                source: turn.source,
              }),
            ),
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
          });

          // concat 确保先处理 user$，再处理 assistant$
          return concat(user$, assistant$);
        }),
      );

      // ---- 会话结束阶段 ----
      // 持久化会话结束记录，发出 session_ended 事件
      const end$ = defer(() =>
        from(params.sessionManager.appendRecord(session, createSessionEndRecord(session.id))),
      ).pipe(
        tap(() => {
          trace({
            sessionId: session.id,
            scope: "session",
            phase: "session.end",
            message: "session ended",
          });
        }),
        map(
          (): RuntimeEvent => ({
            type: "session_ended",
            sessionId: session.id,
          }),
        ),
      );

      // 使用 concat 顺序执行三个阶段
      // 这确保了：start$ → turns$ → end$ 的顺序
      return concat(start$, turns$, end$);
    }),
    // 错误处理：记录错误追踪
    tap({
      error: (error) => {
        trace({
          sessionId: "runtime",
          scope: "session",
          phase: "session.error",
          message: error instanceof Error ? error.message : String(error),
        });
      },
    }),
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
  };
}
