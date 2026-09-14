/**
 * spawn-agent/event-forwarder.ts - 子 Agent 事件转发
 *
 * 集中处理 spawn_agent 事件流的关注点：
 * 1. translateChildEvent - 子 agent 内部事件 → 父侧可观察事件
 * 2. finishStatusMachine - 收尾状态机（success/error/timeout）
 *    - 释放 skin 占用（agent_completed / unsubscribe 兜底）
 *    - 关闭子 session（修复 take(1) 退订导致 session.jsonl 不完整）
 *    - 累积中间事件
 *    - 写 agent_completed + tool_result/tool_failed + 父 session 记录
 * 3. assembleForwardObservable - 组装最终 Observable<RuntimeEvent>：
 *    - subscriber.next(spawnedEvent)
 *    - 订阅 events$ 单订阅 + 翻译 + 累积
 *    - 超时定时器
 *    - unsubscribe 兜底（clearTimeout + sub.unsubscribe + release）
 *
 * 与 spawn-agent.ts 旧实现逻辑完全一致，保证 451 测试无回归。
 */

import { Observable } from 'rxjs';
import { readFile } from 'node:fs/promises';

import { t } from '@locales/index.js';
import * as skinOccupancy from '@core/runtime/skin-occupancy.js';
import { defaultSkin as defaultRoleSkin } from '@skins/index.js';
import type {
  SessionToolResultRecord,
  RuntimeEvent,
  HistoryRecord,
} from '@core/runtime/event-types.js';

import type { FinishStatus, SpawnAgentContext } from './types.js';
import { summarizeRecords } from '@core/memory/context-summarizer.js';

/**
 * 将子 agent 内部事件翻译为父侧可观察事件。
 *
 * 关注的对应：
 * - assistant_chunk → agent_thinking
 * - tool_call_requested → agent_tool_use（带 input）
 * - tool_started / tool_result / tool_failed → agent_tool_use（仅 toolName）
 * - permission_decision → agent_progress（permission: ...）
 * - agent_spawned → agent_progress（sub-spawned: ...）
 * - agent_completed → agent_progress（sub-completed: ...）
 * - 其他 → null（caller 跳过）
 */
export function translateChildEvent(
  e: RuntimeEvent,
  childId: string,
  childName: string
): RuntimeEvent | null {
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
    case 'context_compacted':
      return {
        type: 'agent_progress',
        childId,
        childName,
        status: 'compacted',
        message:
          `context compacted: removed ${e.removedCount} records, ` +
          `saved ~${e.tokensSaved} tokens` +
          (e.summarized ? ' (summarized)' : ''),
      };
    case 'user_input_requested':
    case 'user_input_received':
      return e;
    default:
      return null;
  }
}

/**
 * finish 状态机参数
 */
export type FinishParams = {
  parentId: string;
  childId: string;
  childName: string;
  childSessionPath: string;
  call: { id: string; toolName: string };
  turn: number;
  context: SpawnAgentContext;
  forwarded: RuntimeEvent[];
  subAgentSkinCandidates: string[];
  selectedSkinId: string;
  childAgentTimeoutMs: number;
};

/**
 * finish 状态机返回（subscriber 控制句柄）
 */
export type FinishResult = {
  status: FinishStatus | null;
  /** finish 调用过的标志（避免重复 finish） */
  called: boolean;
};

/**
 * 调用 finish 收尾状态机（释放占用 + 关闭 session + 转发累积 + 写 agent_completed + 父 session 记录；
 * 终结事件仅成功分支发 tool_result，失败分支交由外层 catchError 产出唯一一条 tool_failed）
 *
 * 完成语义：
 * - status === 'success' 时：发 tool_result 事件 + subscriber.complete()
 * - 其他状态时：**不发事件**，只写 error 记录并 subscriber.error(...)，
 *   由外层 catchError（重试耗尽后）产出唯一一条 tool_failed —— 避免同 callId 双终结事件。
 *
 * 幂等：重复调用直接 return。
 */
