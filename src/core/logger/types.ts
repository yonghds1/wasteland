/**
 * types.ts - 日志子系统核心类型定义
 *
 * 为 wasteland runtime 日志定义 schema 与字面量集合。本文件是 PR1 的唯一类型
 * 入口，被 memory-sink / log-bus / logger 共同依赖。
 *
 * 设计要点：
 * - 顶层字段顺序固定（与 PRD R12 一致），便于 grep/jq 切窗分析。
 * - 字段名采用 snake_case，对齐 Claude Code transcript 习惯（sessionId / turn /
 *   scope），方便 `claude-dev.tools` 一类第三方间接消费。
 * - `version: 1` 字段承诺 semver 演进，避免 Claude Code #53516 那种 schema
 *   breaking 痛苦。
 * - Zod schema 兜底运行时校验，仅暴露 schema 引用、不在此处做 instance check。
 */

import { z } from 'zod';

// ============================================================
// 字面量集合
// ============================================================

/**
 * 日志等级。
 *
 * 数值排序（用于 minLevel 过滤）：debug(0) < info(1) < warn(2) < error(3)。
 * 默认 level=info 时 debug 静默不写。
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Level 数值映射（用于 minLevel 比较）。
 *
 * 暴露为 `as const` 记录，避免调用方硬编码 magic number。
 */
export const LOG_LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

/**
 * 日志 scope 域。
 *
 * 标识事件来源的子系统。对齐 PRD R2 列出的 10 个 scope：
 * - session: 会话生命周期
 * - turn: 用户/AI 消息 turn
 * - provider: LLM provider 调用
 * - tool: 工具调用
 * - ui: UI 渲染事件
 * - skill: 技能系统
 * - permission: 权限闸门
 * - mcp: MCP 协议流量
 * - a2a: Agent-to-Agent 协议流量
 * - acp: Agent Client Protocol（stdio JSON-RPC）流量
 * - file: 文件审计（read/edit/write 路径追踪）
 */
export type LogScope =
  | 'session'
  | 'turn'
  | 'provider'
  | 'tool'
  | 'ui'
  | 'skill'
  | 'permission'
  | 'mcp'
  | 'a2a'
  | 'acp'
  | 'file';

// ============================================================
// 辅助类型：usage / timings
// ============================================================

/**
 * assistant 事件携带的 token 用量。
 *
 * 字段名与 Claude Code transcript 保持完全一致（input_tokens /
 * output_tokens / cache_creation_input_tokens / cache_read_input_tokens），
 * 便于跨 agent 工具间接消费。
 */
export type LogUsage = {
  /** 输入 token 数 */
  input_tokens: number;
  /** 输出 token 数 */
  output_tokens: number;
  /** 缓存创建 token 数（可选） */
  cache_creation_input_tokens?: number;
  /** 缓存读取 token 数（可选） */
  cache_read_input_tokens?: number;
};

/**
 * 工具事件 5 段时间分解。
 *
 * 借自 Claude Code `tengu_tool_use_success`：把一次工具调用的总耗时拆成
 * preHook（前置 hook）+ permission（权限判定）+ tool（工具本体）+ postHook
 * （后置 hook）+ total（端到端）五个阶段，便于定位慢工具。
 */
export type LogTimings = {
  /** 前置 hook 耗时（毫秒） */
  preHookMs: number;
  /** 权限判定耗时（毫秒） */
  permissionMs: number;
  /** 工具本体耗时（毫秒） */
  toolMs: number;
  /** 后置 hook 耗时（毫秒） */
  postHookMs: number;
  /** 端到端总耗时（毫秒） */
  totalMs: number;
};

/**
 * 错误事件 payload。
 *
 * 字段对齐 Claude Code `tengu_tool_use_error.error_top_frame`：
 * - `top_frame`: stack 首行（通常是 throw 现场），用于快速定位代码行
 * - `stack`: 完整 stack（可选，过大时可省略以省磁盘）
 */
export type LogError = {
  /** 错误名（Error.name） */
  name: string;
  /** 错误消息（Error.message） */
  message: string;
  /** stack 首行 / 抛出帧 */
  top_frame?: string;
  /** 完整 stack trace（可选） */
  stack?: string;
};

// ============================================================
// LogEntry
// ============================================================

/**
 * 运行时日志条目。
 *
 * 顶层字段顺序固定为：version, timestamp, level, scope, sessionId, turn?, step?,
 * message, data?, error?。`message` 强制单行（\n 已转义为 \\n），方便 grep。
 *
 * 关联字段：
 * - `usage` 放在 data 内部或顶层自由扩展（推荐 data.usage 避免污染固定字段）
 * - `timings` 同上（推荐 data.timings）
 *
 * 注意：本 PR1 不直接固定 usage/timings 顶层字段，调用方可通过 data 传递，
 * 既保持 schema 精简，又留出扩展空间。
 */
export type LogEntry = {
  /** schema 版本（承诺 semver 演进） */
  version: 1;
  /** 全局自增序列号，用于 UI 渲染的唯一 key 与精准排序 */
  seq?: number;
  /** 时间戳：ISO8601 UTC 毫秒精度 'YYYY-MM-DDTHH:mm:ss.sssZ' */
  timestamp: string;
  level: LogLevel;
  scope: LogScope;
  sessionId: string;
  turn?: number;
  step?: number;
  /** 单行消息（\n 已转义为 \\n） */
  message: string;
  /** 自由 JSON payload（tool input、timings、usage 等放这里） */
  data?: Record<string, unknown>;
  error?: LogError;
};

// ============================================================
// Zod 校验 schema
// ============================================================

/**
 * Zod schema：运行时校验 LogEntry 顶层字段。
 *
 * 用法：
 * ```ts
 * const parsed = logEntrySchema.safeParse(entry);
 * if (!parsed.success) { ... }
 * ```
 *
 * 字段顺序与 LogEntry type 一致；optional 字段用 `.optional()`。
 */
export const logEntrySchema = z.object({
  version: z.literal(1),
  seq: z.number().int().nonnegative().optional(),
  timestamp: z.string().min(1),
  level: z.enum(['debug', 'info', 'warn', 'error']),
  scope: z.enum([
    'session',
    'turn',
    'provider',
    'tool',
    'ui',
    'skill',
    'permission',
    'mcp',
    'a2a',
    'acp',
    'file',
  ]),
  sessionId: z.string().min(1),
  turn: z.number().int().nonnegative().optional(),
  step: z.number().int().nonnegative().optional(),
  message: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
  error: z
    .object({
      name: z.string(),
      message: z.string(),
      top_frame: z.string().optional(),
      stack: z.string().optional(),
    })
    .optional(),
});

/**
 * LogEntry 校验后的类型（z.infer）。
 */
export type LogEntryParsed = z.infer<typeof logEntrySchema>;

/**
 * Logger.debug/info/warn/error 的入参类型。
 *
 * 调用方只需提供 sessionId、message 与可选 data / error / turn / step；level /
 * timestamp / version 由 Logger 自动注入。
 */
export type LogEntryInput = Omit<LogEntry, 'version' | 'timestamp' | 'level'> & {
  sessionId: string;
};

/**
 * 错误参数可接受 Error 实例或 LogError 结构体。
 *
 * Logger 内部会把 Error 转换为 { name, message, stack, top_frame }。
 */
export type LogErrorInput = Error | LogError;
