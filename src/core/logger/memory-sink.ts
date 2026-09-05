/**
 * memory-sink.ts - 进程内 LogEntry 缓冲 sink
 *
 * 用途：测试 / TUI 调试夹具等"在内存里收集日志、不落盘"的场景。
 *
 * 行为契约：
 * - 实现 LogSink.write(entry)：把 entry 追加到内部数组。
 * - 不做 level / scope 过滤（由 LogBus 在 publish 时按订阅选项过滤）。
 * - 写完后不返回 Promise（同步语义）。
 * - flush/close 是 no-op，仅为对齐 LogSink interface。
 *
 * 线程安全：单线程 Node 进程无需 mutex；若后续接入 worker 需另加锁。
 */

import type { LogEntry, LogLevel, LogScope } from './types.js';

/**
 * 日志 sink 抽象。
 *
 * 实现者把 entry 写到自己的目的地（文件 / 内存 / 远程）。Logger 通过
 * LogBus.subscribe 注入，调用者无需关心 sink 类型。
 *
 * @method write - 同步写一条 entry
 * @method flush - 可选，把缓冲数据落盘（文件 sink 才有意义）
 * @method close - 可选，关闭 sink 并释放资源
 */
export interface LogSink {
  write(entry: LogEntry): void;
  flush?(): Promise<void>;
  close?(): Promise<void>;
}

/**
 * 进程内 LogEntry 缓冲。
 *
 * 用法（典型测试）：
 * ```ts
 * const sink = new MemorySink();
 * sink.write(makeEntry({ level: 'info', message: 'hi' }));
 * expect(sink.count()).toBe(1);
 * expect(sink.lastByLevel('info')?.message).toBe('hi');
 * ```
 */
export class MemorySink implements LogSink {
  private readonly buffer: LogEntry[] = [];

  /**
   * 写一条 entry。
   */
  write(entry: LogEntry): void {
    this.buffer.push(entry);
  }

  /**
   * 返回当前所有 entry（浅拷贝，避免外部 mutate 内部数组）。
   */
  entries(): readonly LogEntry[] {
    return [...this.buffer];
  }

  /**
   * 返回当前 entry 数。
   */
  count(): number {
    return this.buffer.length;
  }

  /**
   * 清空 buffer。
   */
  clear(): void {
    this.buffer.length = 0;
  }

  /**
   * 返回指定 level 的最后一条 entry；无则 undefined。
   */
  lastByLevel(level: LogLevel): LogEntry | undefined {
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      const entry = this.buffer[i];
      if (entry && entry.level === level) return entry;
    }
    return undefined;
  }

  /**
   * 按谓词过滤 entry。
   */
  filter(predicate: (entry: LogEntry) => boolean): readonly LogEntry[] {
    return this.buffer.filter(predicate);
  }

  /**
   * 按 level 分组，返回 { debug: [...], info: [...], warn: [...], error: [...] }。
   */
  entriesByLevel(): Readonly<Record<LogLevel, readonly LogEntry[]>> {
    const result: Record<LogLevel, LogEntry[]> = {
      debug: [],
      info: [],
      warn: [],
      error: [],
    };
    for (const entry of this.buffer) {
      result[entry.level].push(entry);
    }
    return result;
  }

  /**
   * 按 scope 过滤。
   */
  entriesByScope(scope: LogScope): readonly LogEntry[] {
    return this.buffer.filter((e) => e.scope === scope);
  }

  /**
   * flush / close：内存 sink 无 IO，此处 no-op。
   */
  async flush(): Promise<void> {
    /* no-op */
  }

  async close(): Promise<void> {
    this.clear();
  }
}
