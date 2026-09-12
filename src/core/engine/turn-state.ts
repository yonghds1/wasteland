import type { ToolCall, ToolInput, ToolRunStatus } from '@tools/core/tool-types.js';
import type { ChatInputTurn, HistoryRecord, ReasoningPayload } from '../runtime/event-types.js';

export type TurnStatus = 'running' | 'completed' | 'failed';

export type TurnToolResult = {
  callId: string;
  toolName: string;
  input: ToolInput;
  status: ToolRunStatus;
  output?: string;
  error?: string;
  /**
   * 可选：发起本次 tool_call 的 assistant 消息携带的 reasoning 原文。
   * 同一 step 内多个 tool 共享同一条 assistant 消息的 reasoning，round-trip 回传用
   * （见 09-13 PRD R-3 intra-turn section-3 路径）。缺失时不写该 key。
   */
  reasoning?: ReasoningPayload;
};

export type TurnState = {
  sessionId: string;
  turn: number;
  cwd: string;
  input: ChatInputTurn;
  history: readonly HistoryRecord[];
  step: number;
  status: TurnStatus;
  assistantChunks: readonly string[];
  finalMessage?: string;
  toolCalls: readonly ToolCall[];
  toolResults: readonly TurnToolResult[];
};

export function createInitialTurnState(params: {
  sessionId: string;
  input: ChatInputTurn;
  cwd: string;
  history: readonly HistoryRecord[];
}): TurnState {
  return {
    sessionId: params.sessionId,
    turn: params.input.turn,
    cwd: params.cwd,
    input: params.input,
    history: [...params.history],
    step: 1,
    status: 'running',
    assistantChunks: [],
    toolCalls: [],
    toolResults: [],
  };
}

export function advanceTurnState(state: TurnState): TurnState {
  return {
    ...state,
    step: state.step + 1,
  };
}

export function appendAssistantChunk(state: TurnState, chunk: string): TurnState {
  return {
    ...state,
    assistantChunks: [...state.assistantChunks, chunk],
  };
}

export function completeTurnState(state: TurnState, content: string): TurnState {
  return {
    ...state,
    status: 'completed',
    finalMessage: content,
  };
}

export function failTurnState(state: TurnState): TurnState {
  return {
    ...state,
    status: 'failed',
  };
}

export function recordToolCall(state: TurnState, call: ToolCall): TurnState {
  return {
    ...state,
    toolCalls: [...state.toolCalls, call],
  };
}

export function recordToolResult(state: TurnState, result: TurnToolResult): TurnState {
  return {
    ...state,
    toolResults: [...state.toolResults, result],
  };
}

/**
 * 按 callId 排序记录工具结果
 * 用于并行执行时确保结果顺序正确
 */
export function recordToolResultSorted(state: TurnState, result: TurnToolResult): TurnState {
  const newResults = [...state.toolResults, result];
  // 按 callId 排序，保持与 toolCalls 顺序一致
  newResults.sort((a, b) => {
    const aIndex = state.toolCalls.findIndex((tc) => tc.id === a.callId);
    const bIndex = state.toolCalls.findIndex((tc) => tc.id === b.callId);
    return aIndex - bIndex;
  });
  return {
    ...state,
    toolResults: newResults,
  };
}
