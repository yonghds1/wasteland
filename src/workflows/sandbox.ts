import * as vm from 'node:vm';
import type { WorkflowErrorCode } from './errors.js';

export interface WorkflowSandboxApi {
  agent: (...args: unknown[]) => unknown;
  parallel: (...args: unknown[]) => unknown;
  args?: unknown;
  budget?: unknown;
  onPhase?: (name: string) => void;
  onLog?: (message: string) => void;
}

export interface WorkflowSandboxContext {
  agent: (...args: unknown[]) => unknown;
  parallel: (...args: unknown[]) => unknown;
  phase: (name: string) => void;
  log: (message: string) => void;
  args: unknown;
  budget: unknown;
  workflow: (...args: unknown[]) => never;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

export interface RunScriptOptions {
  timeoutMs?: number;
  filename?: string;
}

const DEFAULT_TIMEOUT_MS = 5000;

class WorkflowSandboxError extends Error {
  readonly code: WorkflowErrorCode;

  constructor(code: WorkflowErrorCode, message: string) {
    super(message);
    this.name = 'WorkflowSandboxError';
    this.code = code;
  }
}

function fail(code: WorkflowErrorCode, message: string): never {
  throw new WorkflowSandboxError(code, message);
}

function isVmTimeoutError(err: unknown): boolean {
  if (typeof err === "object" && err !== null) {
    const code = (err as { code?: unknown }).code;
    if (code === "ERR_SCRIPT_EXECUTION_TIMEOUT") return true;
  }
  if (!(err instanceof Error)) return false;
  return /timed out|terminat/i.test(err.message);
}

/**
 * 构造白名单上下文：仅暴露 agent / parallel / phase / log /
 * args / budget / workflow 七个键，无 require / process / fs。
 */
export function createWorkflowContext(
  api: WorkflowSandboxApi,
): WorkflowSandboxContext {
  const agent = (...args: unknown[]): unknown => {
    if (typeof api.agent !== 'function') {
      return fail(
        'E_WORKFLOW_NOT_FOUND',
        'workflow api "agent" is unavailable',
      );
    }
    return api.agent(...args);
  };
  const parallel = (...args: unknown[]): unknown => {
    if (typeof api.parallel !== 'function') {
      return fail(
        'E_WORKFLOW_NOT_FOUND',
        'workflow api "parallel" is unavailable',
      );
    }
    return api.parallel(...args);
  };
  const phase = (name: string): void => {
    api.onPhase?.(String(name));
  };
  const log = (message: string): void => {
    api.onLog?.(String(message));
  };
  const workflow = (..._args: unknown[]): never =>
    fail('E_WORKFLOW_NESTED', 'nested workflow() is disabled in this release');
  return {
    agent,
    parallel,
    phase,
    log,
    args: api.args,
    budget: api.budget,
    workflow,
    setTimeout,
    clearTimeout,
  };
}

/**
 * 在 node:vm 沙箱中执行 workflow 脚本。
 * 同步死循环由 vm timeout 中断，异步悬挂由竞速定时器中断，
 * 超时统一抛 E_WORKFLOW_ABORT_TIMEOUT。
 */
export async function runScript(
  code: string,
  api: WorkflowSandboxApi,
  opts: RunScriptOptions = {},
): Promise<unknown> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const filename = opts.filename ?? 'workflow.vm.js';
  const exposed = createWorkflowContext(api);
  const sandbox: Record<string, unknown> = { ...exposed };
  vm.createContext(sandbox, { name: 'wasteland-workflow' });
  const wrapped = `(async () => {\n${code}\n})()`;
  const script = new vm.Script(wrapped, { filename });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutGate = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new WorkflowSandboxError(
          'E_WORKFLOW_ABORT_TIMEOUT',
          `workflow aborted: timeout after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);
    const t = timer as unknown as { unref?: () => void };
    if (typeof t.unref === 'function') t.unref();
  });
  try {
    const raw: unknown = script.runInContext(sandbox, {
      timeout: timeoutMs,
      displayErrors: true,
    });
    return await Promise.race([Promise.resolve(raw), timeoutGate]);
  } catch (err) {
    if (err instanceof WorkflowSandboxError) throw err;
    if (isVmTimeoutError(err)) {
      throw new WorkflowSandboxError(
        'E_WORKFLOW_ABORT_TIMEOUT',
        `workflow aborted: timeout after ${timeoutMs}ms`,
      );
    }
    throw err;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
