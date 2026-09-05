/**
 * child-logger.test.ts - 子 Logger 单元测试
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Logger } from '../logger.js';
import { MemorySink } from '../memory-sink.js';
import { LogBus } from '../log-bus.js';

describe('ChildLogger', () => {
  let bus: LogBus;
  let sink: MemorySink;

  beforeEach(() => {
    Logger.reset();
    bus = new LogBus();
    sink = new MemorySink();
    bus.subscribe(sink);
    Logger.setBus(bus);
    Logger.setLevel('debug');
  });

  afterEach(() => {
    Logger.reset();
  });

  describe('Logger.child()', () => {
    it('should create a child logger that inherits context', () => {
      const child = Logger.child({ sessionId: 's1', turn: 1, scope: 'session' });
      expect(child).toBeDefined();
      expect(child.getContext()).toMatchObject({
        sessionId: 's1',
        turn: 1,
        scope: 'session',
      });
    });

    it('should default scope to session when not specified', () => {
      const child = Logger.child({ sessionId: 's1' });
      expect(child.getContext().scope).toBe('session');
    });
  });

  describe('child.child()', () => {
    it('should inherit parent context', () => {
      const parent = Logger.child({ sessionId: 's1', turn: 1, scope: 'session' });
      const child = parent.child({ scope: 'tool' });
      expect(child.getContext()).toMatchObject({
        sessionId: 's1',
        turn: 1,
        scope: 'tool',
      });
    });

    it('should allow child overrides to take precedence', () => {
      const parent = Logger.child({ sessionId: 's1', turn: 1, scope: 'session' });
      const child = parent.child({ scope: 'tool', turn: 5 });
      expect(child.getContext()).toMatchObject({
        sessionId: 's1',
        turn: 5,
        scope: 'tool',
      });
    });

    it('should merge data fields shallowly', () => {
      const parent = Logger.child({
        sessionId: 's1',
        data: { kind: 'parent', shared: 'parent-value' },
      });
      const child = parent.child({
        data: { kind: 'child', extra: 'extra-value' },
      });
      const ctx = child.getContext();
      expect(ctx.data).toEqual({
        kind: 'child',
        shared: 'parent-value',
        extra: 'extra-value',
      });
    });
  });

  describe('child logger methods', () => {
    it('debug() should write entry with inherited context', () => {
      const child = Logger.child({ sessionId: 's1', turn: 1, scope: 'tool' });
      child.debug({ message: 'tool.start' });

      const entries = sink.entries();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        sessionId: 's1',
        turn: 1,
        scope: 'tool',
        level: 'debug',
        message: 'tool.start',
      });
    });

    it('info() should write entry with level=info', () => {
      const child = Logger.child({ sessionId: 's1', scope: 'session' });
      child.info({ message: 'session.start' });

      expect(sink.entries()[0]?.level).toBe('info');
    });

    it('warn() should write entry with level=warn', () => {
      const child = Logger.child({ sessionId: 's1', scope: 'tool' });
      child.warn({ message: 'tool.warn' });

      expect(sink.entries()[0]?.level).toBe('warn');
    });

    it('error() should write entry with level=error', () => {
      const child = Logger.child({ sessionId: 's1', scope: 'tool' });
      child.error({ message: 'tool.error' });

      expect(sink.entries()[0]?.level).toBe('error');
    });

    it('should merge call data with inherited data', () => {
      const child = Logger.child({
        sessionId: 's1',
        data: { kind: 'tool_start', toolName: 'bash' },
      });
      child.info({ message: 'tool.start', data: { durationMs: 100 } });

      const entry = sink.entries()[0];
      expect(entry?.data).toEqual({
        kind: 'tool_start',
        toolName: 'bash',
        durationMs: 100,
      });
    });

    it('should respect minLevel filter', () => {
      Logger.setLevel('error');
      const child = Logger.child({ sessionId: 's1', scope: 'tool' });
      child.debug({ message: 'dropped' });
      child.error({ message: 'kept' });

      const entries = sink.entries();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.message).toBe('kept');
    });

    it('should support error parameter', () => {
      const child = Logger.child({ sessionId: 's1', scope: 'tool' });
      child.error({ message: 'failed', error: new Error('boom') });

      const entry = sink.entries()[0];
      expect(entry?.error).toMatchObject({
        name: 'Error',
        message: 'boom',
      });
    });
  });

  describe('immutability', () => {
    it('parent context changes should not affect existing children', () => {
      const parent = Logger.child({ sessionId: 's1', turn: 1, scope: 'session' });
      const child = parent.child({ scope: 'tool' });

      // 重新创建父级（不影响已创建的子）
      const newParent = Logger.child({ sessionId: 's2', turn: 2, scope: 'session' });
      void newParent;

      expect(child.getContext().sessionId).toBe('s1');
      expect(child.getContext().turn).toBe(1);
    });
  });
});