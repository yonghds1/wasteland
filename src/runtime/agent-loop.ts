import { concat, concatMap, defer, from, map, of, tap, type Observable } from "rxjs";

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

export function runAgentLoop(params: {
  input$: Observable<ChatInputTurn>;
  provider: AgentProvider;
  sessionManager: SessionManager;
  toolRegistry?: ToolRegistry;
  permissionGate?: PermissionGate;
  cwd: string;
  mode: RuntimeMode;
}): Observable<RuntimeEvent> {
  return defer(async () =>
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
          const context = createTurnContext({
            sessionId: session.id,
            input: turn,
            cwd: params.cwd,
            history,
          });

          const userRecord = createUserRecord(turn);

          const user$ = from(params.sessionManager.appendRecord(session, userRecord)).pipe(
            tap(() => history.push(userRecord)),
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

          const assistant$ = params.provider.streamReply(context).pipe(
            concatMap((event) => {
              if (event.type === "tool_call") {
                if (!params.toolRegistry || !params.permissionGate) {
                  return of<RuntimeEvent>({
                    type: "tool_failed",
                    sessionId: session.id,
                    turn: context.turn,
                    callId: event.call.id,
                    toolName: event.call.toolName,
                    error: "当前运行时未配置 tool registry 或 permission gate。",
                  });
                }

                return dispatchToolCall({
                  session,
                  sessionManager: params.sessionManager,
                  turn: context.turn,
                  call: event.call,
                  registry: params.toolRegistry,
                  permissionGate: params.permissionGate,
                  cwd: params.cwd,
                });
              }

              if (event.type === "assistant_chunk") {
                return of<RuntimeEvent>({
                  type: "assistant_chunk",
                  sessionId: session.id,
                  turn: context.turn,
                  chunk: event.text,
                });
              }

              const assistantRecord = createAssistantRecord(context.turn, event.text);

              return from(params.sessionManager.appendRecord(session, assistantRecord)).pipe(
                tap(() => history.push(assistantRecord)),
                map(
                  (): RuntimeEvent => ({
                    type: "assistant_message",
                    sessionId: session.id,
                    turn: context.turn,
                    content: event.text,
                  }),
                ),
              );
            }),
          );

          return concat(user$, assistant$);
        }),
      );

      const end$ = from(
        params.sessionManager.appendRecord(session, createSessionEndRecord(session.id)),
      ).pipe(
        map(
          (): RuntimeEvent => ({
            type: "session_ended",
            sessionId: session.id,
          }),
        ),
      );

      return concat(start$, turns$, end$);
    }),
  );
}
