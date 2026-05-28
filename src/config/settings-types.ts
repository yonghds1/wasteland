import type { PermissionMode } from "../runtime/permission-gate.js";
import type { PromptTemplateRef } from "../prompts/prompt-types.js";

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
 * 子角色配置
 * 子角色可以被用户自定义覆盖，但主角色 immortan-joe 完全内置不可覆盖
 */
export type SubAgentSettings = RoleSettings & {
  /** 子角色描述，用于配置页面显示 */
  description?: string;
};

export type RawJoeSettings = {
  defaultProvider?: string;
  providers?: Record<string, ProviderSettings>;
  models?: Record<string, ModelSettings>;
  /**
   * 子角色配置
   * 注意：主角色 immortan-joe 完全内置，不在此配置中
   * 用户可以在此配置自定义子角色或覆盖内置子角色
   */
  subAgents?: Record<string, SubAgentSettings>;
  runtime?: {
    defaultRole?: string;
    defaultModel?: string;
    permissionMode?: PermissionMode;
    maxStepsPerTurn?: number;
    maxTurns?: number;
    childAgentTimeout?: number;
    debug?: boolean;
  };
  /** MCP 服务器配置 */
  mcpServers?: MCPServersConfig;
};

export type ResolvedJoeSettings = {
  defaultProvider: string;
  providers: Record<string, ProviderSettings>;
  models: Record<string, ModelSettings>;
  /**
   * 子角色配置（解析后）
   * 主角色 immortan-joe 完全内置，不在此配置中
   */
  subAgents: Record<string, SubAgentSettings>;
  runtime: {
    defaultRole?: string;
    defaultModel?: string;
    permissionMode: PermissionMode;
    maxStepsPerTurn: number;
    maxTurns: number;
    childAgentTimeout: number;
    debug: boolean;
  };
  mcpServers: MCPServersConfig;
};

export type LoadedJoeSettings = {
  settings: ResolvedJoeSettings;
  sources: {
    user?: string;
    project?: string;
    userAuth?: string;
    projectAuth?: string;
  };
  projectConfigDir: string | null;
  userConfigDir: string;
};

export const DEFAULT_JOE_SETTINGS: ResolvedJoeSettings = {
  defaultProvider: "local",
  providers: {},
  models: {},
  subAgents: {},
  runtime: {
    defaultRole: "immortan-joe",
    permissionMode: "default",
    maxStepsPerTurn: 8,
    maxTurns: 20,
    childAgentTimeout: 120000,
    debug: false,
  },
  mcpServers: {},
};
