import type { PermissionMode } from '@core/engine/permission-gate.js';
import type { PromptTemplateRef } from './prompts/prompt-types.js';
import type { RoleDefinition } from './roles/types.js';
import { DEFAULT_LANGUAGE } from '@locales/index.js';
import { wastelandTheme } from '@theme/wasteland/index.js';

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
  /** context window 大小（token 数），用于自动压缩。未设置时使用内置默认值。 */
  contextWindow?: number;
  [key: string]: unknown;
};
export type RoleSettings = {
  model?: string;
  permissionMode?: PermissionMode;
  /** @deprecated 使用 promptTemplate 代替 */
  prompt?: string;
  /** 提示词模板（支持字符串 ID、文件路径、内联定义） */
  promptTemplate?: PromptTemplateRef;
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

// ============================================================
// ACP（Agent Client Protocol）配置块
// ============================================================

/**
 * ACP Agent 配置（stdio JSON-RPC 子进程形态的远程 agent）
 *
 * 每个配置的 agent 成为一个直接工具 `acp_<name>`。agent 以子进程启动，
 * 本地信任模型，`command/args/env/cwd` 即全部连接参数。
 */
export type AcpAgentConfig = {
  /** Agent 名称（工具名后缀：acp_<name>，字符集 ^[A-Za-z0-9_-]+$） */
  name: string;
  /** 启动命令（如 `npx`；需是 PATH 可解析的可执行文件） */
  command: string;
  /** 命令参数（如 ['-y', '@agentclientprotocol/claude-agent-acp']） */
  args?: string[];
  /** 追加到子进程的环境变量（继承 process.env，CLAUDE_CODE_* 被自动剔除） */
  env?: Record<string, string>;
  /** 子进程工作目录，默认取运行时 context.cwd */
  cwd?: string;
  /** 描述（供 LLM 发现工具用途） */
  description?: string;
  /** 单次任务超时（毫秒），覆盖 acp.defaults.timeoutMs */
  timeoutMs?: number;
};

/**
 * ACP 顶层配置块
 *
 * - `agents`：出站调用的 agent 列表，每个成为工具 `acp_<name>`。
 * - `defaults`：全局超时等默认值。
 */
export type ACPSettings = {
  agents: AcpAgentConfig[];
  defaults?: {
    /** prompt 执行超时（毫秒），默认 300000（编码任务长） */
    timeoutMs?: number;
  };
};

/**
 * 子角色配置
 * 角色均可被用户自定义覆盖或新增（含主角色 orchestrator）
 */
export type SubAgentSettings = RoleSettings & {
  /**
   * 角色引用（可选）。
   *
   * 引用 `roles.json` 中定义的可复用角色（如 `"researcher"`）。
   * 加载时会把角色定义展开合并进本条目（本条目显式字段优先）。
   * 未提供时保持内联定义（向后兼容）。
   */
  role?: string;
  /**
   * 子 Agent 内容 skin 候选列表。
   *
   * 每次 spawn_agent 时从中随机选一个可用（未占用）的 skin 注入 persona。
   * SkinOccupancy 防止同一 skin 同时被多个 session 占用。
   * 候选列表为空或全部被占用时 fallback 到 defaultRoleSkin（'warlord-immortal'）。
   */
  skins?: string[];
  /**
   * @deprecated 使用 skins 候选列表代替单值 skin
   * 单值 skin 仍受支持（向后兼容），但新配置应使用 skins 列表。
   */
  skin?: string;
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
  /** 失败时切换到的备用模型（可选） */
  fallbackModel?: string;
  /** 可用工具列表（逗号分隔字符串或数组） */
  tools?: string | string[];
};

export type RawWastelandSettings = {
  defaultProvider?: string;
  providers?: Record<string, ProviderSettings>;
  models?: Record<string, ModelSettings>;
  /**
   * 多 agent 模式配置
   * 用户可在此配置自定义角色或覆盖内置角色（含主角色 orchestrator）
   */
  multiAgent?: Record<string, SubAgentSettings>;
  /**
   * 单 agent 模式配置
   */
  singleAgent?: {
    model?: string;
    skin?: string;
    promptTemplate?: string;
  };
  /**
   * 角色定义（可选，与 roles.json 合并）
   *
   * 每个角色是一份可复用的完整定义（promptTemplate / tools / model / skins 等）。
   * 主要来源是 `.wasteland/roles.json`；此处作为内联补充，加载时合并。
   */
  roles?: Record<string, RoleDefinition>;
  runtime?: {
    defaultRole?: string;
    /** 皮肤主题 id，默认 warlord-immortal，与角色独立 */
    skinId?: string;
    /** 运行模式：single（单 agent）或多 agent（multi） */
    mode?: 'single' | 'multi';
    defaultModel?: string;
    permissionMode?: PermissionMode;
    maxStepsPerTurn?: number;
    childAgentTimeout?: number;
    /**
     * 压缩预算占比（0-1，默认 0.6）：contextWindow × compactionBudgetRatio = 压缩目标预算。
     * 压缩后保留窗口的 token 预算按此比例缩放，超出 (0,1] 区间的值在加载时报错。
     */
    compactionBudgetRatio?: number;
    /**
     * 触发上下文压缩的阈值（0-1，默认 0.8）。
     * 当前 token 使用量（prompt + history）占 context window 的比例超过该值时压缩。
     * 越小越早压缩（保留更少上下文），越大越晚（更省 token 但更接近窗口上限）。
     */
    compactionThreshold?: number;
    /**
     * 触发异步摘要压缩的高水位阈值（0-1，默认 0.95）。
     * 与 compactionThreshold（低水位，同步滑动切割安全网）构成缓冲带：
     * 使用量超过低水位先做便宜的同步切割，冲到高水位才用 LLM 生成摘要，
     * 避免"先切掉再摘要"导致摘要丢失本该保留的早期上下文。
     * 必须 >= compactionThreshold。
     */
    summarizationThreshold?: number;
    /**
     * 是否注入项目记忆（memory.md）到 system prompt 最前面，默认 true。
     * 关闭则不在会话启动时读取/注入 .wasteland/memory.md。
     */
    projectMemory?: boolean;
    /**
     * 压缩时是否用 LLM 生成摘要替代直接丢弃（默认 true）。
     * 关闭则退回纯滑动窗口压缩。摘要失败时自动降级。
     */
    contextSummarization?: boolean;
    /**
     * prompt 格式：'markdown'（## 标题）或 'xml'（<section> 标签），默认 'markdown'。
     * OpenAI 格式 API 用 markdown 更自然，XML 语义更清晰。
     */
    promptFormat?: 'markdown' | 'xml';
    /**
     * 全局 prompt 模板覆盖（优先级低于 roles[name].promptTemplate）
     * 可以是内置模板 ID（如 'role-orchestrator'）或自定义模板
     */
    promptTemplate?: PromptTemplateRef;
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
    /**
     * 日志系统配置（PR3 引入）。
     *
     * level 决定 Logger 的最低 entry 等级（debug < info < warn < error）。
     * dir：历史默认 `.wasteland/logs`（当前 FileSink 实际落盘走 WASTELAND_LOG_DIR / paths 解析，
     * 本字段仅保留作配置面兼容，改它不影响落盘位置）。
     * redact 关闭敏感字段脱敏（默认 true，强烈建议保持）。
     * tailLines 控制 TUI 日志页与 `wasteland logs tail` 默认展示条数。
     */
    log?: {
      level?: 'debug' | 'info' | 'warn' | 'error';
      dir?: string;
      redact?: boolean;
      tailLines?: number;
    };
  };
  /** MCP 服务器配置 */
  mcpServers?: MCPServersConfig;
  /**
   * 已废弃的 A2A 配置块（原样透传，不校验、不进 resolved）。
   * 仅供 load-settings 检测后打印一次性迁移提示。
   */
  a2a?: unknown;
  /** ACP 配置块（stdio 子进程 agent 出站调用；A2A 的替代） */
  acp?: ACPSettings;
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
  multiAgent: Record<string, SubAgentSettings>;
  /**
   * 单 agent 模式配置
   */
  singleAgent?: {
    model?: string;
    skin?: string;
    promptTemplate?: string;
  };
  /**
   * 角色定义（解析后，与 roles.json 合并）
   */
  roles?: Record<string, RoleDefinition>;
  runtime: {
    defaultRole?: string;
    /** 皮肤主题 id，默认 warlord-immortal，与角色独立 */
    skinId: string;
    /** 运行模式：single（单 agent）或多 agent（multi） */
    mode: 'single' | 'multi';
    defaultModel?: string;
    permissionMode: PermissionMode;
    maxStepsPerTurn: number;
    childAgentTimeout: number;
    /** 压缩预算占比（0-1），默认 0.6：contextWindow × compactionBudgetRatio = 压缩目标预算 */
    compactionBudgetRatio: number;
    /** 触发压缩的阈值（0-1），默认 0.8 */
    compactionThreshold: number;
    /** 触发异步摘要压缩的高水位（0-1），默认 0.95 */
    summarizationThreshold: number;
    /** 是否注入项目记忆（memory.md），默认 true */
    projectMemory: boolean;
    /** 压缩时是否用 LLM 生成摘要替代直接丢弃，默认 true */
    contextSummarization: boolean;
    /** prompt 格式：'markdown'（## 标题）或 'xml'（<section> 标签），默认 'markdown' */
    promptFormat: 'markdown' | 'xml';
    /** 全局 prompt 模板覆盖（优先级低于 roles[name].promptTemplate） */
    promptTemplate?: PromptTemplateRef;
    debug: boolean;
    /** 语言设置，默认 en */
    language: string;
    /** 是否在 UI 上展示思考块，默认 true */
    showThinking: boolean;
    /** Spinner 帧切换间隔（毫秒），默认 80 */
    spinnerIntervalMs: number;
    /** 打字机逐字符揭示间隔（毫秒），默认 30 */
    typewriterRateMs: number;
    /** 日志系统配置 */
    log: {
      level: 'debug' | 'info' | 'warn' | 'error';
      dir: string;
      redact: boolean;
      tailLines: number;
    };
  };
  mcpServers: MCPServersConfig;
  /** ACP 配置块（stdio 子进程 agent），默认 { agents: [] } */
  acp: ACPSettings;
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
  /** 合并后的项目记忆文本（memory.md），无记忆时为空字符串 */
  memory: string;
};

export const DEFAULT_WASTELAND_SETTINGS: ResolvedWastelandSettings = {
  defaultProvider: 'local',
  providers: {},
  models: {},
  multiAgent: {},
  runtime: {
    defaultRole: 'orchestrator',
    skinId: 'warlord-immortal',
    mode: 'single',
    permissionMode: 'default',
    maxStepsPerTurn: 30,
    childAgentTimeout: 600000,
    compactionBudgetRatio: 0.6,
    compactionThreshold: 0.8,
    summarizationThreshold: 0.95,
    projectMemory: true,
    contextSummarization: true,
    promptFormat: 'markdown',
    debug: false,
    language: DEFAULT_LANGUAGE,
    showThinking: true,
    spinnerIntervalMs: wastelandTheme.animations.spinnerIntervalMs,
    typewriterRateMs: wastelandTheme.animations.typewriterRateMs,
    log: {
      level: 'info',
      // 历史默认值（当前落盘走 paths 解析，本字段仅配置面兼容，见上）。
      dir: '.wasteland/logs',
      redact: true,
      tailLines: 50,
    },
  },
  mcpServers: {},
  acp: {
    agents: [],
  },
  parallel: {
    maxConcurrency: -1,
  },
};
