import type { PermissionDecisionKind, PermissionMode } from "./permission-gate.js";
import type { ToolInput } from "../tools/tool-types.js";

export type InputSource = "message" | "stdin" | "interactive";
export type RuntimeMode = "single" | "interactive";

export type ChatInputTurn = {
  turn: number;
  content: string;
  source: InputSource;
};

export type SessionMessageRecord = {
  type: "message";
  role: "user" | "assistant";
  turn: number;
  content: string;
  timestamp: string;
  source?: InputSource;
};

export type SessionToolCallRecord = {
  type: "tool_call";
  sessionId: string;
  turn: number;
  callId: string;
  toolName: string;
  input: ToolInput;
  timestamp: string;
};

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

export type SessionToolResultRecord = {
  type: "tool_result";
  sessionId: string;
  turn: number;
  callId: string;
  toolName: string;
  status: "success" | "error" | "blocked";
  output?: string;
  error?: string;
  timestamp: string;
};

export type SessionRecord =
  | {
      type: "session";
      sessionId: string;
      mode: RuntimeMode;
      cwd: string;
      provider: string;
      timestamp: string;
    }
  | SessionMessageRecord
  | SessionToolCallRecord
  | SessionPermissionRecord
  | SessionToolResultRecord
  | {
      type: "session_end";
      sessionId: string;
      timestamp: string;
    };

export type RuntimeEvent =
  | {
      type: "session_started";
      sessionId: string;
      sessionPath: string;
      mode: RuntimeMode;
    }
  | {
      type: "user_turn";
      sessionId: string;
      turn: number;
      content: string;
      source: InputSource;
    }
  | {
      type: "assistant_chunk";
      sessionId: string;
      turn: number;
      chunk: string;
    }
  | {
      type: "assistant_message";
      sessionId: string;
      turn: number;
      content: string;
    }
  | {
      type: "tool_call_requested";
      sessionId: string;
      turn: number;
      callId: string;
      toolName: string;
      input: ToolInput;
    }
  | {
      type: "permission_decision";
      sessionId: string;
      turn: number;
      callId: string;
      toolName: string;
      decision: PermissionDecisionKind;
      mode: PermissionMode;
      reason: string;
    }
  | {
      type: "tool_started";
      sessionId: string;
      turn: number;
      callId: string;
      toolName: string;
    }
  | {
      type: "tool_result";
      sessionId: string;
      turn: number;
      callId: string;
      toolName: string;
      output: string;
    }
  | {
      type: "tool_failed";
      sessionId: string;
      turn: number;
      callId: string;
      toolName: string;
      error: string;
    }
  | {
      type: "session_ended";
      sessionId: string;
    };
