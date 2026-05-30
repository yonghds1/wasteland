export type DebugTraceScope =
  | 'session'
  | 'turn'
  | 'provider'
  | 'tool'
  | 'ui'
  | 'skill'
  | 'permission';

export type DebugTraceEvent = {
  timestamp: string;
  sessionId: string;
  turn?: number;
  step?: number;
  scope: DebugTraceScope;
  phase: string;
  message: string;
  data?: Record<string, unknown>;
};

export function createDebugTraceEvent(
  params: Omit<DebugTraceEvent, 'timestamp'> & { timestamp?: string }
): DebugTraceEvent {
  return {
    timestamp: params.timestamp ?? new Date().toISOString(),
    sessionId: params.sessionId,
    turn: params.turn,
    step: params.step,
    scope: params.scope,
    phase: params.phase,
    message: params.message,
    data: params.data,
  };
}
