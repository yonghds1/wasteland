import { concat, concatMap, defer, from, map, of, type Observable } from "rxjs";

import { executeToolCall } from "../tools/tool-runner.js";
import { ToolRegistry } from "../tools/tool-registry.js";
import type { ToolCall, ToolRunStatus } from "../tools/tool-types.js";
import {
  type RuntimeEvent,
  type SessionPermissionRecord,
  type SessionToolCallRecord,
  type SessionToolResultRecord,
} from "./event-types.js";
import { checkReadBeforeEdit } from "./file-audit.js";
import type { PermissionGate } from "./permission-gate.js";
import { SessionManager, type SessionMetadata } from "./session-manager.js";
import type { TurnState } from "./turn-state.js";

function createTimestamp(): string {
  return new Date().toISOString();
}

function createToolCallRecord(session: SessionMetadata, turn: number, call: ToolCall): SessionToolCallRecord {
  return {
    type: "tool_call",
    sessionId: session.id,
    turn,
    callId: call.id,
    toolName: call.toolName,
    input: call.input,
    timestamp: createTimestamp(),
  };
}

function createPermissionRecord(params: {
  session: SessionMetadata;
  turn: number;
  call: ToolCall;
  decision: ReturnType<PermissionGate["evaluate"]>;
}): SessionPermissionRecord {
  return {
    type: "permission",
    sessionId: params.session.id,
    turn: params.turn,
    callId: params.call.id,
    toolName: params.call.toolName,
    decision: params.decision.decision,
    mode: params.decision.mode,
    reason: params.decision.reason,
    timestamp: createTimestamp(),
  };
}

function createToolResultRecord(params: {
  session: SessionMetadata;
  turn: number;
  call: ToolCall;
  status: ToolRunStatus;
  output?: string;
  error?: string;
}): SessionToolResultRecord {
  return {
    type: "tool_result",
    sessionId: params.session.id,
    turn: params.turn,
    callId: params.call.id,
    toolName: params.call.toolName,
    status: params.status,
    output: params.output,
    error: params.error,
    timestamp: createTimestamp(),
  };
}

export function dispatchToolCall(params: {
  session: SessionMetadata;
  sessionManager: SessionManager;
  turn: number;
  call: ToolCall;
  registry: ToolRegistry;
  permissionGate: PermissionGate;
  cwd: string;
  turnState: TurnState;
}): Observable<RuntimeEvent> {
  // ---- read-before-edit 检查 ----
  // 对于 edit-file 和 write-file，检查是否已读取过目标文件
  const filePath = params.call.input.path;
  if (typeof filePath === "string") {
    const check = checkReadBeforeEdit({
      toolName: params.call.toolName,
      filePath,
      turnState: params.turnState,
    });

    if (!check.ok) {
      // 检查未通过，返回错误
      const failedRecord = createToolResultRecord({
        session: params.session,
        turn: params.turn,
        call: params.call,
        status: "error",
        error: check.error,
      });

      const failed$ = from(params.sessionManager.appendRecord(params.session, failedRecord)).pipe(
        map(
          (): RuntimeEvent => ({
            type: "tool_failed",
            sessionId: params.session.id,
            turn: params.turn,
            callId: params.call.id,
            toolName: params.call.toolName,
            status: "error",
            error: check.error ?? "read-before-edit 检查未通过。",
          }),
        ),
      );

      return failed$;
    }
  }

  const requested$ = from(
    params.sessionManager.appendRecord(
      params.session,
      createToolCallRecord(params.session, params.turn, params.call),
    ),
  ).pipe(
    map(
      (): RuntimeEvent => ({
        type: "tool_call_requested",
        sessionId: params.session.id,
        turn: params.turn,
        callId: params.call.id,
        toolName: params.call.toolName,
        input: params.call.input,
      }),
    ),
  );

  const tool = params.registry.get(params.call.toolName);

  if (!tool) {
    const failedRecord = createToolResultRecord({
      session: params.session,
      turn: params.turn,
      call: params.call,
      status: "error",
      error: `未找到工具：${params.call.toolName}`,
    });

    const failed$ = from(params.sessionManager.appendRecord(params.session, failedRecord)).pipe(
      map(
        (): RuntimeEvent => ({
          type: "tool_failed",
          sessionId: params.session.id,
          turn: params.turn,
          callId: params.call.id,
          toolName: params.call.toolName,
          status: "error",
          error: failedRecord.error ?? "工具执行失败。",
        }),
      ),
    );

    return concat(requested$, failed$);
  }

  const decision = params.permissionGate.evaluate(params.call, tool.riskLevel);

  const permission$ = from(
    params.sessionManager.appendRecord(
      params.session,
      createPermissionRecord({
        session: params.session,
        turn: params.turn,
        call: params.call,
        decision,
      }),
    ),
  ).pipe(
    map(
      (): RuntimeEvent => ({
        type: "permission_decision",
        sessionId: params.session.id,
        turn: params.turn,
        callId: params.call.id,
        toolName: params.call.toolName,
        decision: decision.decision,
        mode: decision.mode,
        reason: decision.reason,
      }),
    ),
  );

  if (decision.decision !== "allow") {
    const blockedStatus = decision.decision === "deny" ? "error" : "blocked";
    const failedRecord = createToolResultRecord({
      session: params.session,
      turn: params.turn,
      call: params.call,
      status: blockedStatus,
      error: decision.reason,
    });

    const failed$ = from(params.sessionManager.appendRecord(params.session, failedRecord)).pipe(
      map(
        (): RuntimeEvent => ({
          type: "tool_failed",
          sessionId: params.session.id,
          turn: params.turn,
          callId: params.call.id,
          toolName: params.call.toolName,
          status: blockedStatus,
          error: decision.reason,
        }),
      ),
    );

    return concat(requested$, permission$, failed$);
  }

  const started$ = of<RuntimeEvent>({
    type: "tool_started",
    sessionId: params.session.id,
    turn: params.turn,
    callId: params.call.id,
    toolName: params.call.toolName,
  });

  const result$ = defer(() =>
    executeToolCall({
      registry: params.registry,
      call: params.call,
      context: {
        sessionId: params.session.id,
        turn: params.turn,
        cwd: params.cwd,
      },
    }),
  ).pipe(
    concatMap((result) => {
      if (result.status === "success") {
        const resultRecord = createToolResultRecord({
          session: params.session,
          turn: params.turn,
          call: params.call,
          status: "success",
          output: result.output,
        });

        return from(params.sessionManager.appendRecord(params.session, resultRecord)).pipe(
          map(
            (): RuntimeEvent => ({
              type: "tool_result",
              sessionId: params.session.id,
              turn: params.turn,
              callId: params.call.id,
              toolName: params.call.toolName,
              status: "success",
              output: result.output,
            }),
          ),
        );
      }

      const failedRecord = createToolResultRecord({
        session: params.session,
        turn: params.turn,
        call: params.call,
        status: "error",
        error: result.error,
      });

      return from(params.sessionManager.appendRecord(params.session, failedRecord)).pipe(
        map(
          (): RuntimeEvent => ({
            type: "tool_failed",
            sessionId: params.session.id,
            turn: params.turn,
            callId: params.call.id,
            toolName: params.call.toolName,
            status: "error",
            error: result.error,
          }),
        ),
      );
    }),
  );

  return concat(requested$, permission$, started$, result$);
}
