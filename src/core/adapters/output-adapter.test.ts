/**
 * output-adapter.test.ts - OutputAdapter 单元测试
 */

import { describe, it, expect } from 'vitest';
import { DefaultOutputAdapter, type DisplayEvent } from './output-adapter.js';
import type { RuntimeEvent } from '../runtime/event-types.js';

describe('DefaultOutputAdapter', () => {
  const adapter = new DefaultOutputAdapter();

  describe('session_started', () => {
    it('应该转换 session_started 事件（包含所有字段）', () => {
      const event: RuntimeEvent = {
        type: 'session_started',
        sessionId: 'test-session',
        sessionPath: '/test/session.jsonl',
        mode: 'interactive',
      };

      const result = adapter.processEvent(event);

      expect(result).toEqual({
        type: 'session_started',
        sessionId: 'test-session',
        sessionPath: '/test/session.jsonl',
        mode: 'interactive',
      });
    });
  });

  describe('user_turn', () => {
    it('应该转换 user_turn 事件（包含所有字段）', () => {
      const event: RuntimeEvent = {
        type: 'user_turn',
        sessionId: 'test-session',
        turn: 1,
        content: 'hello world',
        source: 'interactive',
      };

      const result = adapter.processEvent(event);

      expect(result).toEqual({
        type: 'user_turn',
        sessionId: 'test-session',
        turn: 1,
        content: 'hello world',
        source: 'interactive',
      });
    });
  });

  describe('assistant_chunk', () => {
    it('应该转换 assistant_chunk 事件', () => {
      const event: RuntimeEvent = {
        type: 'assistant_chunk',
        sessionId: 'test-session',
        turn: 1,
        chunk: 'Hello',
      };

      const result = adapter.processEvent(event);

      expect(result).toEqual({
        type: 'assistant_chunk',
        sessionId: 'test-session',
        turn: 1,
        chunk: 'Hello',
      });
    });
  });

  describe('assistant_message', () => {
    it('应该转换 assistant_message 事件', () => {
      const event: RuntimeEvent = {
        type: 'assistant_message',
        sessionId: 'test-session',
        turn: 1,
        content: 'Hello world',
      };

      const result = adapter.processEvent(event);

      expect(result).toEqual({
        type: 'assistant_message',
        sessionId: 'test-session',
        turn: 1,
        content: 'Hello world',
      });
    });
  });

  describe('tool_call_requested', () => {
    it('应该转换 tool_call_requested 事件', () => {
      const event: RuntimeEvent = {
        type: 'tool_call_requested',
        sessionId: 'test-session',
        turn: 1,
        callId: 'call-123',
        toolName: 'bash',
        input: { command: 'ls' },
      };

      const result = adapter.processEvent(event);

      expect(result).toEqual({
        type: 'tool_call_requested',
        sessionId: 'test-session',
        turn: 1,
        callId: 'call-123',
        toolName: 'bash',
      });
    });
  });

  describe('permission_decision', () => {
    it('应该转换 permission_decision 事件（使用正确类型）', () => {
      const event: RuntimeEvent = {
        type: 'permission_decision',
        sessionId: 'test-session',
        turn: 1,
        callId: 'call-123',
        toolName: 'bash',
        decision: 'allow',
        mode: 'default',
        reason: 'user approved',
      };

      const result = adapter.processEvent(event);

      expect(result).toEqual({
        type: 'permission_decision',
        sessionId: 'test-session',
        turn: 1,
        callId: 'call-123',
        toolName: 'bash',
        decision: 'allow',
        mode: 'default',
        reason: 'user approved',
      });
    });
  });

  describe('tool_started', () => {
    it('应该转换 tool_started 事件', () => {
      const event: RuntimeEvent = {
        type: 'tool_started',
        sessionId: 'test-session',
        turn: 1,
        callId: 'call-123',
        toolName: 'bash',
      };

      const result = adapter.processEvent(event);

      expect(result).toEqual({
        type: 'tool_started',
        sessionId: 'test-session',
        turn: 1,
        callId: 'call-123',
        toolName: 'bash',
      });
    });
  });

  describe('tool_result', () => {
    it('应该转换 tool_result 事件', () => {
      const event: RuntimeEvent = {
        type: 'tool_result',
        sessionId: 'test-session',
        turn: 1,
        callId: 'call-123',
        toolName: 'bash',
        status: 'success',
        output: 'file1.txt\nfile2.txt',
      };

      const result = adapter.processEvent(event);

      expect(result).toEqual({
        type: 'tool_result',
        sessionId: 'test-session',
        turn: 1,
        callId: 'call-123',
        toolName: 'bash',
        output: 'file1.txt\nfile2.txt',
      });
    });
  });

  describe('tool_failed', () => {
    it('应该转换 tool_failed 事件', () => {
      const event: RuntimeEvent = {
        type: 'tool_failed',
        sessionId: 'test-session',
        turn: 1,
        callId: 'call-123',
        toolName: 'bash',
        status: 'error',
        error: 'Command failed',
      };

      const result = adapter.processEvent(event);

      expect(result).toEqual({
        type: 'tool_failed',
        sessionId: 'test-session',
        turn: 1,
        callId: 'call-123',
        toolName: 'bash',
        error: 'Command failed',
      });
    });
  });

  describe('agent_spawned', () => {
    it('应该转换 agent_spawned 事件（包含所有字段）', () => {
      const event: RuntimeEvent = {
        type: 'agent_spawned',
        parentId: 'parent-123',
        childId: 'child-456',
        childSessionPath: '/test/child.jsonl',
        name: 'analyzer',
        task: 'Analyze code',
      };

      const result = adapter.processEvent(event);

      expect(result).toEqual({
        type: 'agent_spawned',
        parentId: 'parent-123',
        childId: 'child-456',
        childSessionPath: '/test/child.jsonl',
        name: 'analyzer',
        task: 'Analyze code',
      });
    });
  });

  describe('agent_completed', () => {
    it('应该转换 agent_completed 事件（包含所有字段）', () => {
      const event: RuntimeEvent = {
        type: 'agent_completed',
        childId: 'child-456',
        status: 'success',
        result: 'Analysis complete',
        sessionPath: '/test/child.jsonl',
      };

      const result = adapter.processEvent(event);

      expect(result).toEqual({
        type: 'agent_completed',
        childId: 'child-456',
        status: 'success',
        result: 'Analysis complete',
        sessionPath: '/test/child.jsonl',
      });
    });
  });

  describe('skill_started', () => {
    it('应该转换 skill_started 事件（包含所有字段）', () => {
      const event: RuntimeEvent = {
        type: 'skill_started',
        sessionId: 'test-session',
        turn: 1,
        skillName: 'my-skill',
        args: {
          positional: ['arg1'],
          named: { key: 'value' },
          raw: '/my-skill arg1 key=value',
        },
      };

      const result = adapter.processEvent(event);

      expect(result).toEqual({
        type: 'skill_started',
        sessionId: 'test-session',
        turn: 1,
        skillName: 'my-skill',
        args: {
          positional: ['arg1'],
          named: { key: 'value' },
          raw: '/my-skill arg1 key=value',
        },
      });
    });
  });

  describe('skill_result', () => {
    it('应该转换 skill_result 事件（包含所有字段）', () => {
      const event: RuntimeEvent = {
        type: 'skill_result',
        sessionId: 'test-session',
        turn: 1,
        skillName: 'my-skill',
        result: { status: 'success', output: 'Skill completed successfully' },
      };

      const result = adapter.processEvent(event);

      expect(result).toEqual({
        type: 'skill_result',
        sessionId: 'test-session',
        turn: 1,
        skillName: 'my-skill',
        result: { status: 'success', output: 'Skill completed successfully' },
      });
    });
  });

  describe('session_ended', () => {
    it('应该转换 session_ended 事件', () => {
      const event: RuntimeEvent = {
        type: 'session_ended',
        sessionId: 'test-session',
      };

      const result = adapter.processEvent(event);

      expect(result).toEqual({
        type: 'session_ended',
        sessionId: 'test-session',
      });
    });
  });
});

