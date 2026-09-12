/**
 * session-records.ts - Session 持久化记录构建与写入辅助
 *
 * 集中管理 session transcript 所需的各类记录（message / usage / session /
 * session_end）的构建与落盘，从 agent-loop 中抽取以保持单一职责。
 */

import { from, map, tap, type Observable } from 'rxjs';

import type { ContextManager } from '../memory/context-manager.js';
import type { SessionManager, SessionMetadata } from './session-manager.js';
import type {
  ChatInputTurn,
  HistoryRecord,
  ReasoningPayload,
  RuntimeEvent,
  SessionMessageRecord,
  SessionRecord,
  SessionUsageRecord,
} from '../runtime/event-types.js';

/**
 * 创建时间戳（ISO 8601，UTC）
 *
 * 统一使用 ISO 格式，与 tool-dispatch 等模块一致，避免 session 文件中
 * message（本地时间）与 tool_call（UTC）格式不一致导致按时间排序错乱。
 */
export function createTimestamp(): string {
  return new Date().toISOString();
}

/** 创建用户消息记录 */
export function createUserRecord(turn: ChatInputTurn): SessionMessageRecord {
  return {
    type: 'message',
    role: 'user',
    turn: turn.turn,
    content: turn.content,
    source: turn.source,
    timestamp: createTimestamp(),
  };
}

/** 创建助手消息记录 */
export function createAssistantRecord(
  turn: number,
  content: string,
  reasoning?: ReasoningPayload
): SessionMessageRecord {
  return {
    type: 'message',
    role: 'assistant',
    turn,
    content,
    timestamp: createTimestamp(),
    // reasoning 缺失时不写该 key（旧记录逐字节一致）；有则原样透传（R-2）。
    ...(reasoning ? { reasoning } : {}),
  };
}

/** 创建使用量记录 */
export function createUsageRecord(
  sessionId: string,
  turn: number,
  usage: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number },
  timing?: { ttftMs: number; totalMs: number; tokensPerSec: number }
): SessionUsageRecord {
  return {
    type: 'usage',
    sessionId,
    turn,
    timestamp: createTimestamp(),
    usage,
    timing,
  };
}

/** 创建会话开始记录 */
export function createSessionStartRecord(session: SessionMetadata): SessionRecord {
  return {
    type: 'session',
    sessionId: session.id,
    mode: session.mode,
    cwd: session.cwd,
    provider: session.providerId,
    timestamp: createTimestamp(),
    parentId: session.parentId,
    childName: session.childName,
  };
}

/** 创建会话结束记录 */
export function createSessionEndRecord(sessionId: string): SessionRecord {
  return {
    type: 'session_end',
    sessionId,
    timestamp: createTimestamp(),
  };
}

/**
 * 持久化助手消息并发送 RuntimeEvent
 *
 * 数据流向：
 * 1. 创建助手消息记录
 * 2. 通过 SessionManager 追加到会话文件
 * 3. 将记录添加到内存历史
 * 4. 发出 assistant_message 事件
 */
export function persistAssistantMessage(params: {
  session: SessionMetadata;
  sessionManager: SessionManager;
  history: HistoryRecord[];
  turn: number;
  content: string;
  /** 上下文管理器（用于增量 token 追踪） */
  contextManager: ContextManager;
}): Observable<RuntimeEvent> {
  const assistantRecord = createAssistantRecord(params.turn, params.content);

  // from() 将 Promise 转换为 Observable
  // 使用 tap 在副作用中更新内存历史
  return from(params.sessionManager.appendRecord(params.session, assistantRecord)).pipe(
    tap(() => {
      params.history.push(assistantRecord);
      params.contextManager.trackRecord(assistantRecord);
    }),
    map(
      (): RuntimeEvent => ({
        type: 'assistant_message',
        sessionId: params.session.id,
        turn: params.turn,
        content: params.content,
      })
    )
  );
}
