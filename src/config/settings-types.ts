import type { PermissionMode } from "../runtime/permission-gate.js";
import type { PromptTemplateRef } from "../prompts/prompt-types.js";

export type AuthRef = {
  $auth: string;
};

export type AuthSettings = Record<string, string>;
export type ProviderSettings = Record<string, unknown>;
export type ModelSettings = {
  provider: string;
  model: string;
  capabilities?: string[];
  [key: string]: unknown;
};
export type RoleSettings = {
  model: string;
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

export type RawRxcSettings = {
  defaultProvider?: string;
  providers?: Record<string, ProviderSettings>;
  models?: Record<string, ModelSettings>;
  roles?: Record<string, RoleSettings>;
  runtime?: {
    defaultRole?: string;
    permissionMode?: PermissionMode;
    maxStepsPerTurn?: number;
    maxTurns?: number;
    childAgentTimeout?: number;
    debug?: boolean;
  };
  /** MCP 服务器配置 */
  mcpServers?: MCPServersConfig;
};

export type ResolvedRxcSettings = {
  defaultProvider: string;
  providers: Record<string, ProviderSettings>;
  models: Record<string, ModelSettings>;
  roles: Record<string, RoleSettings>;
  runtime: {
    defaultRole?: string;
    permissionMode: PermissionMode;
    maxStepsPerTurn: number;
    maxTurns: number;
    childAgentTimeout: number;
    debug: boolean;
  };
  mcpServers: MCPServersConfig;
};

export type LoadedRxcSettings = {
  settings: ResolvedRxcSettings;
  sources: {
    user?: string;
    project?: string;
    userAuth?: string;
    projectAuth?: string;
  };
  projectConfigDir: string | null;
  userConfigDir: string;
};

export const DEFAULT_RXC_SETTINGS: ResolvedRxcSettings = {
  defaultProvider: "local",
  providers: {},
  models: {},
  roles: {},
  runtime: {
    defaultRole: undefined,
    permissionMode: "default",
    maxStepsPerTurn: 8,
    maxTurns: 20,
    childAgentTimeout: 120000,
    debug: false,
  },
  mcpServers: {},
};
