/* eslint-disable @typescript-eslint/no-unused-vars */
import { TurnExecutor } from "./turn-executor.js";
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
  Observable,
  ReplaySubject,
  concat,
  concatMap,
  defer,
  from,
  map,
  tap,
} from 'rxjs';


import { type DebugTraceEvent } from '../runtime/debug-events.js';
import { Logger } from '@core/logger/index.js';
import { UserInputBridge } from './user-input-bridge.js';
import type { AgentProvider } from '@providers/provider-types.js';
import { ToolRegistry } from '@tools/core/tool-registry.js';
import type {
  ChatInputTurn,
  HistoryRecord,
  RuntimeEvent,
  RuntimeMode,
  } from '../runtime/event-types.js';
import type { PermissionGate } from './permission-gate.js';
import { SessionManager, type SessionMetadata } from '../session/session-manager.js';
import { createTurnContext } from '../runtime/turn-context.js';
import type { SkillExecutor } from '@core/skills/skill-executor.js';
import type { ProviderSettings, LoadedWastelandSettings } from '@config/settings-types.js';
import type { ProviderRegistry } from '@providers/provider-registry.js';
import { ContextManager, resolveContextWindow, estimateTokens } from '../memory/context-manager.js';
import {
  createInitialTurnState
} from './turn-state.js';
import {
  createTraceEmitter,
  type DebugTraceInput,
} from './turn-helpers.js';
import {
  createUserRecord,
  createSessionStartRecord,
  createSessionEndRecord,
} from '../session/session-records.js';

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
  /** 用户输入桥接器（非交互模式为 undefined：无人应答） */
  userInputBridge: UserInputBridge | undefined;
};

// ============================================================
// Turn 预检 helpers（runTurnLoop 内联逻辑外提，纯搬运）
// ============================================================

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
  /**
   * 可选：doom loop 检测阈值（连续同名同参工具调用次数），默认 3。
   * 0 表示关闭检测。
   */
  doomLoopThreshold?: number;
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
  /**
   * 可选：是否为交互模式（默认 true）。
   *
   * 为 false 时不自动创建 userInputBridge：非交互场景（`--message` / 管道）
   * 无人能应答，权限 ask 直接拒绝、ask-user 工具直接失败，避免无限挂起。
   */
  interactive?: boolean;
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
  // 统一 trace 入口：默认写入 Logger.info（FileSink 落盘），
  // 以便 TUI 中的 /logs 命令开箱即用。
  const trace = (event: DebugTraceInput): void => {
    baseTrace(event);
    Logger.info({
      sessionId: event.sessionId,
      turn: event.turn,
      step: event.step,
      scope: event.scope as Parameters<typeof Logger.info>[0]['scope'],
      message: event.phase
        ? `${event.phase}${event.message ? `: ${event.message}` : ''}`
        : (event.message ?? 'trace'),
      data: event.data,
    });
  };
  const maxStepsPerTurn = params.maxStepsPerTurn ?? 30;
  // doom loop 阈值兜底：未传时用 3（与 DEFAULT_WASTELAND_SETTINGS 一致）；
  // 显式传 0 表示关闭检测，不能用 ?? 把它吞掉。
  const doomLoopThreshold = params.doomLoopThreshold ?? 3;

  // 用户输入桥接器（用于 ask-user 工具与权限确认）。
  // 未提供时仅交互模式自动创建：非交互（`--message` / 管道）无人应答，
  // 传 undefined 让 ask 直接拒绝、ask-user 直接失败，而不是无限挂起。
  // 仅内部创建的实例在会话结束时由本循环销毁；
  // 复用外部传入的（如子 Agent 复用父 Agent 的 bridge）生命周期由所有者管理。
  const userInputBridge =
    params.userInputBridge ?? (params.interactive === false ? undefined : new UserInputBridge());
  const ownsUserInputBridge = userInputBridge !== undefined && !params.userInputBridge;

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
          const assistant$ = new TurnExecutor({
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
            doomLoopThreshold,
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
          }).execute();

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
        next: (event: RuntimeEvent) => subscriber.next(event),
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