export function invokeFinish(
  params: FinishParams,
  status: FinishStatus,
  content: string | undefined,
  error: string | undefined,
  subscriber: {
    next: (event: RuntimeEvent) => void;
    complete: () => void;
    error: (err: Error) => void;
  },
  state: { resolved: boolean; called: boolean }
): void {
  if (state.resolved || state.called) return;
  state.called = true;

  const {
    parentId,
    childId,
    call,
    turn,
    context,
    subAgentSkinCandidates,
    selectedSkinId,
    childSessionPath,
  } = params;

  // 0) 释放 skin 占用（子 agent 退出 → 释放候选 skin 给下次 spawn 用）
  if (subAgentSkinCandidates.length > 0 && selectedSkinId !== defaultRoleSkin) {
    skinOccupancy.release(selectedSkinId, childId);
  }

  // 0.1) 关闭子 session：写 session_end + 清理缓冲区
  // 修复 take(1) 退订 runAgentLoop.end$ 导致的子 session.jsonl 不完整
  context.sessionManager.closeSession(childId).catch(() => {});

  // 1) agent_completed
  subscriber.next({
    type: 'agent_completed',
    childId,
    status,
    result: content,
    error,
    sessionPath: childSessionPath,
  });

  // 3) 终结：success 发 tool_result 事件；失败只写 error 记录
  //    （失败事件由外层 catchError 唯一产出，见上方失败分支注释）
  const ts = new Date().toISOString();
  if (status === 'success') {
    const output = content || t('tools.spawnAgent.executionComplete');
    subscriber.next({
      type: 'tool_result',
      sessionId: parentId,
      turn,
      callId: call.id,
      toolName: call.toolName,
      status: 'success',
      output,
    });
    const record: SessionToolResultRecord = {
      type: 'tool_result',
      sessionId: parentId,
      turn,
      callId: call.id,
      toolName: call.toolName,
      status: 'success',
      output,
      timestamp: ts,
    };
    context.sessionManager.appendRecord(context.session, record).catch(() => {});
    subscriber.complete();
  } else {
    const errMsg =
      error ||
      (status === 'timeout'
        ? `子 Agent 执行超时 (timeout: ${params.childAgentTimeoutMs}ms)`
        : t('tools.spawnAgent.executionFailed'));
    // 失败分支**不**发 tool_failed 事件：本 observable 外层有 retry + catchError，
    // 终结事件由 catchError 统一产出。这里若也 next(tool_failed)，同一个 callId 会
    // 发出两条终结事件（本函数一条 + catchError 一条），turn-executor 会把两条都记进
    // state.toolResults，buildMessages 因而生成重复 tool_call_id 被上游拒收。
    // 见 09-14-duplicate-tool-call-id。
    const record: SessionToolResultRecord = {
      type: 'tool_result',
      sessionId: parentId,
      turn,
      callId: call.id,
      toolName: call.toolName,
      status: 'error',
      error: errMsg,
      timestamp: ts,
    };
    context.sessionManager.appendRecord(context.session, record).catch(() => {});

    // 失败：调 subscriber.error 触发外层 retry（按 multiAgent.maxRetries 重试）；
    // 重试耗尽后由 catchError 产出唯一一条 tool_failed。
    subscriber.error(new Error(error || `子 Agent 失败 (${status})`));
  }

  state.resolved = true;
}

async function extractOrSummarizeChildResult(
  childId: string,
  childSessionPath: string,
  context: SpawnAgentContext,
  finalMessage: string
): Promise<string> {
  // 确保所有缓冲区已落盘
  await context.sessionManager.flush(childId).catch(() => {});

  let history: HistoryRecord[] = [];
  try {
    const content = await readFile(childSessionPath, 'utf8');
    history = content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  } catch {
    // 忽略文件读取错误
  }

  const reversed = [...history].reverse();
  const reportCall = reversed.find((r) => r.type === 'tool_call' && 'toolName' in r && r.toolName === 'report_result');
  if (reportCall && reportCall.type === 'tool_call') {
    const reportJson = JSON.stringify(reportCall.input, null, 2);
    return `[子 Agent 已完成任务]\n最终回复: ${finalMessage}\n\n执行结果报告 (report_result):\n${reportJson}`;
  }

  // 如果子 Agent 未主动调用 report_result，且配置允许，则利用 LLM 对子 Agent 的完整轨迹进行总结提炼
  try {
    const summary = await summarizeRecords(context.provider, history, {
      sessionId: childId,
      turn: context.turn,
      cwd: context.cwd,
    });
    if (summary && summary.trim().length > 0) {
      return `[子 Agent 上下文摘要]\n最终回复: ${finalMessage}\n\n全生命周期提炼总结:\n${summary}`;
    }
  } catch {
    // 摘要失败时，静默降级为直接返回 finalMessage
  }

  return finalMessage;
}

