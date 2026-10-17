import { describe, expect, it } from 'vitest';
import { createWorkflowContext, runScript } from '../sandbox.js';
import type { WorkflowSandboxApi } from '../sandbox.js';

function makeApi(overrides: Partial<WorkflowSandboxApi> = {}): {
  api: WorkflowSandboxApi;
  phases: string[];
  logs: string[];
} {
  const phases: string[] = [];
  const logs: string[] = [];
  const api: WorkflowSandboxApi = {
    agent: async (...args: unknown[]) => ({ ok: true, args }),
    parallel: async (...args: unknown[]) => args,
    args: { input: 1 },
    budget: { tokens: 100 },
    onPhase: (name: string) => {
      phases.push(name);
    },
    onLog: (message: string) => {
      logs.push(message);
    },
    ...overrides,
  };
  return { api, phases, logs };
}

function codeOfErr(err: unknown): string | undefined {
  return (err as { code?: string } | null | undefined)?.code;
}

async function rejectsWithCode(
  promise: Promise<unknown>,
): Promise<string | undefined> {
  try {
    await promise;
  } catch (err) {
    return codeOfErr(err);
  }
  throw new Error('expected promise to reject');
}

describe('sandbox whitelist', () => {
  it('上下文只暴露白名单键（DSL 七件套 + 定时器）', () => {
    const { api } = makeApi();
    const ctx = createWorkflowContext(api);
    expect(Object.keys(ctx).sort()).toEqual(
      ['agent', 'args', 'budget', 'clearTimeout', 'log', 'parallel', 'phase', 'setTimeout', 'workflow'].sort(),
    );
    expect((ctx as unknown as Record<string, unknown>).process).toBeUndefined();
    expect((ctx as unknown as Record<string, unknown>).require).toBeUndefined();
    expect((ctx as unknown as Record<string, unknown>).fs).toBeUndefined();
  });

  it('白名单外访问抛错（process / require 不可用）', async () => {
    const { api } = makeApi();
    await expect(
      runScript('process.cwd()', api, { timeoutMs: 1000 }),
    ).rejects.toThrow();
    await expect(
      runScript("require('fs')", api, { timeoutMs: 1000 }),
    ).rejects.toThrow();
    await expect(
      runScript('fs.readFileSync("/etc/passwd", "utf8")', api, {
        timeoutMs: 1000,
      }),
    ).rejects.toThrow();
  });

  it('白名单函数在沙箱内可调用', async () => {
    const { api } = makeApi();
    await expect(
      runScript('await agent({ a: 1 }); await parallel([]);', api, {
        timeoutMs: 1000,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('sandbox runScript', () => {
  it('同步死循环超时抛 E_WORKFLOW_ABORT_TIMEOUT', async () => {
    const { api } = makeApi();
    const code = await rejectsWithCode(
      runScript('while (true) {}', api, { timeoutMs: 100 }),
    );
    expect(code).toBe('E_WORKFLOW_ABORT_TIMEOUT');
  });

  it('异步悬挂超时抛 E_WORKFLOW_ABORT_TIMEOUT', async () => {
    const { api } = makeApi();
    const code = await rejectsWithCode(
      runScript('await new Promise(() => {})', api, { timeoutMs: 100 }),
    );
    expect(code).toBe('E_WORKFLOW_ABORT_TIMEOUT');
  });

  it('workflow() 直接抛 E_WORKFLOW_NESTED 禁用嵌套', async () => {
    const { api } = makeApi();
    const code = await rejectsWithCode(
      runScript('workflow()', api, { timeoutMs: 1000 }),
    );
    expect(code).toBe('E_WORKFLOW_NESTED');
  });

  it('phase / log 只记录并触发 onPhase / onLog 回调', async () => {
    const { api, phases, logs } = makeApi();
    await runScript("phase('plan'); log('hello'); phase('done');", api, {
      timeoutMs: 1000,
    });
    expect(phases).toEqual(['plan', 'done']);
    expect(logs).toEqual(['hello']);
  });
});
