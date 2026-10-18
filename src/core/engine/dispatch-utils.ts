/**
 * dispatch-utils.ts - tool-dispatch 公共辅助函数
 *
 * 把 dispatch.ts 与 PreDispatchHook handler 共享的关注点抽出来：
 * - createTimestamp：统一 ISO 时间戳
 * - createToolCallRecord / createPermissionRecord / createToolResultRecord：
 *   把 RuntimeEvent 写入 session 的 record 三件套
 * - requestPermissionConfirmation：
 *   处理 ask 权限决策（通过 userInputBridge 询问用户）
 *
 * tool-dispatch.ts（通用 path）+ spawn-agent/dispatch-handler.ts（hook path）
 * 都从这里 import，避免重复实现。
 */

import { defer, of, type Observable } from 'rxjs';

import { t } from '@locales/index.js';
import type { ToolCall, ToolInput, ToolRunStatus } from '@tools/core/tool-types.js';
import {
  type ReasoningPayload,
  type RuntimeEvent,
  type SessionPermissionRecord,
  type SessionToolCallRecord,
  type SessionToolResultRecord,
} from '../runtime/event-types.js';
import type { PermissionDecision, PermissionGate } from './permission-gate.js';
import type { SessionMetadata } from '../session/session-manager.js';
import type { PendingInputContext } from './user-input-bridge.js';

/** ISO 时间戳生成器 */
export function createTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Agent 归属前缀（权限确认框 / ask-user 提问用）。
 *
 * 子 agent 会话带 childName（如 researcher），问询时拼 `[researcher] ` 前缀，
 * 让用户在 TUI 里分清是哪个 agent 在要权限；主会话返回空串，行为不变。
 */
export function agentScopePrefix(session: Pick<SessionMetadata, 'childName'>): string {
  return session.childName ? `[${session.childName}] ` : '';
}

/**
 * 权限问询的输入摘要（问句括号里的具体内容）。
 *
 * 无合适字段的工具退回单行 JSON（截断 160 字符），保证任何工具被问时
 * 用户都能看到它想拿什么，而不是光秃秃的工具名。
 */
export function summarizeInputDetail(input: ToolInput | undefined): string {
  if (!input || typeof input !== 'object') return '';
  if (Object.keys(input).length === 0) return '';
  try {
    const single = JSON.stringify(input).replace(/\s+/g, ' ');
    return ` (${single.length > 160 ? `${single.slice(0, 157)}...` : single})`;
  } catch {
    return '';
  }
}

/** 构造 tool_call record（写 session） */
export function createToolCallRecord(
  session: SessionMetadata,
  turn: number,
  call: ToolCall,
  reasoning?: ReasoningPayload
): SessionToolCallRecord {
  return {
    type: 'tool_call',
    sessionId: session.id,
    turn,
    callId: call.id,
    toolName: call.toolName,
    input: call.input,
    timestamp: createTimestamp(),
    // reasoning 缺失时不写该 key（旧记录逐字节一致）；有则原样透传（R-3 范围扩展）。
    ...(reasoning ? { reasoning } : {}),
  };
}

/** 构造 permission record（写 session） */
export function createPermissionRecord(params: {
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

/** 构造 tool_result record（写 session） */
export function createToolResultRecord(params: {
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

/**
 * 把「用户是否放行」落成最终权限决策。
 *
 * 关键点：授权门返回 'ask' 时，用户答 yes/always **必须**转成 'allow'。
 * 下游统一用 `decision.decision !== 'allow'` 判定是否执行，若把 'ask' 原样透传，
 * 用户明明同意了工具却仍被拦下（历史 bug：ask → 确认通过 → blocked）。
 *
 * 非 ask 决策原样返回，保留规则命中的 reason（如 permissionRuleHit），
 * 避免覆盖掉「为什么直接放行」的解释。
 */
export function resolveConfirmedDecision(
  rawDecision: PermissionDecision,
  allowed: boolean,
  hasUserInputBridge = true
): PermissionDecision {
  if (!allowed) {
    const suffix = hasUserInputBridge ? '（用户拒绝）' : '（非交互无头环境自动阻断）';
    return {
      ...rawDecision,
      decision: 'deny',
      // 仅当原始决策是 ask 时才标注用户拒绝 / 非交互无头环境自动阻断；
      // 规则本就 deny 的保持原文，避免出现「规则拒绝（用户拒绝）」这种双重归因。
      reason:
        rawDecision.decision === 'ask'
          ? `${rawDecision.reason}${suffix}`
          : rawDecision.reason,
    };
  }
  if (rawDecision.decision === 'ask') {
    return {
      ...rawDecision,
      decision: 'allow',
      reason: '用户已确认允许本次工具调用。',
    };
  }
  return rawDecision;
}

/**
 * 处理 ask 权限决策：通过 userInputBridge 询问用户确认
 *
 * 复用 ask-user 的输入通路。无 userInputBridge（非交互环境）时降级为 deny，
 * 避免默认模式下 write/execute 工具被静默阻断。
 *
 * @param params - dispatch 参数（含 userInputBridge）
 * @param rawDecision - 权限门原始决策
 * @returns 最终是否允许，以及询问过程产生的事件（供外层拼接）
 */
export function requestPermissionConfirmation(
  params: {
    session: SessionMetadata;
    turn: number;
    call: ToolCall;
    userInputBridge?: {
      requestInput(context?: PendingInputContext): Promise<string>;
    };
  },
  rawDecision: ReturnType<PermissionGate['evaluate']>
): Observable<{ allowed: boolean; askEvents: RuntimeEvent[] }> {
  if (rawDecision.decision !== 'ask') {
    return of({ allowed: rawDecision.decision === 'allow', askEvents: [] });
  }
  if (!params.userInputBridge) {
    return of({ allowed: false, askEvents: [] });
  }
  return defer(async () => {
    const answer = (await params.userInputBridge?.requestInput({
      callId: params.call.id,
      toolName: params.call.toolName,
      input: params.call.input,
    })) ?? '';
    const receivedEvent: RuntimeEvent = {
      type: 'user_input_received',
      sessionId: params.session.id,
      turn: params.turn,
      callId: params.call.id,
      answer,
    };
    // 'always' 由 UI 侧先注册 session 规则（见 ChatInputBar/CliInputAdapter），
    // 此处同样放行本次；规则注册本身不经过 answer 字符串。
    const allowed = /^(y|yes|是|always)$/i.test(answer.trim());
    return { allowed, askEvents: [receivedEvent] as RuntimeEvent[] };
  });
}

/* ts-unused-suppress 占位，避免 'not used' 警告影响 import */
void t;
