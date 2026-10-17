import { describe, it, expect, vi } from 'vitest';
import { createWorkflowTool } from '../workflow-tool.js';
import type { ToolExecutionContext } from '../../core/tool-types.js';

function makeCtx(): ToolExecutionContext {
  return {
    sessionId: 's1',
    turn: 1,
    cwd: '/tmp',
  };
}

describe('createWorkflowTool', () => {
  it('name/riskLevel/description 符合契约', () => {
    const tool = createWorkflowTool({
      submit: vi.fn(async () => ({ taskId: 't', runId: 'r' })),
    });
    expect(tool.name).toBe('workflow');
    expect(tool.riskLevel).toBe('execute');
    expect(tool.description).toContain('禁止擅调');
  });

  it('schema 校验失败返回 error（args 超限 / 非法 uuid）', async () => {
    const tool = createWorkflowTool({
      submit: vi.fn(async () => ({ taskId: 't', runId: 'r' })),
    });
    const tooMany = await tool.execute(
      {
        name: 'x',
        script: 'return 1',
        args: Array.from({ length: 21 }, (_, i) => `a${i}`),
      },
      makeCtx(),
    );
    expect(tooMany.status).toBe('error');

    const badUuid = await tool.execute(
      { script: 'return 1', resumeFromRunId: 'not-a-uuid' },
      makeCtx(),
    );
    expect(badUuid.status).toBe('error');
  });

  it('script/scriptPath 二选一：并存 error，全缺省 error', async () => {
    const submit = vi.fn(async () => ({ taskId: 't', runId: 'r' }));
    const tool = createWorkflowTool({ submit });
    const neither = await tool.execute({}, makeCtx());
    expect(neither.status).toBe('error');

    const both = await tool.execute(
      { name: 'x', script: 'a', scriptPath: './b.js' },
      makeCtx(),
    );
    expect(both.status).toBe('error');
    expect(submit).not.toHaveBeenCalled();
  });

  it('name 引用（无 script）可提交', async () => {
    const submit = vi.fn(async () => ({ taskId: 't-1', runId: 'r-1' }));
    const tool = createWorkflowTool({ submit });
    const ret = await tool.execute({ name: 'review' }, makeCtx());
    expect(ret.status).toBe('success');
    expect(submit).toHaveBeenCalledOnce();
    if (ret.status !== 'success') throw new Error('expected success');
    expect(ret.output).toBe(JSON.stringify({ taskId: 't-1', runId: 'r-1' }));
    expect(ret.data).toMatchObject({ taskId: 't-1', runId: 'r-1' });
  });

  it('未装配返回 error', async () => {
    const tool = createWorkflowTool();
    const ret = await tool.execute({ name: 'review' }, makeCtx());
    expect(ret.status).toBe('error');
  });
});
