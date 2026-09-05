/**
 * spawn-agent/types.ts - 子 Agent 创建与事件转发的共享类型
 *
 * 本文件抽出 spawn-agent 子目录各模块共用的类型定义。
 * SpawnAgentContext 是子 Agent 执行的上下文（来自父 session）；
 * 其它子模块需要的窄类型在此集中定义，避免 import 循环。
 */

import type { SessionMetadata } from '@core/runtime/session-manager.js';
import type {
  HistoryRecord,
  SessionMessageRecord,
  SessionToolResultRecord,
  RuntimeEvent,
} from '@core/runtime/event-types.js';
import type { AgentTool, JsonSchema, ToolCall } from '../tool-types.js';
import type { AgentProvider } from '@providers/provider-types.js';
import type { SessionManager } from '@core/runtime/session-manager.js';
import { ToolRegistry } from '../tool-registry.js';
import type { PermissionGate } from '@core/runtime/permission-gate.js';
import type { UserInputBridge } from '@core/runtime/user-input-bridge.js';
import type {
  ProviderSettings,
  LoadedWastelandSettings,
} from '@config/settings-types.js';
import type { ProviderRegistry } from '@providers/provider-registry.js';
import { Observable } from 'rxjs';

/** 子 Agent 最大嵌套深度（防止递归 spawn 耗尽资源） */
export const MAX_SPAWN_DEPTH = 3;

/** 子 Agent 工具调用的窄类型（input 不能保证是 SpawnAgentInput） */
export type SpawnAgentCall = ToolCall;

/** 子 Agent 安全参数化输入（来自 input-parser） */
export type ParsedSpawnInput = {
  /** 解析+校验后的输入字段 */
  childName: string;
  childTask: string;
  model: string | undefined;
  tools: string[] | undefined;
  inheritHistory: boolean;
};

/** input-parser 输出的子 agent 解析配置 */
export type ResolvedSubAgentInput = {
  /** 来自 settings.json multiAgent[name] */
  subAgentConfig: LoadedWastelandSettings['settings']['multiAgent'][string] | undefined;
  /** maxRetries（默认 0） */
  maxRetries: number;
  /** retryDelayMs（默认 1000） */
  retryDelayMs: number;
  /** 备用模型（可选，失败时切换） */
  fallbackModel?: string;
  /** 工具优先级解析结果：multiAgent > minimax > 全集 */
  effectiveTools: string[] | undefined;
  /** 模型优先级解析结果：subAgentConfigModel > minimax.model */
  effectiveModel: string | undefined;
  /** 经 alias 解析后的最终模型（undefined 表示用父 provider 默认） */
  resolvedModelAlias: string | undefined;
  /** 是否使用 multiAgent.model 路径（用于日志/下游判断） */
  subAgentConfigModelUsed: boolean;
  /** 子 Agent 嵌套深度（父深度 + 1） */
  depth: number;
};

/** input-parser 输入参数 */
export type ParseInputParams = {
  childName: string;
  model: string | undefined;
  tools: string[] | undefined;
  context: SpawnAgentContext;
};

/**
 * spawn_agent 工具的执行上下文
 *
 * 与父 agent 共享：sessionManager / provider / toolRegistry / permissionGate /
 * userInputBridge / loadedSettings；unique per spawn：childAgentTimeout / depth。
 */
export type SpawnAgentContext = {
  sessionId: string;
  turn: number;
  cwd: string;
  session: SessionMetadata;
  sessionManager: SessionManager;
  provider: AgentProvider;
  toolRegistry?: ToolRegistry;
  permissionGate?: PermissionGate;
  history: HistoryRecord[];
  /** 可选：Provider 注册表，用于根据 model 参数创建新的 Provider */
  providerRegistry?: ProviderRegistry;
  /** 可选：当前 Provider 的配置，用于创建新 Provider 时继承配置 */
  providerSettings?: ProviderSettings;
  /** 子 Agent 执行超时（毫秒），默认 600000 */
  childAgentTimeout?: number;
  /** 当前 spawn 嵌套深度（0 = 顶层 agent 调用） */
  depth?: number;
  /** 可选：用户输入桥接器，复用父 Agent 的 bridge 以支持子 Agent 内的 ask-user 与权限询问 */
  userInputBridge?: UserInputBridge;
  /** 可选：完整 loadedSettings，用于读 multiAgent 配置（实现重试 + 角色注入） */
  loadedSettings?: LoadedWastelandSettings;
};

/** spawn_agent 事件转发外层入口的返回值类型（event-forwarder 输出） */
export type ForwardedEventStream = Observable<RuntimeEvent>;

/** 子 agent runAgentLoop 调用的关键参数（context-builder 输出） */
export type ResolvedChildSetup = {
  childSessionId: string;
  childInput$: Observable<{
    turn: number;
    content: string;
    source: 'message';
  }>;
  childToolRegistry: ToolRegistry | undefined;
  childProvider: AgentProvider;
  /** 子 agent 的 providerSettings（含子模型名，供 context window 解析；继承父时为 undefined） */
  childProviderSettings?: SpawnAgentContext['providerSettings'];
  subAgentPrompt: string | undefined;
};

/** 子 Agent 完成后 forwarder 状态机 finish 三态 */
export type FinishStatus = 'success' | 'error' | 'timeout';

/** 子 Agent 完成后写回父 session 的工具结果记录 */
export type SessionRecordPair = {
  toolCallEvent: RuntimeEvent;
  resultRecord: SessionToolResultRecord | RuntimeEvent;
};

/* 重新导出高频用到的运行时类型，方便外部模块从 spawn-agent/types 一处导入 */
export type {
  AgentTool,
  JsonSchema,
  SessionMessageRecord,
  RuntimeEvent,
  LoadedWastelandSettings,
  ProviderSettings,
  ProviderRegistry,
  PermissionGate,
  UserInputBridge,
  SessionManager,
  AgentProvider,
  SessionMetadata,
  ToolRegistry,
};
