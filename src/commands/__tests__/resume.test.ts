/**
 * resume.test.ts - Resume 命令单元测试
 *
 * 覆盖：
 * - restoreHistoryFromRecords：从 session 记录恢复历史
 *   （保留 message/tool_call/tool_result/summary，过滤非历史记录）
 * - createResumedSessionMetadata：恢复 session 元数据映射与默认值 fallback
 */
import { describe, it, expect } from 'vitest';

import { restoreHistoryFromRecords, createResumedSessionMetadata } from '../resume.js';
import type { SessionDetail } from '@core/runtime/session-index.js';

function record(type: string, extra: Record<string, unknown> = {}): any {
  return { type, ...extra };
}

describe('restoreHistoryFromRecords', () => {
  it('保留 message / tool_call / tool_result / summary', () => {
    const records = [
      record('session', { cwd: '/tmp' }),
      record('message', { role: 'user', content: 'hi' }),
      record('tool_call', { callId: 'c1' }),
      record('tool_result', { callId: 'c1' }),
      record('summary', { content: 'earlier context' }),
    ];
    const history = restoreHistoryFromRecords(records);
    expect(history.map((r) => r.type)).toEqual(['message', 'tool_call', 'tool_result', 'summary']);
  });

  it('过滤非历史记录（session/usage/compaction/permission/end）', () => {
    const records = [
      record('session'),
      record('usage', { usage: {} }),
      record('compaction', { removedCount: 5 }),
      record('permission', { decision: 'allow' }),
      record('session_end'),
      record('message', { role: 'assistant', content: 'ok' }),
    ];
    const history = restoreHistoryFromRecords(records);
    expect(history.length).toBe(1);
    expect(history[0].type).toBe('message');
  });

  it('空记录返回空数组', () => {
    expect(restoreHistoryFromRecords([])).toEqual([]);
  });
});

describe('createResumedSessionMetadata', () => {
  function makeDetail(overrides: Partial<SessionDetail> = {}): SessionDetail {
    return {
      id: 's1',
      path: '/tmp/s1.jsonl',
      createdAt: '2026-08-08T00:00:00.000Z',
      updatedAt: '2026-08-08T00:00:00.000Z',
      messageCount: 2,
      hasChildren: false,
      childNames: [],
      records: [],
      ...overrides,
    };
  }

  it('完整字段映射', () => {
    const meta = createResumedSessionMetadata(
      makeDetail({ cwd: '/proj', mode: 'multi', providerId: 'jdcloud' })
    );
    expect(meta).toEqual({
      id: 's1',
      path: '/tmp/s1.jsonl',
      cwd: '/proj',
      mode: 'multi',
      providerId: 'jdcloud',
    });
  });

  it('缺失字段 fallback（cwd → process.cwd，mode → single，providerId → local）', () => {
    const meta = createResumedSessionMetadata(makeDetail({ cwd: undefined, mode: undefined, providerId: undefined }));
    expect(meta.cwd).toBe(process.cwd());
    expect(meta.mode).toBe('single');
    expect(meta.providerId).toBe('local');
  });
});