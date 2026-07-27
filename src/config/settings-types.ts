import type { PermissionMode } from '../core/runtime/permission-gate.js';
import type { PromptTemplateRef } from '../prompts/prompt-types.js';
import { DEFAULT_LANGUAGE } from '../locales/index.js';

export type AuthRef = {
  $auth: string;
};

export type AuthSettings = Record<string, string>;
/**
 * Provider 配置
 *
 * @property type - API 协议/格式（openai-compatible、anthropic、local）
 *                  如果未指定，使用 provider ID 作为默认值（向后兼容）
 * @property baseUrl - API 端点地址
 * @property apiKey - API 密钥（或 $auth 引用，Ollama 等本地服务可选）
 * @property model - 模型名称（可选，可被 model 配置覆盖）
 */
export type ProviderSettings = {
  /** API 协议/格式：openai-compatible、anthropic、local */
  type?: string;
  /** API 端点地址 */
  baseUrl?: string;
  /** API 密钥 */
  apiKey?: string | { $auth: string };
  /** 模型名称 */
  model?: string;
  [key: string]: unknown;
};
export type ModelSettings = {
  provider: string;
  model: string;
  capabilities?: string[];
  [key: string]: unknown;
};
export type RoleSettings = {
  model?: string;
  permissionMode?: PermissionMode;
  /** @deprecated 使用 promptTemplate 代替 */
  prompt?: string;
  /** 提示词模板（支持字符串 ID、文件路径、内联定义） */
  promptTemplate?: PromptTemplateRef;
  /** 提示词变量覆盖 */
  promptVariables?: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * MCP 服务器配置
 */
export type MCPServerConfig = {
  /** 命令路径 */
  command: string;
  /** 命令参数 */
  args?: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 工作目录 */
  cwd?: string;
  /** 启动超时（毫秒） */
  startupTimeout?: number;
  /** 请求超时（毫秒） */
  requestTimeout?: number;
};

/**
 * MCP 服务器配置映射
 */
export type MCPServersConfig = Record<string, MCPServerConfig>;

/**
 * A2A Agent 配置
 */
export type A2AAgentConfig = {
  /** Agent 名称 */
  name: string;
  /** Agent 端点 URL */
  url: string;
  /** 可选：认证 token */
  token?: string;
};

/**
 * A2A Agent 配置列表
 */
export type A2AAgentsConfig = A2AAgentConfig[];

/**
 * 子角色配置
 * 角色均可被用户自定义覆盖或新增（含主角色 orchestrator）
 */
export type SubAgentSettings = RoleSettings & {
  /** 子角色描述，用于配置页面显示 */
  description?: string;
  /**
   * 子 agent 失败时自动重试次数（0 = 不重试，默认 0）
   * 失败场景：超时 / minimax 无返回 / 子 agent 异常
   * 重试策略：指数退避（retryDelayMs * 2^(attempt-1)）
   * 全部失败后 error 写回主 agent，避免 minimax 自己脑补
   */
  maxRetries?: number;
  /** 重试间隔（毫秒），默认 1000 */
  retryDelayMs?: number;
};

export type RawWastelandSettings = {
  defaultProvider?: string;
  providers?: Record<string, ProviderSettings>;
  models?: Record<string, ModelSettings>;
  /**
   * 角色配置
   * 用户可在此配置自定义角色或覆盖内置角色（含主角色 orchestrator）
   */
  subAgents?: Record<string, SubAgentSettings>;
  runtime?: {
    defaultRole?: string;
    /** 皮肤主题 id，默认 immortan-joe，与角色独立 */
    skinId?: string;
    defaultModel?: string;
    permissionMode?: PermissionMode;
    maxStepsPerTurn?: number;
    maxTurns?: number;
    childAgentTimeout?: number;
    debug?: boolean;
    /** 语言设置，默认 en */
    language?: string;
    /**
     * 是否在 UI 上展示模型的 <think> 思考块
     * （minimax/DeepSeek R1/QwQ 等会把思考拼到 content 里）
     * 默认 true，与 Claude Code / OpenCode 一致
     */
    showThinking?: boolean;
    /**
     * Spinner 帧切换间隔（毫秒），默认 80
     * 有效范围 16-1000（16ms ≈ 60fps 上限，1000ms ≈ 慢速）
     */
    spinnerIntervalMs?: number;
    /**
     * 打字机逐字符揭示间隔（毫秒），默认 30
     * 有效范围 5-200（5ms ≈ 极快，30ms ≈ ChatGPT 默认，200ms ≈ 慢速）
     * 控制客户端逐字符显示的节奏，与服务端 chunk 粒度解耦
     */
    typewriterRateMs?: number;
  };
  /** MCP 服务器配置 */
  mcpServers?: MCPServersConfig;
  /** A2A Agent 配置 */
  a2aAgents?: A2AAgentsConfig;
  /** 并行执行配置 */
  parallel?: {
    /** 最大并发数，-1 表示无限制，默认 -1 */
    maxConcurrency?: number;
  };
};

export type ResolvedWastelandSettings = {
  defaultProvider: string;
  providers: Record<string, ProviderSettings>;
  models: Record<string, ModelSettings>;
  /**
   * 角色配置（解析后）
   * 用户可覆盖内置角色或新增角色
   */
  subAgents: Record<string, SubAgentSettings>;
  runtime: {
    defaultRole?: string;
    /** 皮肤主题 id，默认 immortan-joe，与角色独立 */
    skinId: string;
    defaultModel?: string;
    permissionMode: PermissionMode;
    maxStepsPerTurn: number;
    maxTurns: number;
    childAgentTimeout: number;
    debug: boolean;
    /** 语言设置，默认 en */
    language: string;
    /** 是否在 UI 上展示思考块，默认 true */
    showThinking: boolean;
    /** Spinner 帧切换间隔（毫秒），默认 80 */
    spinnerIntervalMs: number;
    /** 打字机逐字符揭示间隔（毫秒），默认 30 */
    typewriterRateMs: number;
  };
  mcpServers: MCPServersConfig;
  a2aAgents: A2AAgentsConfig;
  parallel: {
    maxConcurrency: number;
  };
};

export type LoadedWastelandSettings = {
  settings: ResolvedWastelandSettings;
  sources: {
    user?: string;
    project?: string;
    userAuth?: string;
    projectAuth?: string;
  };
  projectConfigDir: string | null;
  userConfigDir: string;
};

export const DEFAULT_WASTELAND_SETTINGS: ResolvedWastelandSettings = {
  defaultProvider: 'local',
  providers: {},
  models: {},
  subAgents: {},
  runtime: {
    defaultRole: 'orchestrator',
    skinId: 'immortan-joe',
    permissionMode: 'default',
    maxStepsPerTurn: 8,
    maxTurns: 20,
    childAgentTimeout: 120000,
    debug: false,
    language: DEFAULT_LANGUAGE,
    showThinking: true,
    spinnerIntervalMs: 80,
    typewriterRateMs: 30,
  },
  mcpServers: {},
  a2aAgents: [],
  parallel: {
    maxConcurrency: -1,
  },
};
