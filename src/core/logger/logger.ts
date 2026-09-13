/**
 * logger.ts - 静态 Logger 门面 + 默认 LogBus 单例
 *
 * 为 core 内各调用点提供无注入的 `Logger.debug / info / warn / error` 静态入口，
 * 内部走模块级 LogBus 单例。复用时序：
 *
 *   Logger.debug({ sessionId, scope, message }) →
 *     level filter（< minLevel 直接 drop）→
 *     补 version:1 / timestamp / message 单行化 / Error → LogError 转换 →
 *     bus.publish(entry) → 全部订阅者收
 *
 * 默认行为：
 * - 不调用 setLevel 时，minLevel = 'info'（debug 静默不写）
 * - 不调用 setBus 时，publish 直接 drop（无 sink 接收）
 * - 不依赖 WASTELAND_* env（env 解析留 PR2，本 PR 仅保留 setEnv 钩子）
 *
 * 单例的代价：测试需要调用 reset() 重置状态。
 */

import type { LogBus } from './log-bus.js';
import { ChildLogger } from './child-logger.js';
import type { LogEntry, LogEntryInput, LogErrorInput, LogLevel, LogScope } from './types.js';
import { LOG_LEVEL_RANK } from './types.js';

// ============================================================
// 模块级单例状态
// ============================================================

/** 默认 LogBus 实例（首次 setBus 时初始化） */
let defaultBus: LogBus | null = null;

/** 全局最低 level（默认 info） */
let minLevel: LogLevel = 'info';

/** env 钩子（PR1 占位，PR2 真正生效） */
let envConfig: {
  level?: LogLevel;
  redact?: boolean;
  dir?: string;
  tailLines?: number;
} = {};

// ============================================================
// 工具函数
// ============================================================

/**
 * 把 message 中的换行符替换为 \\n，保证每条 entry 单行 JSONL。
 */
function escapeMessage(message: string): string {
  return message.replace(/\r?\n/g, '\\n');
}

/**
 * 提取 stack 的首行（去掉 "Error: " 前缀后）。
 */
function topFrameOf(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  const firstLine = stack.split('\n', 1)[0]?.trim();
  return firstLine || undefined;
}

/**
 * 转换 error 参数为 LogError 结构体。
 */
function normalizeError(input: LogErrorInput): {
  name: string;
  message: string;
  top_frame?: string;
  stack?: string;
} {
  if (input instanceof Error) {
    return {
      name: input.name,
      message: input.message,
      top_frame: topFrameOf(input.stack),
      stack: input.stack,
    };
  }
  return {
    name: input.name,
    message: input.message,
    top_frame: input.top_frame,
    stack: input.stack,
  };
}

import { redactObject, defaultRedactionRules } from './redactor.js';

let globalSeq = 0;
const globalRules = defaultRedactionRules();

/**
 * 补全 LogEntry 的系统字段（version / timestamp / seq），并执行全局数据脱敏。
 */
function finalizeEntry(input: LogEntryInput, level: LogLevel): LogEntry {
  const safeData = input.data ? redactObject(input.data, globalRules) : undefined;
  return {
    version: 1,
    seq: ++globalSeq,
    timestamp: new Date().toISOString(),
    level,
    scope: input.scope,
    sessionId: input.sessionId,
    turn: input.turn,
    step: input.step,
    message: escapeMessage(input.message),
    data: safeData,
    error: input.error ? normalizeError(input.error) : undefined,
  };
}

/**
 * 是否 entry 等级 ≥ 当前 minLevel（数值排序：debug=0 < info=1 < warn=2 < error=3）。
 */
function meetsMinLevel(level: LogLevel): boolean {
  return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[minLevel];
}

// ============================================================
// Logger 静态门面
// ============================================================

