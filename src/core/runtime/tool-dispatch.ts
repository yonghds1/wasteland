import { concat, concatMap, defer, from, map, of, type Observable } from 'rxjs';

import { t } from '../../locales/index.js';

import { executeToolCall } from '../../tools/tool-runner.js';
import { ToolRegistry } from '../../tools/tool-registry.js';
import type { ToolCall, ToolRunStatus } from '../../tools/tool-types.js';
import {
  type RuntimeEvent,
  type SessionPermissionRecord,
  type SessionToolCallRecord,
  type SessionToolResultRecord,
} from './event-types.js';
import { checkReadBeforeEdit } from './file-audit.js';
import type { PermissionGate } from './permission-gate.js';
import { SessionManager, type SessionMetadata } from './session-manager.js';
import type { TurnState } from './turn-state.js';
import {
  spawnChildAgentForwarding$,
  SPAWN_AGENT_RISK_LEVEL,
  type SpawnAgentContext,
} from '../../tools/spawn-agent.js';
import type { AgentProvider } from '../../providers/provider-types.js';
import type { SessionMessageRecord } from './event-types.js';
import type { ProviderSettings, LoadedWastelandSettings } from '../../config/settings-types.js';
import type { ProviderRegistry } from '../../providers/provider-registry.js';
import type { UserInputBridge } from './user-input-bridge.js';

// ============================================================
// Special Tool Handlers
// ============================================================

/**
 * 特殊工具处理器类型
 *
 * 某些工具需要额外的上下文（如 Provider、Registry 等），
 * 无法通过标准的 executeToolCall 路径执行。
 * 这些工具通过 SpecialToolHandler 注册，在 dispatchToolCall 中优先处理。
 */
type SpecialToolHandler = (
  params: DispatchToolCallParams,
  requested$: Observable<RuntimeEvent>
) => Observable<RuntimeEvent> | null;

/** dispatchToolCall 参数类型（供 SpecialToolHandler 使用） */
type DispatchToolCallParams = Parameters<typeof dispatchToolCall>[0];

function createTimestamp(): string {
  return new Date().toISOString();
}

function createToolCallRecord(
  session: SessionMetadata,
  turn: number,
  call: ToolCall
): SessionToolCallRecord {
  return {
    type: 'tool_call',
    sessionId: session.id,
    turn,
    callId: call.id,
    toolName: call.toolName,
    input: call.input,
    timestamp: createTimestamp(),
  };
}

function createPermissionRecord(params: {
  session: SessionMetadata;
  turn: number;
  call: ToolCall;
  decision: ReturnType<PermissionGate['evaluate']>;
}): SessionPermissionRecord {
  return {
    type: 'permission',
    sessionId: params.session.id,
    turn: params.turn,
    callId: params.call.id,
    toolName: params.call.toolName,
    decision: params.decision.decision,
    mode: params.decision.mode,
    reason: params.decision.reason,
    timestamp: createTimestamp(),
  };
}

function createToolResultRecord(params: {
  session: SessionMetadata;
  turn: number;
  call: ToolCall;
  status: ToolRunStatus;
  output?: string;
  error?: string;
}): SessionToolResultRecord {
  return {
    type: 'tool_result',
    sessionId: params.session.id,
    turn: params.turn,
    callId: params.call.id,
    toolName: params.call.toolName,
    status: params.status,
    output: params.output,
    error: params.error,
    timestamp: createTimestamp(),
  };
}

// ============================================================
// Special Tool Handlers
// ============================================================

/**
 * 处理 ask 权限决策：通过 userInputBridge 询问用户确认
 *
 * 复用 ask-user 的输入通路。无 userInputBridge（非交互环境）时降级为 deny，
 * 避免默认模式下 write/execute 工具被静默阻断。
 *
 * @param params - dispatch 参数
 * @param rawDecision - 权限门原始决策
 * @returns 最终是否允许，以及询问过程产生的事件（供外层拼接）
 */
function requestPermissionConfirmation(
  params: DispatchToolCallParams,
  rawDecision: ReturnType<PermissionGate['evaluate']>
): Observable<{ allowed: boolean; askEvents: RuntimeEvent[] }> {
  if (rawDecision.decision !== 'ask') {
    return of({ allowed: rawDecision.decision === 'allow', askEvents: [] });
  }
  if (!params.userInputBridge) {
    return of({ allowed: false, askEvents: [] });
  }
  return defer(async () => {
    const requestedEvent: RuntimeEvent = {
      type: 'user_input_requested',
      sessionId: params.session.id,
      turn: params.turn,
      callId: params.call.id,
      question: `是否允许执行 ${params.call.toolName}? (yes/no)`,
      options: ['yes', 'no'],
    };
    const answer = await params.userInputBridge!.requestInput();
    const receivedEvent: RuntimeEvent = {
      type: 'user_input_received',
      sessionId: params.session.id,
      turn: params.turn,
      callId: params.call.id,
      answer,
    };
    const allowed = /^(y|yes|是)$/i.test(answer.trim());
    return { allowed, askEvents: [requestedEvent, receivedEvent] as RuntimeEvent[] };
  });
}

/**
 * spawn_agent 特殊处理器
 *
 * 处理子 Agent 创建，需要 Provider、Registry 等额外上下文。
 * 发出 agent_spawned/agent_completed 生命周期事件。
 */
