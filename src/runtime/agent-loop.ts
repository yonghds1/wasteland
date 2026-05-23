import { EMPTY, Observable, Subject, concat, concatMap, defer, from, map, of, tap } from "rxjs";

import { createDebugTraceEvent, type DebugTraceEvent } from "./debug-events.js";
import type { AgentProvider } from "../providers/provider-types.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import type {
  ChatInputTurn,
  RuntimeEvent,
  RuntimeMode,
  SessionMessageRecord,
  SessionRecord,
} from "./event-types.js";
import type { PermissionGate } from "./permission-gate.js";
import { SessionManager, type SessionMetadata } from "./session-manager.js";
import { dispatchToolCall } from "./tool-dispatch.js";
import { createTurnContext } from "./turn-context.js";
import {
  advanceTurnState,
  appendAssistantChunk,
  completeTurnState,
  createInitialTurnState,
  failTurnState,
  recordToolCall,
  recordToolResult,
  type TurnState,
} from "./turn-state.js";

function createTimestamp(): string {
  return new Date().toISOString();
}

function createUserRecord(turn: ChatInputTurn): SessionMessageRecord {
  return {
    type: "message",
    role: "user",
    turn: turn.turn,
    content: turn.content,
    source: turn.source,
    timestamp: createTimestamp(),
  };
}

function createAssistantRecord(turn: number, content: string): SessionMessageRecord {
  return {
    type: "message",
    role: "assistant",
    turn,
    content,
    timestamp: createTimestamp(),
  };
}

function createSessionStartRecord(session: SessionMetadata): SessionRecord {
  return {
    type: "session",
    sessionId: session.id,
    mode: session.mode,
    cwd: session.cwd,
    provider: session.providerId,
    timestamp: createTimestamp(),
  };
}

function createSessionEndRecord(sessionId: string): SessionRecord {
  return {
    type: "session_end",
    sessionId,
    timestamp: createTimestamp(),
  };
}

type DebugTraceInput = Omit<DebugTraceEvent, "timestamp">;

type AgentRun = {
  events$: Observable<RuntimeEvent>;
  debug$: Observable<DebugTraceEvent>;
};

function persistAssistantMessage(params: {
  session: SessionMetadata;
  sessionManager: SessionManager;
  history: SessionMessageRecord[];
  turn: number;
  content: string;
}): Observable<RuntimeEvent> {
  const assistantRecord = createAssistantRecord(params.turn, params.content);

  return from(params.sessionManager.appendRecord(params.session, assistantRecord)).pipe(
    tap(() => {
      params.history.push(assistantRecord);
    }),
    map(
      (): RuntimeEvent => ({
        type: "assistant_message",
        sessionId: params.session.id,
        turn: params.turn,
        content: params.content,
      }),
    ),
  );
}

function createTraceEmitter(subject: Subject<DebugTraceEvent>) {
  return (event: DebugTraceInput): void => {
    subject.next(createDebugTraceEvent(event));
  };
}

function buildProviderFallbackMessage(state: TurnState): string {
  if (state.assistantChunks.length > 0) {
    return state.assistantChunks.join("");
  }

  return "当前 provider 未返回最终消息。";
}

function buildMaxStepsMessage(maxStepsPerTurn: number): string {
  return `当前单轮已达到最大工具步数限制（${maxStepsPerTurn}）。`;
}

