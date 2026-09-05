/**
 * log-bus.ts - RxJS Subject 聚合的日志总线
 *
 * 把 Logger.debug/info/warn/error 产出的 LogEntry 路由到所有订阅者（FileSink /
 * MemorySink / TUI debug panel 等）。
 *
 * 行为契约：
 * - publish(entry) → entry 走 Subject → 所有匹配 filter 的 subscriber 收一条。
 * - subscribe(sink, { minLevel, scopes }) → 返回 unsubscribe 函数。
 * - level 过滤：entry.level rank ≥ minLevel rank 才投递（debug < info < warn < error）。
 * - scope 过滤：scopes 非空时，只投递 entry.scope ∈ scopes 的 entry。
 * - 同 subscriber 慢消费：本 MVP 不做 backpressure（Subject 默认缓冲 + 异步）。
 *   P2 候选：用 ReplaySubject + bounded buffer 或自定义 sample 节流。
 *
 * 多 sink 广播：每个 sink 单独走一份过滤逻辑（不影响其它 sink 的 filter 选择）。
 */

import { Observable, Subject } from 'rxjs';

import type { LogSink } from './memory-sink.js';
import type { LogEntry, LogLevel, LogScope } from './types.js';
import { LOG_LEVEL_RANK } from './types.js';

// ============================================================
// 订阅选项
// ============================================================

/**
 * LogBus.subscribe 的可选过滤选项。
 *
 * @property minLevel - 最低投递 level（默认 'debug'，即全部收）
 * @property scopes - 允许的 scope 集合（默认 undefined = 不按 scope 过滤）
 */
export type SubscribeOptions = {
  minLevel?: LogLevel;
  scopes?: ReadonlySet<LogScope>;
};

// ============================================================
// 内部订阅记录
// ============================================================

/**
 * 内部维护的订阅记录。
 */
type Subscription = {
  sink: LogSink;
  minLevelRank: number;
  scopes: ReadonlySet<LogScope> | null;
  // 记录 unsubscribe 状态，避免已 unsubscribe 的 sink 再次收 entry
  active: boolean;
};

// ============================================================
// LogBus
// ============================================================

/**
 * 日志总线。
 *
 * 用法：
 * ```ts
 * const bus = new LogBus();
 * const off = bus.subscribe(memorySink, { minLevel: 'info', scopes: new Set(['tool']) });
 * bus.publish(entry); // 仅当 level>=info && scope=='tool' 时才到 memorySink
 * off(); // 取消订阅
 * ```
 */
export class LogBus {
  private readonly subject = new Subject<LogEntry>();
  private readonly subs: Subscription[] = [];

  /**
   * 订阅一个 sink 到总线。
   *
   * @param sink - 接收 entry 的 sink
   * @param opts - 可选过滤（minLevel / scopes）
   * @returns unsubscribe 函数
   */
  subscribe(sink: LogSink, opts: SubscribeOptions = {}): () => void {
    const minLevel = opts.minLevel ?? 'debug';
    const sub: Subscription = {
      sink,
      minLevelRank: LOG_LEVEL_RANK[minLevel],
      scopes: opts.scopes ?? null,
      active: true,
    };
    this.subs.push(sub);

    // 同步消费 Subject；用 next + 过滤后调用 sink.write
    const sub2 = this.subject.subscribe((entry) => {
      if (!sub.active) return;
      if (LOG_LEVEL_RANK[entry.level] < sub.minLevelRank) return;
      if (sub.scopes && !sub.scopes.has(entry.scope)) return;
      try {
        sink.write(entry);
      } catch {
        // sink 抛错不应影响其它 sink；静默吞掉（与现有 debug-logger 行为一致）
      }
    });

    return () => {
      sub.active = false;
      sub2.unsubscribe();
      const idx = this.subs.indexOf(sub);
      if (idx >= 0) this.subs.splice(idx, 1);
    };
  }

  /**
   * 发布一条 entry 到总线。
   *
   * 内部走 Subject.next()，订阅者异步消费；调用立即返回。
   */
  publish(entry: LogEntry): void {
    this.subject.next(entry);
  }

  /**
   * 暴露 Observable<LogEntry>，给 TUI / 测试夹具订阅用。
   *
   * 注意：此 Observable 不过滤，所有 entry 都透传给订阅者；如需过滤请在外层用
   * `pipe(filter(...))`。
   */
  asObservable(): Observable<LogEntry> {
    return this.subject.asObservable();
  }

  /**
   * 当前活跃订阅数（测试用）。
   */
  subscriberCount(): number {
    return this.subs.length;
  }

  /**
   * 关闭总线，清理所有订阅。
   *
   * 调用后 publish / subscribe 均无效。
   */
  shutdown(): void {
    for (const sub of this.subs) {
      sub.active = false;
    }
    this.subs.length = 0;
    this.subject.complete();
  }
}
