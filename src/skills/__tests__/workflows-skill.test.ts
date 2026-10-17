import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { initI18n } from '@locales/i18n.js';
import type { SkillExecutionContext } from '../skill-types.js';
import {
  workflowsSkill,
  setWorkflowsDeps,
  __resetWorkflowsDepsForTest,
} from '../workflows-skill.js';

function makeContext(): SkillExecutionContext & { written: string[] } {
  const written: string[] = [];
  const context = {
    output: vi.fn((s: string) => {
      written.push(s);
    }),
    sessionId: 's1',
    turn: 1,
    cwd: '/tmp',
  } as unknown as SkillExecutionContext;
  return Object.assign(context, { written });
}

describe('workflowsSkill', () => {
  beforeAll(async () => {
    await initI18n('zh');
  });
  beforeEach(() => {
    __resetWorkflowsDepsForTest();
    vi.clearAllMocks();
  });

  it('definition 为 system/execute 且无 aliases', () => {
    expect(workflowsSkill.definition.name).toBe('workflows');
    expect(workflowsSkill.definition.category).toBe('system');
    expect(workflowsSkill.definition.riskLevel).toBe('execute');
    expect(
      (workflowsSkill.definition as Record<string, unknown>)['aliases'],
    ).toBeUndefined();
  });

  it('未装配时返回 error(notInit)', async () => {
    const ctx = makeContext();
    const ret = await workflowsSkill.execute(
      { positional: [], named: {}, raw: '' },
      ctx,
    );
    expect(ret.status).toBe('error');
    expect(ret.output.length).toBeGreaterThan(0);
  });

  it('无参推断为 list 并格式化输出', async () => {
    const list = vi.fn(async () => [
      { name: 'review', description: '只读评审' },
      { name: 'deploy' },
    ]);
    const submit = vi.fn();
    const query = vi.fn();
    setWorkflowsDeps({ list, submit, query });
    const ctx = makeContext();
    const ret = await workflowsSkill.execute(
      { positional: [], named: {}, raw: '' },
      ctx,
    );
    expect(ret.status).toBe('success');
    expect(list).toHaveBeenCalledOnce();
    expect(ret.output).toContain('review');
    expect(ctx.written.join('\n')).toContain('review');
  });

  it('首位置为 name 推断为 run, 校验+提交返回 taskId/runId', async () => {
    const list = vi.fn(async () => []);
    const submit = vi.fn(async (_input: unknown) => ({ taskId: 't-1', runId: 'r-1' }));
    const query = vi.fn(async () => null);
    setWorkflowsDeps({ list, submit, query });
    const ctx = makeContext();
    const ret = await workflowsSkill.execute(
      { positional: ['review', './src'], named: {}, raw: 'review ./src' },
      ctx,
    );
    expect(ret.status).toBe('success');
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]?.[0]).toMatchObject({ name: 'review' });
    expect(ret.output).toContain('t-1');
    expect(ret.output).toContain('r-1');
    if (ret.status !== 'success') throw new Error('expected success');
    expect(ret.data).toMatchObject({ taskId: 't-1', runId: 'r-1' });
  });
});
