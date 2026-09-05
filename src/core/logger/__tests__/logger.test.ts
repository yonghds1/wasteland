/**
 * logger.test.ts - PR1 logger 子系统测试
 *
 * 覆盖：
 * 1. LogBus.publish → MemorySink 收齐
 * 2. LogBus level 过滤：info 时 debug 不收
 * 3. LogBus scope 过滤：只订阅 tool 时 tool 收 / session 不收
 * 4. LogBus 多 sink 广播
 * 5. Logger.setLevel('debug') 启用 debug
 * 6. Logger.setLevel('info') 仍收 error（关键 case：error rank 最高，永远通过）
 * 7. Logger 默认 no-op（未 setBus）
 * 8. Logger message 中含 \n → 字段值为 "a\\nb"（单行）
 * 9. Logger.error({ error: new Error('boom') }) → error 字段结构化
 *    { name, message, stack, top_frame }
 *
 * 测试不依赖文件系统、无副作用，注入 fresh LogBus + MemorySink 即可。
 */

import { firstValueFrom, take } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LogBus } from '../log-bus.js';
import { Logger } from '../logger.js';
import { MemorySink } from '../memory-sink.js';
import type { LogEntry, LogLevel } from '../types.js';

// ============================================================
// 工具：构造一条 entry
// ============================================================

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    version: 1,
    timestamp: new Date().toISOString(),
    level: 'info',
    scope: 'session',
    sessionId: 'sid-1',
    message: 'hello',
    ...overrides,
  };
}

// ============================================================
// 测试
// ============================================================

describe('LogBus', () => {
  let bus: LogBus;
  let sink: MemorySink;

  beforeEach(() => {
    bus = new LogBus();
    sink = new MemorySink();
  });

  afterEach(() => {
    bus.shutdown();
  });

  it('publish → MemorySink 收齐', () => {
    bus.subscribe(sink);
    bus.publish(makeEntry({ message: 'a' }));
    bus.publish(makeEntry({ message: 'b' }));
    expect(sink.count()).toBe(2);
    expect(sink.entries()[0]?.message).toBe('a');
    expect(sink.entries()[1]?.message).toBe('b');
  });

  it('level filter: info 时 debug 不收', () => {
    bus.subscribe(sink, { minLevel: 'info' });
    bus.publish(makeEntry({ level: 'debug', message: 'd' }));
    bus.publish(makeEntry({ level: 'info', message: 'i' }));
    bus.publish(makeEntry({ level: 'warn', message: 'w' }));
    bus.publish(makeEntry({ level: 'error', message: 'e' }));
    expect(sink.count()).toBe(3);
    expect(sink.entries().map((e) => e.level)).toEqual(['info', 'warn', 'error']);
  });

  it('scope filter: 只订阅 tool 时 tool 收 / session 不收', () => {
    bus.subscribe(sink, { scopes: new Set(['tool']) });
    bus.publish(makeEntry({ scope: 'session', message: 's' }));
    bus.publish(makeEntry({ scope: 'tool', message: 't' }));
    bus.publish(makeEntry({ scope: 'provider', message: 'p' }));
    expect(sink.count()).toBe(1);
    expect(sink.entries()[0]?.scope).toBe('tool');
    expect(sink.entries()[0]?.message).toBe('t');
  });

  it('多 sink 广播', () => {
    const sinkA = new MemorySink();
    const sinkB = new MemorySink();
    bus.subscribe(sinkA, { minLevel: 'info' });
    bus.subscribe(sinkB, { minLevel: 'debug' });
    bus.publish(makeEntry({ level: 'debug', message: 'd' }));
    expect(sinkA.count()).toBe(0);
    expect(sinkB.count()).toBe(1);
    bus.publish(makeEntry({ level: 'info', message: 'i' }));
    expect(sinkA.count()).toBe(1);
    expect(sinkB.count()).toBe(2);
  });

  it('unsubscribe 后不再收 entry', () => {
    const off = bus.subscribe(sink);
    bus.publish(makeEntry({ message: 'a' }));
    expect(sink.count()).toBe(1);
    off();
    bus.publish(makeEntry({ message: 'b' }));
    expect(sink.count()).toBe(1);
  });

  it('sink.write 抛错不影响其它 sink', () => {
    const sinkBad: MemorySink = new MemorySink();
    const originalWrite = sinkBad.write.bind(sinkBad);
    sinkBad.write = (entry) => {
      originalWrite(entry);
      throw new Error('boom');
    };
    const sinkOk = new MemorySink();
    bus.subscribe(sinkBad);
    bus.subscribe(sinkOk);
    // publish 不应抛出
    expect(() => bus.publish(makeEntry({ message: 'a' }))).not.toThrow();
  });

  it('asObservable 暴露未过滤的 entry 流', async () => {
    const promise = firstValueFrom(bus.asObservable().pipe(take(1)));
    bus.publish(makeEntry({ message: 'first' }));
    const received = await promise;
    expect(received.message).toBe('first');
  });
});

