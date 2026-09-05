import type { ChatInputTurn, HistoryRecord } from './event-types.js';
import type { ToolRegistry } from '@tools/tool-registry.js';

export type TurnContext = {
  sessionId: string;
  turn: number;
  input: ChatInputTurn;
  cwd: string;
  history: readonly HistoryRecord[];
  /** 工具注册表（用于 Provider 构建工具定义） */
  toolRegistry?: ToolRegistry;
  /** 角色的 system prompt */
  prompt?: string;
};

export function createTurnContext(params: {
  sessionId: string;
  input: ChatInputTurn;
  cwd: string;
  history: readonly HistoryRecord[];
  toolRegistry?: ToolRegistry;
  prompt?: string;
}): TurnContext {
  return {
    sessionId: params.sessionId,
    turn: params.input.turn,
    input: params.input,
    cwd: params.cwd,
    history: [...params.history],
    toolRegistry: params.toolRegistry,
    prompt: params.prompt,
  };
}