function runTurnLoop(params: {
  session: SessionMetadata;
  sessionManager: SessionManager;
  provider: AgentProvider;
  context: ReturnType<typeof createTurnContext>;
  history: SessionMessageRecord[];
  state: TurnState;
  toolRegistry?: ToolRegistry;
  permissionGate?: PermissionGate;
  cwd: string;
  maxStepsPerTurn: number;
  trace: (event: DebugTraceInput) => void;
}): Observable<RuntimeEvent> {
  return defer(() => {
    if (params.state.step > params.maxStepsPerTurn) {
      const limitedState = failTurnState(params.state);
      const message = buildMaxStepsMessage(params.maxStepsPerTurn);

      params.trace({
        sessionId: params.session.id,
        turn: limitedState.turn,
        step: limitedState.step,
        scope: "turn",
        phase: "turn.max_steps",
        message: "turn reached max steps",
        data: {
          maxSteps: params.maxStepsPerTurn,
        },
      });

      return persistAssistantMessage({
        session: params.session,
        sessionManager: params.sessionManager,
        history: params.history,
        turn: limitedState.turn,
        content: message,
      });
    }

    let state = params.state;
    let nextAction: "complete" | "tool" | "none" = "none";

    params.trace({
      sessionId: params.session.id,
      turn: state.turn,
      step: state.step,
      scope: "provider",
      phase: "provider.start",
      message: "run provider step",
      data: {
        provider: params.provider.id,
        history: state.history.length,
        toolResults: state.toolResults.length,
      },
    });

    const provider$ = params.provider.runStep({
      context: params.context,
      state,
    }).pipe(
      concatMap((event) => {
        if (event.type !== "assistant_chunk") {
          params.trace({
            sessionId: params.session.id,
            turn: state.turn,
            step: state.step,
            scope: "provider",
            phase: "provider.event",
            message: "provider emitted event",
            data: {
              type: event.type,
              toolName: event.type === "tool_call" ? event.call.toolName : undefined,
            },
          });
        }

        if (event.type === "assistant_chunk") {
          state = appendAssistantChunk(state, event.text);

          return of<RuntimeEvent>({
            type: "assistant_chunk",
            sessionId: params.session.id,
            turn: state.turn,
            chunk: event.text,
          });
        }

        if (event.type === "assistant_message") {
          state = completeTurnState(state, event.text);
          nextAction = "complete";

          return persistAssistantMessage({
            session: params.session,
            sessionManager: params.sessionManager,
            history: params.history,
            turn: state.turn,
            content: event.text,
          }).pipe(
            tap(() => {
              params.trace({
                sessionId: params.session.id,
                turn: state.turn,
                step: state.step,
                scope: "turn",
                phase: "turn.complete",
                message: "turn completed",
                data: {
                  contentLength: event.text.length,
                },
              });
            }),
          );
        }

        state = recordToolCall(state, event.call);
        nextAction = "tool";

        if (!params.toolRegistry || !params.permissionGate) {
          const error = "当前运行时未配置 tool registry 或 permission gate。";

          state = recordToolResult(state, {
            callId: event.call.id,
            toolName: event.call.toolName,
            status: "error",
            error,
          });

          params.trace({
            sessionId: params.session.id,
            turn: state.turn,
            step: state.step,
            scope: "tool",
            phase: "tool.result",
            message: "tool execution failed before dispatch",
            data: {
              tool: event.call.toolName,
              status: "error",
            },
          });

          return of<RuntimeEvent>({
            type: "tool_failed",
            sessionId: params.session.id,
            turn: state.turn,
            callId: event.call.id,
            toolName: event.call.toolName,
            status: "error",
            error,
          });
        }

        const startedAt = Date.now();

        return dispatchToolCall({
          session: params.session,
          sessionManager: params.sessionManager,
          turn: state.turn,
          call: event.call,
          registry: params.toolRegistry,
          permissionGate: params.permissionGate,
          cwd: params.cwd,
        }).pipe(
          tap((toolEvent) => {
            if (toolEvent.type === "tool_started") {
              params.trace({
                sessionId: params.session.id,
                turn: state.turn,
                step: state.step,
                scope: "tool",
                phase: "tool.start",
                message: "tool execution started",
                data: {
                  tool: toolEvent.toolName,
                },
              });

              return;
            }

            if (toolEvent.type === "permission_decision") {
              params.trace({
                sessionId: params.session.id,
                turn: state.turn,
                step: state.step,
                scope: "tool",
                phase: "tool.permission",
                message: "permission decision resolved",
                data: {
                  tool: toolEvent.toolName,
                  decision: toolEvent.decision,
                  mode: toolEvent.mode,
                },
              });

              return;
            }

            if (toolEvent.type === "tool_result") {
              state = recordToolResult(state, {
                callId: toolEvent.callId,
                toolName: toolEvent.toolName,
                status: toolEvent.status,
                output: toolEvent.output,
              });

              params.trace({
                sessionId: params.session.id,
                turn: state.turn,
                step: state.step,
                scope: "tool",
                phase: "tool.result",
                message: "tool execution completed",
                data: {
                  tool: toolEvent.toolName,
                  status: toolEvent.status,
                  ms: Date.now() - startedAt,
                },
              });

              return;
            }

            if (toolEvent.type === "tool_failed") {
              state = recordToolResult(state, {
                callId: toolEvent.callId,
                toolName: toolEvent.toolName,
                status: toolEvent.status,
                error: toolEvent.error,
              });

              params.trace({
                sessionId: params.session.id,
                turn: state.turn,
                step: state.step,
                scope: "tool",
                phase: "tool.result",
                message: "tool execution failed",
                data: {
                  tool: toolEvent.toolName,
                  status: toolEvent.status,
                  ms: Date.now() - startedAt,
                },
              });
            }
          }),
        );
      }),
    );

    const continuation$ = defer(() => {
      if (nextAction === "complete" || state.status === "completed") {
        return EMPTY;
      }

      if (nextAction === "tool") {
        const nextState = advanceTurnState(state);

        params.trace({
          sessionId: params.session.id,
          turn: nextState.turn,
          step: nextState.step,
          scope: "turn",
          phase: "turn.advance",
          message: "advance to next provider step",
          data: {
            toolResults: nextState.toolResults.length,
          },
        });

        return runTurnLoop({
          ...params,
          state: nextState,
        });
      }

      const fallbackMessage = buildProviderFallbackMessage(state);
      state = completeTurnState(state, fallbackMessage);

      params.trace({
        sessionId: params.session.id,
        turn: state.turn,
        step: state.step,
        scope: "provider",
        phase: "provider.empty",
        message: "provider completed without final assistant message",
        data: {
          chunkCount: state.assistantChunks.length,
        },
      });

      return persistAssistantMessage({
        session: params.session,
        sessionManager: params.sessionManager,
        history: params.history,
        turn: state.turn,
        content: fallbackMessage,
      }).pipe(
        tap(() => {
          params.trace({
            sessionId: params.session.id,
            turn: state.turn,
            step: state.step,
            scope: "turn",
            phase: "turn.complete",
            message: "turn completed via fallback assistant message",
            data: {
              contentLength: fallbackMessage.length,
            },
          });
        }),
      );
    });

    return concat(provider$, continuation$);
  });
}