/**
 * 静态 Logger 门面。
 *
 * 调用 `Logger.setBus(bus)` 后 `Logger.debug/info/warn/error` 才会真正把 entry
 * 推到 bus。`setLevel` 调整最低 level，level < minLevel 的 entry 直接 drop。
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class Logger {
  /**
   * 注入默认 LogBus。多次调用会覆盖前一个。
   */
  static setBus(bus: LogBus): void {
    defaultBus = bus;
  }

  /**
   * 获取当前默认 LogBus（测试用）。
   */
  static getBus(): LogBus | null {
    return defaultBus;
  }

  /**
   * 设置最低 level。低于此 level 的 entry 直接 drop。
   *
   * 默认 'info'。传 'debug' 启用 debug 落盘。
   */
  static setLevel(level: LogLevel): void {
    minLevel = level;
  }

  /**
   * 获取当前最低 level。
   */
  static getLevel(): LogLevel {
    return minLevel;
  }

  /**
   * 设置 env 配置（PR1 占位；PR2 解析 WASTELAND_LOG_* env）。
   */
  static setEnv(env: {
    level?: LogLevel;
    redact?: boolean;
    dir?: string;
    tailLines?: number;
  }): void {
    envConfig = { ...envConfig, ...env };
    if (env.level) {
      minLevel = env.level;
    }
  }

  /**
   * 获取当前 env 配置（只读快照）。
   */
  static getEnv(): Readonly<typeof envConfig> {
    return { ...envConfig };
  }

  /**
   * 写一条 debug entry。
   *
   * 当 minLevel > 'debug' 时直接 no-op（节省 object literal 构造开销）。
   */
  static debug(entry: LogEntryInput): void {
    if (!meetsMinLevel('debug')) return;
    if (!defaultBus) return;
    defaultBus.publish(finalizeEntry(entry, 'debug'));
  }

  /**
   * 写一条 info entry。
   */
  static info(entry: LogEntryInput): void {
    if (!meetsMinLevel('info')) return;
    if (!defaultBus) return;
    defaultBus.publish(finalizeEntry(entry, 'info'));
  }

  /**
   * 写一条 warn entry。
   */
  static warn(entry: LogEntryInput): void {
    if (!meetsMinLevel('warn')) return;
    if (!defaultBus) return;
    defaultBus.publish(finalizeEntry(entry, 'warn'));
  }

  /**
   * 写一条 error entry。
   *
   * error 永远会通过 level filter（error rank 最高）；bus 未注入时仍 no-op。
   */
  static error(entry: LogEntryInput): void {
    if (!meetsMinLevel('error')) return;
    if (!defaultBus) return;
    defaultBus.publish(finalizeEntry(entry, 'error'));
  }

  /**
   * 重置单例状态（仅测试用）。
   *
   * 生产代码不应调用。
   */
  static reset(): void {
    if (defaultBus) {
      defaultBus.shutdown();
    }
    defaultBus = null;
    minLevel = 'info';
    envConfig = {};
  }

  /**
   * 当前是否启用了 bus（用于测试 assert）。
   */
  static hasBus(): boolean {
    return defaultBus !== null;
  }

  /**
   * 暴露 LogScope 列表（便于调用方传 scope 时不写死字符串）。
   *
   * 与 types.ts 的 LogScope 同步：session/turn/provider/tool/ui/skill/
   * permission/mcp/acp/file。
   */
  static readonly scopes: readonly LogScope[] = [
    'session',
    'turn',
    'provider',
    'tool',
    'ui',
    'skill',
    'permission',
    'mcp',
    'acp',
    'file',
  ];

  /**
   * 创建子 Logger，继承父级 context（sessionId / turn / scope / data）。
   *
   * 子 Logger 自动继承传入的 context 字段；调用方后续 debug/info/warn/error 时无需
   * 重复这些样板字段。子 Logger 是不可变的；修改父级不影响已创建的子 Logger。
   *
   * @param context - 子 Logger 继承的上下文字段
   * @returns 子 Logger 实例
   *
   * @example
   * ```ts
   * const rootLog = Logger.child({ sessionId, turn, scope: 'session' });
   * const toolLog = rootLog.child({ scope: 'tool' });
   * toolLog.info({ message: 'tool.start', data: { toolName: 'bash' } });
   * ```
   */
  static child(context: {
    sessionId?: string;
    turn?: number;
    step?: number;
    scope?: LogScope;
    data?: Record<string, unknown>;
  }): ChildLogger {
    return new ChildLogger(context);
  }
}
