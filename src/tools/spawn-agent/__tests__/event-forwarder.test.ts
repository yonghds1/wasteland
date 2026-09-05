/**
 * event-forwarder.test.ts - 子 Agent 事件转发单元测试
 *
 * 覆盖：
 * - translateChildEvent：子 agent 内部事件翻译为父侧事件
 *   （assistant_chunk → agent_thinking、tool_call → agent_tool_use、
 *    context_compacted → agent_progress 等；未知事件 → null）
 */
import { describe, it, expect } from 'vitest';

import { translateChildEvent } from '../event-forwarder.js';
import type { RuntimeEvent } from '@core/runtime/event-types.js';

const CHILD_ID = 'child-1';
const CHILD_NAME = 'researcher';

function childEvent(partial: Partial<RuntimeEvent> & { type: RuntimeEvent['type'] }): RuntimeEvent {
  return partial as RuntimeEvent;
}

describe('translateChildEvent', () => {
  it('assistant_chunk → agent_thinking', () => {
    const ev = translateChildEvent(
      childEvent({ type: 'assistant_chunk', chunk: 'hello' }),
      CHILD_ID,
      CHILD_NAME
    );
    expect(ev).toEqual({
      type: 'agent_thinking',
      childId: CHILD_ID,
      childName: CHILD_NAME,
      content: 'hello',
    });
  });

  it('tool_call_requested → agent_tool_use（带 input）', () => {
    const ev = translateChildEvent(
      childEvent({
        type: 'tool_call_requested',
        toolName: 'bash',
        input: { cmd: 'ls' },
      }),
      CHILD_ID,
      CHILD_NAME
    );
    expect(ev).toEqual({
      type: 'agent_tool_use',
      childId: CHILD_ID,
      childName: CHILD_NAME,
      toolName: 'bash',
      input: { cmd: 'ls' },
    });
  });

  it('agent_completed → agent_progress', () => {
    const ev = translateChildEvent(
      childEvent({ type: 'agent_completed', status: 'success' }),
      CHILD_ID,
      CHILD_NAME
    );
    expect(ev).toEqual({
      type: 'agent_progress',
      childId: CHILD_ID,
      childName: CHILD_NAME,
      status: 'sub-completed: success',
    });
  });

  it('context_compacted（摘要）→ agent_progress 带压缩信息', () => {
    const ev = translateChildEvent(
      childEvent({
        type: 'context_compacted',
        sessionId: CHILD_ID,
        turn: 1,
        removedCount: 12,
        tokensSaved: 4800,
        summarized: true,
      }),
      CHILD_ID,
      CHILD_NAME
    );
    expect(ev).not.toBeNull();
    expect(ev!.type).toBe('agent_progress');
    const progress = ev as { type: 'agent_progress' } & Record<string, unknown>;
    expect(progress.status).toBe('compacted');
    expect(progress.message).toContain('removed 12 records');
    expect(progress.message).toContain('saved ~4800 tokens');
    expect(progress.message).toContain('summarized');
  });

  it('context_compacted（同步切割）→ 无 summarized 标注', () => {
    const ev = translateChildEvent(
      childEvent({
        type: 'context_compacted',
        sessionId: CHILD_ID,
        turn: 2,
        removedCount: 6,
        tokensSaved: 2100,
        summarized: false,
      }),
      CHILD_ID,
      CHILD_NAME
    );
    const progress = ev as { message?: string };
    expect(progress.message).toContain('removed 6 records');
    expect(progress.message).not.toContain('summarized');
  });

  it('未知事件 → null', () => {
    expect(
      translateChildEvent(childEvent({ type: 'session_started', sessionId: CHILD_ID }), CHILD_ID, CHILD_NAME)
    ).toBeNull();
  });
});