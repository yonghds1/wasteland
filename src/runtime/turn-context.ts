import type { ChatInputTurn, SessionMessageRecord } from "./event-types.js";

export type TurnContext = {
  sessionId: string;
  turn: number;
  input: ChatInputTurn;
  cwd: string;
  history: readonly SessionMessageRecord[];
};

export function createTurnContext(params: {
  sessionId: string;
  input: ChatInputTurn;
  cwd: string;
  history: readonly SessionMessageRecord[];
}): TurnContext {
  return {
    sessionId: params.sessionId,
    turn: params.input.turn,
    input: params.input,
    cwd: params.cwd,
    history: [...params.history],
  };
}