export function runAgentLoop(params: {
  input$: Observable<ChatInputTurn>;
  provider: AgentProvider;
  sessionManager: SessionManager;
  toolRegistry?: ToolRegistry;
  permissionGate?: PermissionGate;
  cwd: string;
  mode: RuntimeMode;
  maxStepsPerTurn?: number;
}): AgentRun {
  const debugSubject = new Subject<DebugTraceEvent>();
  const trace = createTraceEmitter(debugSubject);
  const maxStepsPerTurn = params.maxStepsPerTurn ?? 8;

  const events$ = defer(async () =>
    params.sessionManager.startSession({
      cwd: params.cwd,
      mode: params.mode,
      providerId: params.provider.id,
    }),
  ).pipe(
    concatMap((session) => {
      const history: SessionMessageRecord[] = [];

      const start$ = from(
        params.sessionManager.appendRecord(session, createSessionStartRecord(session)),
      ).pipe(
        tap(() => {
          trace({
            sessionId: session.id,
            scope: "session",
            phase: "session.start",
            message: "session started",
            data: {
              mode: session.mode,
              provider: session.providerId,
            },
          });
        }),
        map(
          (): RuntimeEvent => ({
            type: "session_started",
            sessionId: session.id,
            sessionPath: session.path,
            mode: session.mode,
          }),
        ),
      );

      const turns$ = params.input$.pipe(
        concatMap((turn) => {
          const historySnapshot = [...history];
          const context = createTurnContext({
            sessionId: session.id,
            input: turn,
            cwd: params.cwd,
            history: historySnapshot,
          });

          const userRecord = createUserRecord(turn);

          const user$ = from(params.sessionManager.appendRecord(session, userRecord)).pipe(
            tap(() => {
              history.push(userRecord);
              trace({
                sessionId: session.id,
                turn: turn.turn,
                step: 1,
                scope: "turn",
                phase: "turn.input",
                message: "user turn received",
                data: {
                  source: turn.source,
                },
              });
            }),
            map(
              (): RuntimeEvent => ({
                type: "user_turn",
                sessionId: session.id,
                turn: turn.turn,
                content: turn.content,
                source: turn.source,
              }),
            ),
          );

          const assistant$ = runTurnLoop({
            session,
            sessionManager: params.sessionManager,
            provider: params.provider,
            context,
            history,
            state: createInitialTurnState({
              sessionId: session.id,
              input: turn,
              cwd: params.cwd,
              history: historySnapshot,
            }),
            toolRegistry: params.toolRegistry,
            permissionGate: params.permissionGate,
            cwd: params.cwd,
            maxStepsPerTurn,
            trace,
          });

          return concat(user$, assistant$);
        }),
      );

      const end$ = from(
        params.sessionManager.appendRecord(session, createSessionEndRecord(session.id)),
      ).pipe(
        tap(() => {
          trace({
            sessionId: session.id,
            scope: "session",
            phase: "session.end",
            message: "session ended",
          });
        }),
        map(
          (): RuntimeEvent => ({
            type: "session_ended",
            sessionId: session.id,
          }),
        ),
      );

      return concat(start$, turns$, end$);
    }),
    tap({
      error: (error) => {
        trace({
          sessionId: "runtime",
          scope: "session",
          phase: "session.error",
          message: error instanceof Error ? error.message : String(error),
        });
      },
    }),
  );

  return {
    events$: new Observable<RuntimeEvent>((subscriber) => {
      const subscription = events$.subscribe({
        next: (event) => subscriber.next(event),
        error: (error) => {
          debugSubject.complete();
          subscriber.error(error);
        },
        complete: () => {
          debugSubject.complete();
          subscriber.complete();
        },
      });

      return () => {
        subscription.unsubscribe();
        debugSubject.complete();
      };
    }),
    debug$: debugSubject.asObservable(),
  };
}
