/**
 * session-record-types.ts - 会话持久化与上下文历史记录类型定义
 */

import type { PermissionDecisionKind, PermissionMode } from "../engine/permission-gate.js";
import type { ToolInput, ToolRunStatus } from "@tools/core/tool-types.js";
import type { ReasoningPayload, RuntimeMode, InputSource } from "./event-types.js";

/**
 * 会话消息记录
 */
export type SessionMessageRecord = {
  type: "message";
  role: "user" | "assistant";
  turn: number;
  content: string;
  timestamp: string;
  source?: InputSource;
  reasoning?: ReasoningPayload;
};

/**
 * 会话工具调用记录
 */
export type SessionToolCallRecord = {
  type: "tool_call";
  sessionId: string;
  turn: number;
  callId: string;
  toolName: string;
  input: ToolInput;
  timestamp: string;
  reasoning?: ReasoningPayload;
};

/**
 * 会话权限决策记录
 */
export type SessionPermissionRecord = {
  type: "permission";
  sessionId: string;
  turn: number;
  callId: string;
  toolName: string;
  decision: PermissionDecisionKind;
  mode: PermissionMode;
  reason: string;
  timestamp: string;
};

/**
 * 会话工具结果记录
 */
export type SessionToolResultRecord = {
  type: "tool_result";
  sessionId: string;
  turn: number;
  callId: string;
  toolName: string;
  status: ToolRunStatus;
  output?: string;
  error?: string;
  timestamp: string;
};

/**
 * 会话摘要记录
 */
export type SessionSummaryRecord = {
  type: "summary";
  turn: number;
  content: string;
  summarizedCount: number;
  timestamp: string;
};

/**
 * 历史记录联合类型
 */
export type HistoryRecord =
  | SessionMessageRecord
  | SessionToolCallRecord
  | SessionToolResultRecord
  | SessionSummaryRecord;

/**
 * 会话开始记录
 */
export type SessionStartRecord = {
  type: "session";
  sessionId: string;
  mode: RuntimeMode;
  cwd: string;
  provider: string;
  timestamp: string;
  parentId?: string;
  childName?: string;
};

/**
 * 会话结束记录
 */
export type SessionEndRecord = {
  type: "session_end";
  sessionId: string;
  timestamp: string;
};

/**
 * 会话使用量记录
 */
export type SessionUsageRecord = {
  type: "usage";
  sessionId: string;
  turn: number;
  timestamp: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens?: number;
  };
  timing?: {
    ttftMs: number;
    totalMs: number;
    tokensPerSec: number;
  };
};

/**
 * 会话撤销记录
 */
export type SessionUndoRecord = {
  type: "undo";
  sessionId: string;
  undoneTurn: number;
  targetTurn: number;
  restoredFiles: string[];
  timestamp: string;
};

/**
 * 会话上下文压缩记录
 */
export type SessionCompactionRecord = {
  type: "compaction";
  sessionId: string;
  turn: number;
  removedCount: number;
  tokensSaved: number;
  summarized: boolean;
  timestamp: string;
};

/**
 * 会话记录（联合类型）
 */
export type SessionRecord =
  | SessionStartRecord
  | SessionMessageRecord
  | SessionToolCallRecord
  | SessionPermissionRecord
  | SessionToolResultRecord
  | SessionUsageRecord
  | SessionCompactionRecord
  | SessionUndoRecord
  | SessionEndRecord;
