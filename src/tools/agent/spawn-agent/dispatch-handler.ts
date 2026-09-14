/**
 * spawn-agent/dispatch-handler.ts - spawn_agent 的 PreDispatchHook
 *
 * 本文件从 src/core/runtime/tool-dispatch.ts 抽离出来，作为 spawn_agent
 * 工具的 PreDispatchHook 实现：
 *
 * - 原 dispatch.ts 的 `handleSpawnAgent` 整体迁移到这里
 * - 包含权限检查（ask user）+ permission 记录 + 子 Agent 创建 + 事件转发
 * - 模块顶层注册到 preDispatchHooks 注册表
 *
 * 调用方：tool-dispatch.ts 在 dispatchToolCall 顶部查 getPreDispatchHook；
 * 命中即调 handleSpawnAgentDispatch（不再有 spawn_agent 字面在 dispatch 里）。
 *
 * ## 模块加载副作用
 *
 * 本文件 import 时立即调用 `registerPreDispatchHook('spawn_agent', ...)`，
 * 确保任何 import 到 spawn-agent（直接或间接 import index）的代码都能
 * 触发注册。这是 ESM 顶层副作用的标准用法。
 */

import { concat, concatMap, from, map, of, type Observable } from 'rxjs';

import {
  type PreDispatchHook,
  registerPreDispatchHook,
} from '@core/engine/pre-dispatch-hook.js';
import {
  agentScopePrefix,
  createPermissionRecord,
  createTimestamp,
  createToolResultRecord,
  requestPermissionConfirmation,
  resolveConfirmedDecision,
} from '@core/engine/dispatch-utils.js';

import { SPAWN_AGENT_RISK_LEVEL, spawnChildAgentForwarding$, type SpawnAgentContext } from './index.js';
import type { RuntimeEvent } from '@core/runtime/event-types.js';

/**
 * spawn_agent 的 PreDispatchHook 实现
 *
 * 行为：
 * - 无 provider 时返回 null，让 dispatch 走通用 path（被 tool-not-found 等保护）
 * - 权限检查（execute 风险等级 + ask user 询问）
 * - 决策非 allow：写 permission record + permission_decision 事件 + failed 事件
 * - 决策 allow：写 started 事件 + 调用 spawnChildAgentForwarding$
 *
 * @param params - dispatchToolCall 入参 + 预生成的 tool_call_requested 事件流
 * @returns RuntimeEvent 事件流接管 dispatch；null 表示不接管
 */
export const handleSpawnAgentDispatch: PreDispatchHook = (params) => {
  if (!params.provider) return null;
  // 局部变量保持类型窄化（嵌套回调中 params.provider 可能丢失）
  const provider = params.provider;

  // 权限检查（ask 决策通过 userInputBridge 询问用户确认）
  const rawDecision = params.permissionGate.evaluate(params.call, SPAWN_AGENT_RISK_LEVEL);

  const childName =
    typeof params.call.input?.name === 'string'
      ? `创建子 Agent: ${params.call.input.name}`
      : '创建子 Agent 执行任务';

  // 关键：若权限门决策为 ask 且有 userInputBridge，必须在等待前立即将 user_input_requested 事件发出到流中！
  const askRequested$ =
    rawDecision.decision === 'ask' && params.userInputBridge
      ? of<RuntimeEvent>({
          type: 'user_input_requested',
          sessionId: params.session.id,
          turn: params.turn,
          callId: params.call.id,
          question: `${agentScopePrefix(params.session)}是否允许执行 spawn_agent (${childName})?`,
          // spawn_agent 按设计不可"记住"（describeAllowPattern 显式排除），故只给 yes/no
          options: ['yes', 'no'],
          // 结构化上下文：让 UI 卡片直接拿到 toolName/input，不必从 question 正则反推
          toolName: params.call.toolName,
          input: { ...params.call.input },
        })
      : of<RuntimeEvent>();

  const confirmation$ = requestPermissionConfirmation(params, rawDecision);

  return concat(
    params.requested$,
    askRequested$,
    confirmation$.pipe(
      concatMap(({ allowed, askEvents }) => {
        const decision = resolveConfirmedDecision(rawDecision, allowed);

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
};

// ============================================================
// 模块加载副作用：注册到全局 preDispatchHooks
// ============================================================

// 单一注册点：模块只 import 一次，本语句只跑一次。
// 使用 Map.set 后注册覆盖前注册，所以重复 import 安全。
registerPreDispatchHook('spawn_agent', handleSpawnAgentDispatch);

void createTimestamp;