function handleSpawnAgent(params: DispatchToolCallParams, requested$: Observable<RuntimeEvent>): Observable<RuntimeEvent> | null {
  if (!params.provider) return null;
  // 局部变量保持类型窄化（嵌套回调中 params.provider 可能丢失）
  const provider = params.provider;

  // 权限检查（ask 决策通过 userInputBridge 询问用户确认）
  const rawDecision = params.permissionGate.evaluate(params.call, SPAWN_AGENT_RISK_LEVEL);
  const confirmation$ = requestPermissionConfirmation(params, rawDecision);

  return concat(
    requested$,
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

          return concat(from(askEvents), permission$, failed$) as Observable<RuntimeEvent>;
        }

        const started$: Observable<RuntimeEvent> = of({
          type: 'tool_started',
          sessionId: params.session.id,
          turn: params.turn,
          callId: params.call.id,
          toolName: params.call.toolName,
        });

        // 调用 spawnChildAgentForwarding$ 启动子 Agent 并实时转发中间事件
        // （agent_spawned / agent_thinking / agent_tool_use / agent_completed / tool_result）
        const context: SpawnAgentContext = {
          sessionId: params.session.id,
          turn: params.turn,
          cwd: params.cwd,
          session: params.session,
          sessionManager: params.sessionManager,
          provider,
          toolRegistry: params.registry,
          permissionGate: params.permissionGate,
          history: params.history ?? [],
          providerRegistry: params.providerRegistry,
          providerSettings: params.providerSettings,
          childAgentTimeout: params.childAgentTimeout,
          depth: params.spawnDepth ?? 0,
          userInputBridge: params.userInputBridge,
          loadedSettings: params.loadedSettings,
        };

        const spawn$ = spawnChildAgentForwarding$({
          context,
          call: params.call,
        });

        return concat(from(askEvents), permission$, started$, spawn$) as Observable<RuntimeEvent>;
      })
    )
  );
}

/**
 * ask-user 特殊处理器
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

  // 发出 user_input_requested 事件，然后等待用户输入
  const result$ = defer(async () => {
    // 发出请求事件
    const requestedEvent: RuntimeEvent = {
      type: 'user_input_requested',
      sessionId: params.session.id,
      turn: params.turn,
      callId: params.call.id,
      question: input.question,
      options: input.options,
    };

    // 等待用户输入
    const answer = await params.userInputBridge!.requestInput();

    // 发出响应事件
    const receivedEvent: RuntimeEvent = {
      type: 'user_input_received',
      sessionId: params.session.id,
      turn: params.turn,
      callId: params.call.id,
      answer,
    };

    return { requestedEvent, receivedEvent, answer };
  }).pipe(
    concatMap(({ requestedEvent, receivedEvent, answer }) => {
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
        map((toolEvent) => [requestedEvent, receivedEvent, toolEvent] as RuntimeEvent[])
      );
    }),
    concatMap((events) => from(events))
  );

  return concat(requested$, permission$, started$, result$);
}

/**
 * 特殊工具处理器注册表
 *
 * 将工具名称映射到其处理器函数。
 * dispatchToolCall 会优先检查此注册表，再回退到标准工具执行路径。
 */
const specialToolHandlers = new Map<string, SpecialToolHandler>([
  ['spawn_agent', handleSpawnAgent],
  ['ask-user', handleAskUser],
]);

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
  history?: SessionMessageRecord[];
  /** 多 Agent 支持：Provider 注册表（用于模型选择） */
  providerRegistry?: ProviderRegistry;
  /** 多 Agent 支持：Provider 配置（用于模型选择） */
  providerSettings?: ProviderSettings;
  /** 可选：完整 loadedSettings，用于 spawn-agent 读 subAgents[name] 配置（重试参数） */
  loadedSettings?: LoadedWastelandSettings;
  /** 子 Agent 执行超时（毫秒） */
  childAgentTimeout?: number;
  /** 用户输入桥接器（用于 ask-user 工具） */
  userInputBridge?: UserInputBridge;
  /** 当前 spawn 嵌套深度（用于限制递归 spawn） */
  spawnDepth?: number;
}): Observable<RuntimeEvent> {
  // ---- read-before-edit 检查 ----
  // 对于 edit-file 和 write-file，检查是否已读取过目标文件
  const filePath = params.call.input.path;
  if (typeof filePath === 'string') {
    const check = checkReadBeforeEdit({
      toolName: params.call.toolName,
      filePath,
      turnState: params.turnState,
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

  // ---- 特殊工具处理 ----
  // 检查是否有注册的特殊处理器（如 spawn_agent）
  const specialHandler = specialToolHandlers.get(params.call.toolName);
  if (specialHandler) {
    const result = specialHandler(params, requested$);
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

  const rawDecision = params.permissionGate.evaluate(params.call, tool.riskLevel);
  const confirmation$ = requestPermissionConfirmation(params, rawDecision);

  return concat(
    requested$,
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

        const result$ = defer(() =>
          executeToolCall({
            registry: params.registry,
            call: params.call,
            context: {
              sessionId: params.session.id,
              turn: params.turn,
              cwd: params.cwd,
            },
          })
        ).pipe(
          concatMap((result) => {
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
