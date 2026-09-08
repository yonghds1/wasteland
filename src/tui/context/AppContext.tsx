/**
 * AppContext - 全局状态管理
 */

import React from 'react';
import type { TuiFullConfig } from '../types.js';
import type { LogLevel, LogScope } from '@core/logger/index.js';

// ============================================================
// 类型定义
// ============================================================

export type PageName = 'session' | 'debug' | 'config' | 'sessions' | 'logs';
export type FocusArea =
  | 'header'
  | 'agentTree'
  | 'messageList'
  | 'inputBar'
  | 'agentTabs'
  | 'traceLog'
  | 'configList'
  | null;

/**
 * Help dialog view identifier.
 *
 * - null: no help dialog
 * - 'commands': wasteland command reference dialog (triggered by `/help` command)
 *
 * `?` 快捷键已移除——用户必须通过 `/help` 命令访问帮助。
 */
export type HelpView = 'commands' | null;

export interface AgentNode {
  id: string;
  name: string;
  roleName?: string;
  skinId?: string;
  task?: string;
  currentAction?: string;
  stepCount?: number;
  duration?: number;
  depth: number;
  status: 'running' | 'idle' | 'completed' | 'failed' | 'timeout';
  startTime: number;
  endTime?: number;
}

export interface Message {
  id: string;
  timestamp: string;
  agentId: string;
  type: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  collapsed?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'success' | 'error';
  duration?: number;
  args?: string;
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

export interface PermissionCard {
  callId: string;
  toolName: string;
  command?: string;
  /** 触发问询的完整工具输入（once/always 模式推导与 session 规则注册用）。 */
  input?: Record<string, unknown>;
  question: string;
  status: 'pending' | 'resolved';
  decision?: 'allow' | 'deny' | 'allow_always';
  timestamp: string;
}

export interface ConfigEdit {
  field:
    | 'provider'
    | 'permissionMode'
    | 'maxSteps'
    | 'defaultRole'
    | 'childAgentTimeout'
    | 'debug'
    | null;
  originalValue: string | number | boolean;
}

export interface AppState {
  currentPage: PageName;
  focusArea: FocusArea; // 当前焦点区域

  // 模式状态
  inputMode: boolean; // 是否在输入模式
  exitConfirmPending: boolean; // 是否等待退出确认
  /**
   * 当前显示的帮助 dialog 视图。
   *
   * - null: 不显示帮助
   * - 'commands': wasteland 命令参考(由 /help 命令触发)
   *
   * 由 setShowHelp 切换;Esc 关闭并回 null。
   */
  showHelp: HelpView;
  filterMode: boolean; // 是否在过滤模式（调试页面）
  editMode: boolean; // 是否在编辑模式（配置页面）

  /** 权限卡片当前选中的选项索引（0: 允许本次, 1: 永久允许, 2: 拒绝） */
  permissionSelection: number;

  /** 统一权限模型：pending 为队头（当前展示/回答的那一张），queue 为后续等待，history 为已决 */
  permission: {
    pending: PermissionCard | null;
    queue: PermissionCard[];
    history: PermissionCard[];
  };

  /** Logs page 过滤器（独立于 LogBus 内部过滤；本页 UI 层 local filter）。 */
  logPageFilter: LogPageFilter;

  /**
   * AgentTabs 子 agent 过滤模式。
   *
   * - undefined: 显示所有消息（默认）
   * - agentId: 只显示该 agent 的消息（ChatMessageList 据此过滤）
   *
   * 由 AgentTabs 通过 setViewFilter 设置；选中 Main 时由 AgentTabs 重置为 undefined。
   */
  viewFilter?: string;

  session: {
    agents: AgentNode[];
    messages: Message[];
    tools: ToolCall[];
    isThinking: boolean; // 等待第一个 chunk（思考中）
    isStreaming: boolean; // 正在接收流式数据
    streamingContent: string; // 流式输出的累积内容
    streamingMessageId: string | null; // 当前流式消息 ID
    /** 统一权限卡片状态（pending 单例 + 历史） */
    permission: { pending: PermissionCard | null; queue: PermissionCard[]; history: PermissionCard[] };
    /** Token 使用量统计 */
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      cachedTokens: number;
    };
    /** 上下文压缩状态 */
    context: {
      isCompacting: boolean;
      lastCompaction?: {
        removedCount: number;
        tokensSaved: number;
        timestamp: string;
      };
    };
  };

  debug: {
    traces: TraceEvent[];
    filter: TraceFilter;
  };

  config: {
    provider: string;
    model: string;
    mode?: string;
    permissionMode: string;
    maxSteps: number;
    defaultRole: string;
    childAgentTimeout: number;
    debug: boolean;
  };

  // 完整配置信息
  fullConfig: TuiFullConfig;

  // 配置编辑状态
  configEdit: ConfigEdit;
  configHasChanges: boolean; // 配置是否有未保存的更改

  // Session 元数据
  sessionMetadata: {
    id: string;
    providerId: string;
  };
}

/**
 * Logs page filter state.
 *
 * 字段全部可选；未设置意味着对应维度不过滤（level 默认 info, scope/sessionId
 * 默认全收）。
 *
 * 通过 `route-logs-command.ts` 的 `applyFilter` 增量更新。
 */
export type LogPageFilter = {
  level?: LogLevel;
  scope?: ReadonlySet<LogScope>;
  sessionId?: string;
};

// ============================================================
// Context
// ============================================================

interface AppContextValue {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  setCurrentPage: (page: PageName) => void;
  setFocusArea: (area: FocusArea) => void;
  setInputMode: (mode: boolean) => void;
  setExitConfirmPending: (pending: boolean) => void;
  /**
   * 切换 help dialog 视图。
   *
   * @param view - null 关闭,`'commands'` 显示命令参考
   */
  setShowHelp: (view: HelpView) => void;
  setFilterMode: (mode: boolean) => void;
  setEditMode: (mode: boolean) => void;
  updateConfig: (updates: Partial<AppState['config']>) => void;
  clearTraces: () => void;
  /** Logs page filter 增量更新。 */
  setLogPageFilter: (patch: Partial<LogPageFilter>) => void;
  /** 设置 AgentTabs 过滤模式（Main 选中时传 undefined 表示取消过滤）。 */
  setViewFilter: (filter: string | undefined) => void;
}

export const AppContext = React.createContext<AppContextValue | null>(null);

export function useAppContext(): AppContextValue {
  const context = React.useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppContext.Provider');
  }
  return context;
}
