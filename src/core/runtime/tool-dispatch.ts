import { concat, concatMap, defer, from, map, of, type Observable } from 'rxjs';

import { t } from '@locales/index.js';

import { executeToolCall } from '@tools/tool-runner.js';
import { ToolRegistry } from '@tools/tool-registry.js';
import type { ToolCall, ToolRunStatus } from '@tools/tool-types.js';
import { createLogEvents, Logger } from '@core/logger/index.js';
import { type RuntimeEvent, type HistoryRecord } from './event-types.js';
import { checkReadBeforeEdit } from './file-audit.js';
import type { PermissionGate } from './permission-gate.js';
import { SessionManager, type SessionMetadata } from './session-manager.js';
import type { TurnState } from './turn-state.js';
import { getPreDispatchHook } from './pre-dispatch-hook.js';
import {
  createPermissionRecord,
  createToolCallRecord,
  createToolResultRecord,
  requestPermissionConfirmation,
} from './dispatch-utils.js';
import type { AgentProvider } from '@providers/provider-types.js';
import type { ProviderSettings, LoadedWastelandSettings } from '@config/settings-types.js';
import type { ProviderRegistry } from '@providers/provider-registry.js';
import type { UserInputBridge } from './user-input-bridge.js';

// ============================================================
// Special Tool Handlers（ask-user 等内部特殊处理）
// ============================================================

/**
 * 内部 SpecialToolHandler 类型
 *
 * 只用于框架内保留的特殊 tool（如 ask-user）；spawn_agent 等已迁移到
 * PreDispatchHook 注册表（见 ./pre-dispatch-hook.ts）。
 */
type SpecialToolHandler = (
  params: DispatchToolCallParams,
  requested$: Observable<RuntimeEvent>
) => Observable<RuntimeEvent> | null;

/** dispatchToolCall 参数类型（供 SpecialToolHandler 使用） */
type DispatchToolCallParams = Parameters<typeof dispatchToolCall>[0];

/**
 * ask-user 特殊处理器（保留在 dispatch.ts）
 *
 * 处理用户输入请求，暂停 agent loop 等待用户响应。
 * 发出 user_input_requested/user_input_received 生命周期事件。
 */
function handleAskUser(params: DispatchToolCallParams, requested$: Observable<RuntimeEvent>): Observable<RuntimeEvent> | null {
  if (!params.userInputBridge) return null;

  const input = params.call.input as { question: string; options?: string[] };

  // 权限检查（ask-user 是只读工具，自动允许）
  const decision = params.permissionGate.evaluate(params.call, 'read');

  const permission$ = from(
    params.sessionManager.appendRecord(
      params.session,
      createPermissionRecord({
        session: params.session,
        turn: params.turn,
        call: params.call,
        decision,
      })
    )
  ).pipe(
    map(
      (): RuntimeEvent => ({
        type: 'permission_decision',
        sessionId: params.session.id,
        turn: params.turn,
        callId: params.call.id,
        toolName: params.call.toolName,
        decision: decision.decision,
        mode: decision.mode,
        reason: decision.reason,
      })
    )
  );

  if (decision.decision !== 'allow') {
    const blockedStatus = decision.decision === 'deny' ? 'error' : 'blocked';
    const failedRecord = createToolResultRecord({
      session: params.session,
      turn: params.turn,
      call: params.call,
      status: blockedStatus,
      error: decision.reason,
    });

    const failed$ = from(params.sessionManager.appendRecord(params.session, failedRecord)).pipe(
      map(
        (): RuntimeEvent => ({
          type: 'tool_failed',
          sessionId: params.session.id,
          turn: params.turn,
          callId: params.call.id,
          toolName: params.call.toolName,
          status: blockedStatus,
          error: decision.reason,
        })
      )
    );

    return concat(requested$, permission$, failed$);
  }

  const started$ = of<RuntimeEvent>({
    type: 'tool_started',
    sessionId: params.session.id,
    turn: params.turn,
    callId: params.call.id,
    toolName: params.call.toolName,
  });

  // 关键：必须立即发出 user_input_requested 事件，让 UI 立即呈现提问，再进入 await 等待
  const requestedEvent: RuntimeEvent = {
    type: 'user_input_requested',
    sessionId: params.session.id,
    turn: params.turn,
    callId: params.call.id,
    question: input.question,
    options: input.options,
  };
  const askRequested$ = of(requestedEvent);

  // 等待用户输入并记录结果
  const result$ = defer(async () => {
    // 等待用户输入
    const answer = await params.userInputBridge?.requestInput() ?? '';

    // 发出响应事件
    const receivedEvent: RuntimeEvent = {
      type: 'user_input_received',
      sessionId: params.session.id,
      turn: params.turn,
      callId: params.call.id,
      answer,
    };

    return { receivedEvent, answer };
  }).pipe(
    concatMap(({ receivedEvent, answer }) => {
      // 记录工具结果
      const resultRecord = createToolResultRecord({
        session: params.session,
        turn: params.turn,
        call: params.call,
        status: 'success',
        output: answer,
      });

      return from(params.sessionManager.appendRecord(params.session, resultRecord)).pipe(
        map(
          (): RuntimeEvent => ({
            type: 'tool_result',
            sessionId: params.session.id,
            turn: params.turn,
            callId: params.call.id,
            toolName: params.call.toolName,
            status: 'success',
            output: answer,
          })
        ),
        map((toolEvent) => [receivedEvent, toolEvent] as RuntimeEvent[])
      );
    }),
    concatMap((events) => from(events))
  );

  return concat(requested$, permission$, started$, askRequested$, result$);
}

