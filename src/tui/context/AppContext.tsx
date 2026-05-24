/**
 * AppContext - 全局状态管理
 */

import React from "react";

// ============================================================
// 类型定义
// ============================================================

export type PageName = "session" | "debug" | "config";

export interface AgentNode {
  id: string;
  name: string;
  depth: number;
  status: "running" | "idle" | "completed" | "failed" | "timeout";
  startTime: number;
  endTime?: number;
}

export interface Message {
  id: string;
  timestamp: string;
  agentId: string;
  type: "user" | "assistant" | "tool" | "system";
  content: string;
  collapsed?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  status: "pending" | "running" | "success" | "error";
  duration?: number;
}

export interface TraceEvent {
  timestamp: string;
  sessionId: string;
  turn?: number;
  step?: number;
  scope: string;
  phase: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface TraceFilter {
  scope?: string;
  phase?: string;
}

export interface AppState {
  currentPage: PageName;

  session: {
    agents: AgentNode[];
    messages: Message[];
    tools: ToolCall[];
    isStreaming: boolean;
  };

  debug: {
    traces: TraceEvent[];
    filter: TraceFilter;
  };

  config: {
    provider: string;
    model: string;
    permissionMode: string;
    maxTurns: number;
    maxSteps: number;
  };
}

// ============================================================
// Context
// ============================================================

interface AppContextValue {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  setCurrentPage: (page: PageName) => void;
}

export const AppContext = React.createContext<AppContextValue | null>(null);

export function useAppContext(): AppContextValue {
  const context = React.useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within AppContext.Provider");
  }
  return context;
}
