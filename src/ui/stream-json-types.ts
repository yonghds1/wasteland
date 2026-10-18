/**
 * stream-json-types.ts - 标准 Stream-JSON 流式协议事件类型定义（控制在 80 行以内）
 */

export type SessionStartEvent = { type: 'session_start'; sessionId: string; sessionPath?: string; mode?: string };
export type TurnStartEvent = { type: 'turn_start'; sessionId: string; turn: number; content: string; source?: string };
export type TextDeltaEvent = { type: 'text_delta'; sessionId: string; turn: number; delta: string };
export type ThinkingDeltaEvent = { type: 'thinking_delta'; sessionId: string; turn: number; delta: string };
export type ToolCallEvent = { type: 'tool_call'; sessionId: string; turn: number; callId: string; toolName: string; input: unknown };
export type PermissionDecisionEvent = {
  type: 'permission_decision';
  sessionId: string;
  turn: number;
  callId: string;
  toolName: string;
  decision: string;
  reason?: string;
  mode?: string;
};
export type ToolStartedEvent = { type: 'tool_started'; sessionId: string; turn: number; callId: string; toolName: string };
export type ToolResultEvent = {
  type: 'tool_result';
  sessionId: string;
  turn: number;
  callId: string;
  toolName: string;
  status: string;
  output?: string;
  error?: string;
};
export type UsageEvent = {
  type: 'usage';
  sessionId: string;
  turn: number;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number };
  timing?: { ttftMs?: number; totalMs?: number; tokensPerSec?: number };
};
export type TurnEndEvent = { type: 'turn_end'; sessionId: string; turn: number; content?: string };
export type SessionEndedEvent = { type: 'session_ended'; sessionId: string; finishReason?: string; error?: string };

export type StreamJsonEvent =
  | SessionStartEvent
  | TurnStartEvent
  | TextDeltaEvent
  | ThinkingDeltaEvent
  | ToolCallEvent
  | PermissionDecisionEvent
  | ToolStartedEvent
  | ToolResultEvent
  | UsageEvent
  | TurnEndEvent
  | SessionEndedEvent;
