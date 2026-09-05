/**
 * child-logger.ts - 子 Logger（继承父级 context）
 *
 * 通过 `Logger.child(context)` 创建子 Logger，自动继承父级的 sessionId / turn /
 * scope 等字段，避免每个调用都重复样板代码。
 *
 * 设计模式：
 * - 子 Logger 是不可变的快照：child() 后修改父级 context 不会影响已创建的子 Logger
 * - 子 Logger 的 context 字段覆盖父级（child() 传入同名字段优先）
 * - 子 Logger 仍走同一 Logger 静态门面（同一 bus / 同一 minLevel）
 *
 * 用法：
 * ```ts
 * // 启动时创建根 logger
 * const rootLog = Logger.child({ scope: 'session', sessionId, turn });
 *
 * // 子模块创建子 logger（继承 sessionId/turn，覆盖 scope）
 * const toolLog = rootLog.child({ scope: 'tool' });
 * toolLog.info({ message: 'tool.start', data: { toolName: 'bash' } });
 * // 等价于 Logger.info({ sessionId, turn, scope: 'tool', message: 'tool.start', data: {...} })
 *
 * // 链式继承
 * const retryLog = toolLog.child({ data: { kind: 'retry', attempt: 3 } });
 * ```
 */

import { Logger } from './logger.js';
import type { LogEntryInput, LogScope } from './types.js';

/**
 * 子 Logger 继承的上下文字段。
 *
 * 这些字段在 child() 调用时与父级合并（child 优先），后续调用 debug/info/warn/error
 * 时作为默认值注入。
 */
export type ChildLoggerContext = {
  /** 会话 ID（覆盖父级） */
  sessionId?: string;
  /** 当前 turn（覆盖父级） */
  turn?: number;
  /** 当前 step（覆盖父级） */
  step?: number;
  /** scope 域（覆盖父级） */
  scope?: LogScope;
  /** 默认 data（与调用时的 data 浅合并，调用方优先） */
  data?: Record<string, unknown>;
};

/**
 * 子 Logger 实例。
 *
 * 不可变；调用 child() 返回新的子 Logger。
 */
export class ChildLogger {
  private readonly context: Required<Pick<ChildLoggerContext, 'scope'>> &
    ChildLoggerContext;

  constructor(context: ChildLoggerContext) {
    this.context = { scope: 'session', ...context };
  }

  /**
   * 创建嵌套子 Logger。
   *
   * 父级的 context 字段作为默认值；新传入的 context 字段覆盖父级；data 字段浅合并
   * （调用方 data 优先于父级 data）。
   *
   * @param overrides - 覆盖字段
   * @returns 新的子 Logger
   */
  child(overrides: ChildLoggerContext): ChildLogger {
    const merged: ChildLoggerContext = {
      ...this.context,
      ...overrides,
    };
    // data 字段需要浅合并
    if (this.context.data || overrides.data) {
      merged.data = { ...(this.context.data ?? {}), ...(overrides.data ?? {}) };
    }
    return new ChildLogger(merged);
  }

  /**
   * 写一条 debug entry。
   */
  debug(params: { message: string; data?: Record<string, unknown>; error?: LogEntryInput['error'] }): void {
    Logger.debug(this.buildEntry(params));
  }

  /**
   * 写一条 info entry。
   */
  info(params: { message: string; data?: Record<string, unknown>; error?: LogEntryInput['error'] }): void {
    Logger.info(this.buildEntry(params));
  }

  /**
   * 写一条 warn entry。
   */
  warn(params: { message: string; data?: Record<string, unknown>; error?: LogEntryInput['error'] }): void {
    Logger.warn(this.buildEntry(params));
  }

  /**
   * 写一条 error entry。
   */
  error(params: { message: string; data?: Record<string, unknown>; error?: LogEntryInput['error'] }): void {
    Logger.error(this.buildEntry(params));
  }

  /**
   * 返回当前上下文的快照（只读）。
   */
  getContext(): Readonly<ChildLoggerContext> {
    return { ...this.context };
  }

  /**
   * 构造 LogEntryInput：合并 child context 和调用参数。
   */
  private buildEntry(params: { message: string; data?: Record<string, unknown>; error?: LogEntryInput['error'] }): LogEntryInput {
    const data = params.data || this.context.data
      ? { ...(this.context.data ?? {}), ...(params.data ?? {}) }
      : undefined;
    return {
      sessionId: this.context.sessionId ?? '',
      turn: this.context.turn,
      step: this.context.step,
      scope: this.context.scope,
      message: params.message,
      data,
      error: params.error,
    };
  }
}