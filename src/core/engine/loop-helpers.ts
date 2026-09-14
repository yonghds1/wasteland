import { EMPTY, of, type Observable } from 'rxjs';
import { tap } from 'rxjs';
import type { SkillExecutor } from '@core/skills/skill-executor.js';
import type { ToolRegistry } from '@tools/core/tool-registry.js';
import type { ToolCall } from '@tools/core/tool-types.js';
import type { PermissionGate } from './permission-gate.js';
import type { AgentProvider } from '@providers/provider-types.js';
import { type SessionMetadata, type SessionManager } from '../session/session-manager.js';
import type { HistoryRecord, RuntimeEvent, SessionMessageRecord } from '../runtime/event-types.js';
import { type DebugTraceInput, buildDoomLoopMessage, buildMaxStepsMessage } from './turn-helpers.js';
import type { TurnState } from './turn-state.js';
import { failTurnState } from './turn-state.js';
import type { ContextManager } from '../memory/context-manager.js';
import { persistAssistantMessage } from '../session/session-records.js';
import { maybeCompactContext, persistCompactionRecord } from '../memory/context-compaction.js';
export function routeSkillCommand(params: {
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
export function checkMaxStepsExceeded(params: {
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
 * 稳定序列化：对对象按键名递归排序后再序列化。
 *
 * 工具参数来自模型，键序不保证稳定（`{a:1,b:2}` 与 `{b:2,a:1}` 语义相同）。
 * 裸用 `JSON.stringify` 会因键序不同把同一调用判成不同调用，从而漏判死循环。
 *
 * @param value - 任意 JSON 值
 * @returns 键序无关的字符串表示
 */
function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'undefined';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    // JSON.stringify 会丢弃 undefined 值字段，这里对齐同一语义
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`)
    .join(',')}}`;
}

/**
 * doom loop 判据（纯函数，无副作用，可直接单测）。
 *
 * 判定尾部是否出现「连续 threshold 次同名且同参」的工具调用：
 * - 只在本 turn 的累积调用序列上判断，任何一次不同调用都会打断连续段。
 * - 参数比较为键序无关的稳定序列化，避免键序不同漏判。
 * - threshold <= 0 表示关闭检测（与多 Agent maxRetries 的 0=关闭约定一致）。
 *
 * @param toolCalls - 本 turn 内按时间顺序累积的工具调用
 * @param threshold - 连续重复触发阈值
 * @returns 命中死循环返回 true
 */
export function isDoomLoop(toolCalls: readonly ToolCall[], threshold: number): boolean {
  if (threshold <= 0) return false;
  if (toolCalls.length < threshold) return false;

  const recent = toolCalls.slice(toolCalls.length - threshold);
  const first = recent[0];
  const firstArgs = stableSerialize(first.input);
  return recent.every(
    (call) => call.toolName === first.toolName && stableSerialize(call.input) === firstArgs
  );
}

/**
 * doom loop 守卫：模型连续重复调用同名同参工具达到阈值时，
 * 短路本轮并持久化一条说明消息（与 checkMaxStepsExceeded 同形状）。
 *
 * 未命中或检测已关闭（threshold <= 0）返回 null。
 *
 * @param params.state - 当前 turn 状态（含已累积的 toolCalls）
 * @param params.doomLoopThreshold - 连续重复阈值，0 表示关闭检测
 * @returns 接管本轮的事件流；放行时返回 null
 */
export function checkDoomLoop(params: {
  state: TurnState;
  doomLoopThreshold: number;
  session: SessionMetadata;
  sessionManager: SessionManager;
  history: HistoryRecord[];
  contextManager: ContextManager;
  trace: (event: DebugTraceInput) => void;
}): Observable<RuntimeEvent> | null {
  if (!isDoomLoop(params.state.toolCalls, params.doomLoopThreshold)) {
    return null;
  }

  const exhausted = params.state.toolCalls[params.state.toolCalls.length - 1];
  const loopedState = failTurnState(params.state);
  const message = buildDoomLoopMessage(exhausted.toolName, params.doomLoopThreshold);

  params.trace({
    sessionId: params.session.id,
    turn: loopedState.turn,
    step: loopedState.step,
    scope: 'turn',
    phase: 'turn.doom_loop',
    message: 'doom loop detected',
    data: {
      tool: exhausted.toolName,
      callCount: params.doomLoopThreshold,
    },
  });

  // 返回持久化消息的 Observable，不再继续
  return persistAssistantMessage({
    session: params.session,
    sessionManager: params.sessionManager,
    history: params.history,
    turn: loopedState.turn,
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
export function checkBudgetAndPreCompact(params: {
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