/**
 * 组装最终转发 Observable。
 *
 * 输出顺序：
 * 1. spawnedEvent（agent_spawned）
 * 2. 中间事件（agent_thinking / agent_tool_use / agent_progress）
 * 3. agent_completed
 * 4. tool_result / tool_failed
 *
 * @param params - events$ 来源 + childId + childName + finish 调用参数
 * @returns Observable<RuntimeEvent>（cold，内部单订阅）
 */
export function assembleForwardObservable(params: {
  events$: Observable<RuntimeEvent>;
  parentId: string;
  childId: string;
  childName: string;
  childTask: string;
  childSessionPath: string;
  call: { id: string; toolName: string };
  turn: number;
  context: SpawnAgentContext;
  subAgentSkinCandidates: string[];
  selectedSkinId: string;
  childAgentTimeoutMs: number;
}): Observable<RuntimeEvent> {
  const {
    events$,
    parentId,
    childId,
    childName,
    childTask,
    childSessionPath,
    call,
    turn,
    context,
    subAgentSkinCandidates,
    selectedSkinId,
    childAgentTimeoutMs,
  } = params;

  // ---- 单订阅 events$，手动管理转发累积与最终结果 ----
  return new Observable<RuntimeEvent>((subscriber) => {
    const forwarded: RuntimeEvent[] = [];
    const state = { resolved: false, called: false };

    const finish = (
      status: FinishStatus,
      content?: string,
      error?: string
    ): void => {
      if (state.resolved) return;
      invokeFinish(
        {
          parentId,
          childId,
          childName,
          childSessionPath,
          call,
          turn,
          context,
          forwarded,
          subAgentSkinCandidates,
          selectedSkinId,
          childAgentTimeoutMs,
        },
        status,
        content,
        error,
        {
          next: (e) => subscriber.next(e),
          complete: () => subscriber.complete(),
          error: (err) => subscriber.error(err),
        },
        state
      );
    };

    // 立即 yield agent_spawned（在中间转发事件之前）
    subscriber.next({
      type: 'agent_spawned',
      parentId,
      childId,
      childSessionPath,
      name: childName,
      task: childTask,
    });

    let isSummarizing = false;
    const sub = events$.subscribe({
      next: (e) => {
        if (e.type === 'assistant_message') {
          isSummarizing = true;
          extractOrSummarizeChildResult(childId, childSessionPath, context, e.content)
            .then(summary => finish('success', summary))
            .catch(err => finish('error', undefined, String(err)));
        } else if (e.type === 'session_ended') {
          // 子 agent session 结束但未产生 assistant_message
          if (!isSummarizing) finish('error', undefined, t('tools.spawnAgent.noResponse'));
        } else {
          const translated = translateChildEvent(e, childId, childName);
          if (translated) {
            forwarded.push(translated);
            subscriber.next(translated);
          }
        }
      },
      error: (err) => {
        if (!isSummarizing) finish('error', undefined, err instanceof Error ? err.message : String(err));
      },
      complete: () => {
        // 兜底：流 complete 但未触发 assistant_message / session_ended
        if (!isSummarizing) finish('error', undefined, t('tools.spawnAgent.noResponse'));
      },
    });

    const timeoutHandle = setTimeout(() => {
      finish('timeout', undefined, `子 Agent 执行超时 (timeout: ${childAgentTimeoutMs}ms)`);
    }, childAgentTimeoutMs);

    return () => {
      clearTimeout(timeoutHandle);
      sub.unsubscribe();
      // 兜底释放：若 finish() 未被调用（被 unsubscribe 强制中断），确保占用不泄漏
      if (subAgentSkinCandidates.length > 0 && selectedSkinId !== defaultRoleSkin) {
        skinOccupancy.release(selectedSkinId, childId);
      }
    };
  });
}
