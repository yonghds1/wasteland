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

export interface ConfigEdit {
  field: "provider" | "permissionMode" | "maxSteps" | "maxTurns" | null;
  originalValue: string | number;
}

export interface AppState {
  currentPage: PageName;

  // 模式状态
  inputMode: boolean;           // 是否在输入模式
  exitConfirmPending: boolean;  // 是否等待退出确认
  showHelp: boolean;            // 是否显示帮助
  filterMode: boolean;          // 是否在过滤模式（调试页面）
  editMode: boolean;            // 是否在编辑模式（配置页面）

  session: {
    agents: AgentNode[];
    messages: Message[];
    tools: ToolCall[];
    isStreaming: boolean;
    streamingContent: string;  // 流式输出的累积内容
    streamingMessageId: string | null;  // 当前流式消息 ID
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

  // 配置编辑状态
  configEdit: ConfigEdit;
  configHasChanges: boolean;  // 配置是否有未保存的更改

  // Session 元数据
  sessionMetadata: {
    id: string;
    providerId: string;
  };
}

// ============================================================
// Context
// ============================================================

interface AppContextValue {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  setCurrentPage: (page: PageName) => void;
  setInputMode: (mode: boolean) => void;
  setExitConfirmPending: (pending: boolean) => void;
  setShowHelp: (show: boolean) => void;
  setFilterMode: (mode: boolean) => void;
  setEditMode: (mode: boolean) => void;
  updateConfig: (updates: Partial<AppState["config"]>) => void;
  clearTraces: () => void;
}

export const AppContext = React.createContext<AppContextValue | null>(null);

export function useAppContext(): AppContextValue {
  const context = React.useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within AppContext.Provider");
  }
  return context;
}