describe('Logger', () => {
  let bus: LogBus;
  let sink: MemorySink;

  beforeEach(() => {
    Logger.reset();
    bus = new LogBus();
    sink = new MemorySink();
    bus.subscribe(sink);
    Logger.setBus(bus);
  });

  afterEach(() => {
    Logger.reset();
  });

  it('默认 no-op（未 setBus 时）', () => {
    Logger.reset();
    Logger.setLevel('debug');
    // 重新 setBus 之后才会推送
    const bus2 = new LogBus();
    const sink2 = new MemorySink();
    bus2.subscribe(sink2);
    Logger.setBus(bus2);
    Logger.info({ sessionId: 'sid', scope: 'session', message: 'hi' });
    expect(sink2.count()).toBe(1);
  });

  it('setLevel("debug") 启用 debug 事件', () => {
    Logger.setLevel('debug');
    Logger.debug({ sessionId: 'sid', scope: 'session', message: 'd' });
    Logger.info({ sessionId: 'sid', scope: 'session', message: 'i' });
    expect(sink.count()).toBe(2);
    expect(sink.entries().map((e) => e.level)).toEqual(['debug', 'info']);
  });

  it('setLevel("info") 仍收 error（error rank 最高）', () => {
    Logger.setLevel('info');
    Logger.debug({ sessionId: 'sid', scope: 'session', message: 'd' });
    Logger.info({ sessionId: 'sid', scope: 'session', message: 'i' });
    Logger.warn({ sessionId: 'sid', scope: 'session', message: 'w' });
    Logger.error({ sessionId: 'sid', scope: 'session', message: 'e' });
    const levels: LogLevel[] = sink.entries().map((e) => e.level);
    expect(levels).toEqual(['info', 'warn', 'error']);
    expect(sink.count()).toBe(3);
  });

  it('默认 level=info 时 debug 静默不写', () => {
    // 没有 setLevel 调整，默认 'info'
    Logger.debug({ sessionId: 'sid', scope: 'session', message: 'd' });
    Logger.info({ sessionId: 'sid', scope: 'session', message: 'i' });
    expect(sink.count()).toBe(1);
    expect(sink.entries()[0]?.level).toBe('info');
  });

  it('message 中含 \\n → 字段值为 "a\\\\nb"（单行）', () => {
    Logger.setLevel('debug');
    Logger.debug({ sessionId: 'sid', scope: 'session', message: 'a\nb' });
    expect(sink.count()).toBe(1);
    expect(sink.entries()[0]?.message).toBe('a\\nb');
    // 序列化时不能含真正的换行（每行 JSONL 边界）
    const serialized = JSON.stringify(sink.entries()[0]);
    expect(serialized).not.toMatch(/\n/);
  });

  it('Error 实例 → error 字段结构化 { name, message, stack, top_frame }', () => {
    const err = new Error('boom');
    Logger.error({ sessionId: 'sid', scope: 'tool', message: 'failed', error: err });
    expect(sink.count()).toBe(1);
    const entry = sink.entries()[0];
    expect(entry?.error?.name).toBe('Error');
    expect(entry?.error?.message).toBe('boom');
    expect(entry?.error?.stack).toBeDefined();
    expect(typeof entry?.error?.top_frame).toBe('string');
    // top_frame 应是 stack 的首行
    const firstStackLine = err.stack?.split('\n', 1)[0]?.trim();
    expect(entry?.error?.top_frame).toBe(firstStackLine);
  });

  it('LogError 结构体直接透传', () => {
    Logger.error({
      sessionId: 'sid',
      scope: 'tool',
      message: 'failed',
      error: {
        name: 'CustomError',
        message: 'custom boom',
        top_frame: 'at foo (bar.ts:1:1)',
        stack: 'CustomError: custom boom\n  at foo (bar.ts:1:1)',
      },
    });
    const entry = sink.entries()[0];
    expect(entry?.error?.name).toBe('CustomError');
    expect(entry?.error?.message).toBe('custom boom');
    expect(entry?.error?.top_frame).toBe('at foo (bar.ts:1:1)');
  });

  it('自动注入 version: 1 与 timestamp', () => {
    Logger.info({ sessionId: 'sid', scope: 'session', message: 'm' });
    const entry = sink.entries()[0];
    expect(entry?.version).toBe(1);
    expect(entry?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('turn / step 字段透传', () => {
    Logger.info({ sessionId: 'sid', scope: 'turn', message: 'm', turn: 3, step: 7 });
    const entry = sink.entries()[0];
    expect(entry?.turn).toBe(3);
    expect(entry?.step).toBe(7);
  });

  it('data 字段透传任意 JSON', () => {
    Logger.info({
      sessionId: 'sid',
      scope: 'tool',
      message: 'm',
      data: { toolName: 'bash', exitCode: 0 },
    });
    const entry = sink.entries()[0];
    expect(entry?.data).toEqual({ toolName: 'bash', exitCode: 0 });
  });

  it('setEnv 配置可设置 redact / dir / tailLines（占位）', () => {
    Logger.setEnv({ level: 'debug', redact: false, dir: '/tmp/logs', tailLines: 100 });
    expect(Logger.getEnv().redact).toBe(false);
    expect(Logger.getEnv().dir).toBe('/tmp/logs');
    expect(Logger.getEnv().tailLines).toBe(100);
    // setEnv({ level }) 同步设置 minLevel
    expect(Logger.getLevel()).toBe('debug');
  });

  it('reset 后 setBus 状态归零', () => {
    Logger.info({ sessionId: 'sid', scope: 'session', message: 'before' });
    expect(sink.count()).toBe(1);
    Logger.reset();
    expect(Logger.hasBus()).toBe(false);
    // 重新注入新 bus 才生效
    const newBus = new LogBus();
    const newSink = new MemorySink();
    newBus.subscribe(newSink);
    Logger.setBus(newBus);
    Logger.info({ sessionId: 'sid', scope: 'session', message: 'after' });
    expect(newSink.count()).toBe(1);
    expect(newSink.entries()[0]?.message).toBe('after');
  });
});

describe('MemorySink', () => {
  it('entriesByLevel 按 level 分组', () => {
    const sink = new MemorySink();
    sink.write(makeEntry({ level: 'debug' }));
    sink.write(makeEntry({ level: 'info', message: 'i' }));
    sink.write(makeEntry({ level: 'info', message: 'i2' }));
    sink.write(makeEntry({ level: 'error' }));
    const grouped = sink.entriesByLevel();
    expect(grouped.debug.length).toBe(1);
    expect(grouped.info.length).toBe(2);
    expect(grouped.warn.length).toBe(0);
    expect(grouped.error.length).toBe(1);
  });

  it('entriesByScope 按 scope 过滤', () => {
    const sink = new MemorySink();
    sink.write(makeEntry({ scope: 'session' }));
    sink.write(makeEntry({ scope: 'tool' }));
    sink.write(makeEntry({ scope: 'tool' }));
    expect(sink.entriesByScope('tool').length).toBe(2);
    expect(sink.entriesByScope('session').length).toBe(1);
    expect(sink.entriesByScope('provider').length).toBe(0);
  });

  it('filter 谓词支持', () => {
    const sink = new MemorySink();
    sink.write(makeEntry({ message: 'keep-me' }));
    sink.write(makeEntry({ message: 'drop-me' }));
    sink.write(makeEntry({ message: 'keep-also' }));
    const kept = sink.filter((e) => e.message.startsWith('keep'));
    expect(kept.length).toBe(2);
  });

  it('lastByLevel 返回最后一条；无则 undefined', () => {
    const sink = new MemorySink();
    expect(sink.lastByLevel('info')).toBeUndefined();
    sink.write(makeEntry({ level: 'info', message: 'first' }));
    sink.write(makeEntry({ level: 'warn', message: 'mid' }));
    sink.write(makeEntry({ level: 'info', message: 'last' }));
    expect(sink.lastByLevel('info')?.message).toBe('last');
    expect(sink.lastByLevel('warn')?.message).toBe('mid');
  });

  it('clear 后 count = 0', () => {
    const sink = new MemorySink();
    sink.write(makeEntry());
    sink.write(makeEntry());
    expect(sink.count()).toBe(2);
    sink.clear();
    expect(sink.count()).toBe(0);
  });
});
