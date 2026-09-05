/**
 * log-events.test.ts - 结构化事件模板测试
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Logger } from '../logger.js';
import { LogBus } from '../log-bus.js';
import { MemorySink } from '../memory-sink.js';
import { createLogEvents, logError } from '../log-events.js';

describe('LogEvents', () => {
  let bus: LogBus;
  let sink: MemorySink;
  let events: ReturnType<typeof createLogEvents>;

  beforeEach(() => {
    Logger.reset();
    bus = new LogBus();
    sink = new MemorySink();
    bus.subscribe(sink);
    Logger.setBus(bus);
    Logger.setLevel('debug');
    events = createLogEvents(
      Logger.child({ sessionId: 's1', turn: 1, scope: 'tool' })
    );
  });

  afterEach(() => {
    Logger.reset();
  });

  describe('tool events', () => {
    it('toolStart should write info entry with kind=tool_start', () => {
      events.tool.toolStart({ toolName: 'bash', input: { command: 'ls' } });

      const entry = sink.entries()[0];
      expect(entry?.level).toBe('info');
      expect(entry?.message).toBe('tool.start');
      expect(entry?.data).toMatchObject({
        kind: 'tool_start',
        toolName: 'bash',
        input: { command: 'ls' },
      });
    });

    it('toolEnd should write info entry with durationMs', () => {
      events.tool.toolEnd({ toolName: 'bash', durationMs: 100 });

      const entry = sink.entries()[0];
      expect(entry?.data).toMatchObject({
        kind: 'tool_end',
        toolName: 'bash',
        durationMs: 100,
      });
    });

    it('toolError should write error entry with Error object', () => {
      const err = new Error('boom');
      events.tool.toolError({ toolName: 'bash', durationMs: 50, error: err });

      const entry = sink.entries()[0];
      expect(entry?.level).toBe('error');
      expect(entry?.error).toMatchObject({ name: 'Error', message: 'boom' });
      expect(entry?.data).toMatchObject({
        kind: 'tool_error',
        toolName: 'bash',
        durationMs: 50,
      });
    });
  });

  describe('skill events', () => {
    it('skillStart should write info entry', () => {
      events.skill.skillStart({ skillName: 'review', args: { staged: true } });

      const entry = sink.entries()[0];
      expect(entry?.level).toBe('info');
      expect(entry?.data).toMatchObject({
        kind: 'skill_start',
        skillName: 'review',
      });
    });

    it('skillEnd should include durationMs', () => {
      events.skill.skillEnd({ skillName: 'init', durationMs: 200 });

      expect(sink.entries()[0]?.data).toMatchObject({
        kind: 'skill_end',
        durationMs: 200,
      });
    });

    it('skillError should write error entry', () => {
      events.skill.skillError({ skillName: 'init', error: new Error('fail') });

      expect(sink.entries()[0]?.level).toBe('error');
    });
  });

  describe('permission events', () => {
    it('permissionGranted should write info entry', () => {
      events.permission.permissionGranted({ kind: 'bash', sessionId: 's1' });

      const entry = sink.entries()[0];
      expect(entry?.level).toBe('info');
      expect(entry?.data).toMatchObject({
        kind: 'permission_granted',
        permissionKind: 'bash',
      });
    });

    it('permissionDenied should write warn entry', () => {
      events.permission.permissionDenied({
        kind: 'bash',
        reason: 'user denied',
        sessionId: 's1',
      });

      const entry = sink.entries()[0];
      expect(entry?.level).toBe('warn');
      expect(entry?.data).toMatchObject({
        kind: 'permission_denied',
        reason: 'user denied',
      });
    });
  });

  describe('provider events', () => {
    it('providerRequest should write debug entry', () => {
      events.provider.providerRequest({ provider: 'anthropic', model: 'claude-3' });

      const entry = sink.entries()[0];
      expect(entry?.level).toBe('debug');
      expect(entry?.data).toMatchObject({
        kind: 'provider_request',
        provider: 'anthropic',
      });
    });

    it('providerResponse should include durationMs and usage', () => {
      events.provider.providerResponse({
        provider: 'anthropic',
        durationMs: 1500,
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      expect(sink.entries()[0]?.data).toMatchObject({
        kind: 'provider_response',
        provider: 'anthropic',
        durationMs: 1500,
        usage: { inputTokens: 100, outputTokens: 50 },
      });
    });

    it('providerError should write error entry', () => {
      events.provider.providerError({
        provider: 'anthropic',
        error: new Error('timeout'),
      });

      expect(sink.entries()[0]?.level).toBe('error');
    });
  });
});

describe('logError helper', () => {
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

  it('should log error with provided context', () => {
    logError(new Error('boom'), {
      sessionId: 's1',
      scope: 'tool',
      message: 'tool failed',
      data: { toolName: 'bash' },
    });

    const entry = sink.entries()[0];
    expect(entry?.level).toBe('error');
    expect(entry?.scope).toBe('tool');
    expect(entry?.message).toBe('tool failed');
    expect(entry?.error).toMatchObject({ message: 'boom' });
    expect(entry?.data).toMatchObject({ toolName: 'bash' });
  });

  it('should default scope to session', () => {
    logError(new Error('boom'), {
      sessionId: 's1',
      message: 'error',
    });

    expect(sink.entries()[0]?.scope).toBe('session');
  });

  it('should support Error object', () => {
    const err = new Error('test');
    err.name = 'TestError';
    logError(err, { sessionId: 's1', message: 'failed' });

    expect(sink.entries()[0]?.error).toMatchObject({
      name: 'TestError',
      message: 'test',
    });
  });

  it('should support Error struct', () => {
    logError(
      { name: 'CustomError', message: 'custom msg', top_frame: 'frame1' },
      { sessionId: 's1', message: 'failed' }
    );

    expect(sink.entries()[0]?.error).toMatchObject({
      name: 'CustomError',
      message: 'custom msg',
      top_frame: 'frame1',
    });
  });
});