describe('DisplayEvent type', () => {
  it('应该包含所有必需字段', () => {
    // 类型检查 - 编译时验证
    const events: DisplayEvent[] = [
      { type: 'session_started', sessionId: '1', sessionPath: '/test', mode: 'interactive' },
      { type: 'user_turn', sessionId: '1', turn: 1, content: 'hello', source: 'interactive' },
      { type: 'assistant_chunk', sessionId: '1', turn: 1, chunk: 'Hi' },
      { type: 'assistant_message', sessionId: '1', turn: 1, content: 'Hi there' },
      { type: 'tool_call_requested', sessionId: '1', turn: 1, toolName: 'bash', callId: '1' },
      { type: 'permission_decision', sessionId: '1', turn: 1, toolName: 'bash', callId: '1', decision: 'allow', mode: 'default', reason: 'ok' },
      { type: 'tool_started', sessionId: '1', turn: 1, toolName: 'bash', callId: '1' },
      { type: 'tool_result', sessionId: '1', turn: 1, toolName: 'bash', callId: '1', output: 'result' },
      { type: 'tool_failed', sessionId: '1', turn: 1, toolName: 'bash', callId: '1', error: 'failed' },
      { type: 'agent_spawned', parentId: '1', childId: '2', childSessionPath: '/test', name: 'analyzer', task: 'analyze' },
      { type: 'agent_completed', childId: '1', status: 'success', sessionPath: '/test' },
      { type: 'skill_started', sessionId: '1', turn: 1, skillName: 'test', args: { positional: [], named: {}, raw: '' } },
      { type: 'skill_result', sessionId: '1', turn: 1, skillName: 'test', result: { status: 'success', output: 'done' } },
      { type: 'session_ended', sessionId: '1' },
    ];

    expect(events).toHaveLength(14);
  });
});