/**
 * 框架内保留的特殊工具处理器注册表
 *
 * 注：spawn_agent 已迁移到 PreDispatchHook（见 ./pre-dispatch-hook.ts）。
 * 当前仅 ask-user 在此 Map；未来如需新增框架内特殊 tool，在此处追加。
 */
const internalSpecialHandlers = new Map<string, SpecialToolHandler>([
  ['ask-user', handleAskUser],
]);

// ============================================================
// dispatchToolCall 主入口
// ============================================================

export function dispatchToolCall(params: {
  session: SessionMetadata;
  sessionManager: SessionManager;
  turn: number;
  call: ToolCall;
  registry: ToolRegistry;
  permissionGate: PermissionGate;
  cwd: string;
  turnState: TurnState;
  /** 多 Agent 支持：Provider 实例 */
  provider?: AgentProvider;
  /** 多 Agent 支持：历史消息 */
  history?: HistoryRecord[];
  /** 多 Agent 支持：Provider 注册表（用于模型选择） */
  providerRegistry?: ProviderRegistry;
  /** 多 Agent 支持：Provider 配置（用于模型选择） */
  providerSettings?: ProviderSettings;
  /** 可选：完整 loadedSettings，用于 spawn-agent 读 multiAgent[name] 配置（重试参数） */
  loadedSettings?: LoadedWastelandSettings;
  /** 子 Agent 执行超时（毫秒） */
  childAgentTimeout?: number;
  /** 用户输入桥接器（用于 ask-user 工具） */
  userInputBridge?: UserInputBridge;
  /** 当前 spawn 嵌套深度（用于限制递归 spawn） */
  spawnDepth?: number;
}): Observable<RuntimeEvent> {
  // ---- 5 段时间分解（PRD R18 / AC16）----
  // preHook 起点 = dispatchToolCall 入口；permission 起点 = evaluate() 前；
  // tool 起点 = defer(() => executeToolCall) 触发；postHook 起点 = tool 完成。
  // 这些变量被 defer 回调内部引用，依靠 closure 保持状态。
  const preHookStartMs = Date.now();
  let permissionStartMs = 0;
  let toolStartMs = 0;
  // 结构化工具生命周期日志（tool_start / tool_end / tool_error），
  // 供 LogsPage 时间线视图聚合。走 info/error 级 → 默认过滤即可落盘。
  const toolLogEvents = createLogEvents(
    Logger.child({ sessionId: params.session.id, turn: params.turn, scope: 'tool' })
  );
  // ---- read-before-edit 检查 ----
  // 对于 edit-file 和 write-file，检查是否已读取过目标文件
  const filePath = params.call.input.path;
  if (typeof filePath === 'string') {
    const check = checkReadBeforeEdit({
      toolName: params.call.toolName,
      filePath,
      turnState: params.turnState,
      sessionId: params.session.id,
      turn: params.turn,
    });

    if (!check.ok) {
      // 检查未通过，返回错误
      const failedRecord = createToolResultRecord({
        session: params.session,
        turn: params.turn,
        call: params.call,
        status: 'error',
        error: check.error,
      });

      const failed$ = from(params.sessionManager.appendRecord(params.session, failedRecord)).pipe(
        map(
          (): RuntimeEvent => ({
            type: 'tool_failed',
            sessionId: params.session.id,
            turn: params.turn,
            callId: params.call.id,
            toolName: params.call.toolName,
            status: 'error',
            error: check.error ?? t('runtime.readBeforeEdit'),
          })
        )
      );

      return failed$;
    }
  }

  const requested$ = from(
    params.sessionManager.appendRecord(
      params.session,
      createToolCallRecord(params.session, params.turn, params.call)
    )
  ).pipe(
    map(
      (): RuntimeEvent => ({
        type: 'tool_call_requested',
        sessionId: params.session.id,
        turn: params.turn,
        callId: params.call.id,
        toolName: params.call.toolName,
        input: params.call.input,
      })
    )
  );

  const tool = params.registry.get(params.call.toolName);

  // ---- PreDispatchHook 接管（如 spawn_agent、ask-user 等） ----
  // 通过 preDispatchHooks 注册表通用查询；不再有具体工具名字面在 dispatch 里。
  const preDispatchHook = getPreDispatchHook(params.call.toolName);
  if (preDispatchHook) {
    const result = preDispatchHook({
      ...params,
      requested$,
    });
    if (result) return result;
  }

  // ---- 框架内部保留的特殊处理（如 ask-user，未来可逐步迁移到 hook） ----
  const internalHandler = internalSpecialHandlers.get(params.call.toolName);
  if (internalHandler) {
    const result = internalHandler(params, requested$);
    if (result) return result;
  }

  if (!tool) {
    const failedRecord = createToolResultRecord({
      session: params.session,
      turn: params.turn,
      call: params.call,
      status: 'error',
      error: `${t('runtime.toolNotFound')} ${params.call.toolName}`,
    });

    const failed$ = from(params.sessionManager.appendRecord(params.session, failedRecord)).pipe(
      map(
        (): RuntimeEvent => ({
          type: 'tool_failed',
          sessionId: params.session.id,
          turn: params.turn,
          callId: params.call.id,
          toolName: params.call.toolName,
          status: 'error',
          error: failedRecord.error ?? t('runtime.toolFailed'),
        })
      )
    );

    return concat(requested$, failed$);
  }

  permissionStartMs = Date.now();
  // 动态评估工具风险等级：针对 git 只读子命令（status/diff/log）按 read 级别放行
  let effectiveRiskLevel = tool.riskLevel;
  if (tool.name === 'git' && ['status', 'diff', 'log'].includes(String(params.call.input?.subcommand))) {
    effectiveRiskLevel = 'read';
  }
  const rawDecision = params.permissionGate.evaluate(params.call, effectiveRiskLevel);
  // permission gate 已 evaluate 完成 → 标记 permission 段结束
  const permissionEndMs = Date.now();

  // 关键：若权限门决策为 ask 且有 userInputBridge，必须在等待前立即将 user_input_requested 事件发出到流中！
  const askRequested$ =
    rawDecision.decision === 'ask' && params.userInputBridge
      ? of<RuntimeEvent>({
          type: 'user_input_requested',
          sessionId: params.session.id,
          turn: params.turn,
          callId: params.call.id,
          question: params.call.input?.command
            ? `是否允许执行 ${params.call.toolName} (${params.call.input.command})?`
            : params.call.input?.path
              ? `是否允许执行 ${params.call.toolName} (${params.call.input.path})?`
              : params.call.input?.subcommand
                ? `是否允许执行 git ${params.call.input.subcommand}?`
                : `是否允许执行 ${params.call.toolName}?`,
          options: ['yes', 'always', 'no'],
          // 结构化上下文：UI 推导 once/always 模式用，不再依赖 question 正则
          toolName: params.call.toolName,
          input: { ...params.call.input },
        })
      : of<RuntimeEvent>();

  const confirmation$ = requestPermissionConfirmation(params, rawDecision);

  return concat(
    requested$,
    askRequested$,
    confirmation$.pipe(
      concatMap(({ allowed, askEvents }) => {
        const decision: typeof rawDecision = allowed
          ? rawDecision
          : {
              ...rawDecision,
              decision: 'deny' as const,
              reason:
                rawDecision.decision === 'ask'
                  ? `${rawDecision.reason}（用户拒绝）`
                  : rawDecision.reason,
            };

        const permission$ = from(
          params.sessionManager.appendRecord(
            params.session,
            createPermissionRecord({
              session: params.session,
              turn: params.turn,
              call: params.call,
              decision,
            })
          )
        ).pipe(
          map(
            (): RuntimeEvent => ({
              type: 'permission_decision',
              sessionId: params.session.id,
              turn: params.turn,
              callId: params.call.id,
              toolName: params.call.toolName,
              decision: decision.decision,
              mode: decision.mode,
              reason: decision.reason,
            })
          )
        );

        if (decision.decision !== 'allow') {
          const blockedStatus = decision.decision === 'deny' ? 'error' : 'blocked';
          const failedRecord = createToolResultRecord({
            session: params.session,
            turn: params.turn,
            call: params.call,
            status: blockedStatus,
            error: decision.reason,
          });

          const failed$ = from(
            params.sessionManager.appendRecord(params.session, failedRecord)
          ).pipe(
            map(
              (): RuntimeEvent => ({
                type: 'tool_failed',
                sessionId: params.session.id,
                turn: params.turn,
                callId: params.call.id,
                toolName: params.call.toolName,
                status: blockedStatus,
                error: decision.reason,
              })
            )
          );

          return concat(from(askEvents), permission$, failed$);
        }

        const started$ = of<RuntimeEvent>({
          type: 'tool_started',
          sessionId: params.session.id,
          turn: params.turn,
          callId: params.call.id,
          toolName: params.call.toolName,
        });

        const result$ = defer(() => {
          // tool 段起点：defer factory 触发时记录（permission 已结束）
          toolStartMs = Date.now();
          // 结构化生命周期事件：tool_start（LogsPage 时间线聚合用）
          toolLogEvents.tool.toolStart({ toolName: params.call.toolName });
          return executeToolCall({
            registry: params.registry,
            call: params.call,
            context: {
              sessionId: params.session.id,
              turn: params.turn,
              cwd: params.cwd,
            },
          });
        }).pipe(
          concatMap((result) => {
            // 5 段时间分解（PRD R18 / AC16）：
            // preHookMs   = preHookStartMs → permissionStartMs
            // permissionMs = permissionStartMs → permissionEndMs（evaluate 同步前后）
            // toolMs      = toolStartMs → toolEndMs
            // postHookMs  = toolEndMs → Date.now()
            // totalMs     = preHookStartMs → Date.now()
            const toolEndMs = Date.now();
            const timings = {
              preHookMs: preHookStartMs > 0 ? permissionStartMs - preHookStartMs : 0,
              permissionMs: toolStartMs > 0 ? permissionEndMs - permissionStartMs : 0,
              toolMs: toolStartMs > 0 ? toolEndMs - toolStartMs : 0,
              postHookMs: Date.now() - toolEndMs,
              totalMs: Date.now() - preHookStartMs,
            };
            emitToolTimings(params, result.status, timings);
            // 结构化生命周期事件：tool_end / tool_error（LogsPage 时间线聚合用）
            if (result.status === 'success') {
              toolLogEvents.tool.toolEnd({
                toolName: params.call.toolName,
                durationMs: timings.totalMs,
              });
            } else {
              toolLogEvents.tool.toolError({
                toolName: params.call.toolName,
                durationMs: timings.totalMs,
                error: { name: 'ToolError', message: result.error },
              });
            }

            if (result.status === 'success') {
              const resultRecord = createToolResultRecord({
                session: params.session,
                turn: params.turn,
                call: params.call,
                status: 'success',
                output: result.output,
              });

              return from(
                params.sessionManager.appendRecord(params.session, resultRecord)
              ).pipe(
                map(
                  (): RuntimeEvent => ({
                    type: 'tool_result',
                    sessionId: params.session.id,
                    turn: params.turn,
                    callId: params.call.id,
                    toolName: params.call.toolName,
                    status: 'success',
                    output: result.output,
                  })
                )
              );
            }

            const failedRecord = createToolResultRecord({
              session: params.session,
              turn: params.turn,
              call: params.call,
              status: 'error',
              error: result.error,
            });

            return from(
              params.sessionManager.appendRecord(params.session, failedRecord)
            ).pipe(
              map(
                (): RuntimeEvent => ({
                  type: 'tool_failed',
                  sessionId: params.session.id,
                  turn: params.turn,
                  callId: params.call.id,
                  toolName: params.call.toolName,
                  status: 'error',
                  error: result.error,
                })
              )
            );
          })
        );

        return concat(from(askEvents), permission$, started$, result$);
      })
    )
  );
}

// ============================================================
// 内部：timings emit
// ============================================================

/**
 * 把一次 dispatch 的 5 段时间分解落到 Logger.debug。
 *
 * 仅作可观测性副作用；不影响主流程与 dispatch 返回的事件序列。
 * 走 new Logger（PR3 logger 体系），与现有 debug$ 流兼容。
 */
function emitToolTimings(
  params: Parameters<typeof dispatchToolCall>[0],
  status: ToolRunStatus,
  timings: {
    preHookMs: number;
    permissionMs: number;
    toolMs: number;
    postHookMs: number;
    totalMs: number;
  },
): void {
  Logger.debug({
    sessionId: params.session.id,
    turn: params.turn,
    scope: 'tool',
    message: 'tool.dispatch.completed',
    data: {
      kind: 'tool_dispatch_completed',
      callId: params.call.id,
      toolName: params.call.toolName,
      status,
      timings,
    },
  });
}
