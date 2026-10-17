/**
 * scheduler.ts - workflow 后台调度器
 *
 * 后台 detached 执行 workflow 脚本：
 * - submit 立即返回 {taskId, runId}，不阻塞主会话
 * - agent() 映射到注入的 SpawnFn；有 schema 则 JSON 解析 + zod 校验，
 *   失败换模型重试 1 次（双倍计费）
 * - parallel 为 Promise.all 语义，任一失败抛 E_PARALLEL_FAIL_FAST
 * - journal 落盘 + BudgetLedger 累加 + 并发上限（超限直接失败）
 */

import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ZodTypeAny } from "zod";
import { runScript } from "./sandbox.js";
import {
  defaultGlobalDir,
  defaultProjectDir,
  resolveTrusted,
  resolveUserPath,
  scanManifests,
} from "./loader.js";
import {
  E_WORKFLOW_NOT_FOUND,
  E_WORKFLOW_QUOTA_EXCEEDED,
  E_PARALLEL_FAIL_FAST,
} from "./errors.js";
import type { JournalEntry, FinalState } from "./types.js";
import { BudgetLedger, costForUsage } from "./budget.js";

export type SpawnFn = (
  prompt: string,
  opts: { model?: string; tools?: string[]; timeoutMs?: number; schema?: ZodTypeAny },
) => Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }>;

export type RunStatus = "running" | "succeeded" | "failed" | "cancelled";

export interface RunSummary {
  taskId: string;
  runId: string;
  name: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
}

export interface RunDetail extends RunSummary {
  args: Record<string, unknown>;
  script?: string;
  scriptPath?: string;
  journal: JournalEntry[];
  finalState?: FinalState;
  usage: { inputTokens: number; outputTokens: number };
  spent: number;
}

export interface SubmitInput {
  name?: string;
  script?: string;
  scriptPath?: string;
  args?: Record<string, unknown>;
  resumeFromRunId?: string;
}

export interface SchedulerDeps {
  spawn: SpawnFn;
  sessionDir: string;
  journalAppend(entry: JournalEntry): void;
  emit(event: unknown): void;
  concurrency?: number;
  defaultTimeoutMs?: number;
}

interface RunRecord extends RunSummary {
  args: Record<string, unknown>;
  script: string;
  scriptPath?: string;
  journal: JournalEntry[];
  usage: { inputTokens: number; outputTokens: number };
  spent: number;
  aborted: boolean;
  finalState?: FinalState;
  resumeFromRunId?: string;
}

function codedError(code: string, message: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

function trySchemaParse(
  text: string,
  schema: ZodTypeAny,
): { ok: boolean; data?: unknown; error?: unknown } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: e };
  }
  const r = schema.safeParse(json);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, error: r.error };
}

/** 内置剧本目录：随包发布（src→src/workflows/../../workflows/builtin，dist同理）。 */
function builtinDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "workflows", "builtin");
}

export class WorkflowScheduler {
  private deps: SchedulerDeps;
  private sessionDir: string;
  private concurrency: number;
  private defaultTimeoutMs: number;
  private runs = new Map<string, RunRecord>();
  private taskIndex = new Map<string, string>();

  constructor(deps: SchedulerDeps) {
    this.deps = deps;
    this.sessionDir = deps.sessionDir;
    this.concurrency = deps.concurrency ?? 2;
    this.defaultTimeoutMs = deps.defaultTimeoutMs ?? 600000;
  }

  async submit(
    input: SubmitInput,
    ctx: { cwd: string },
  ): Promise<{ taskId: string; runId: string }> {
    const running = [...this.runs.values()].filter((r) => r.status === "running").length;
    if (running >= this.concurrency) {
      throw codedError(
        E_WORKFLOW_QUOTA_EXCEEDED,
        `concurrency limit ${this.concurrency} exceeded`,
      );
    }
    const taskId = `task-${randomUUID().slice(0, 8)}`;
    const runId = `run-${randomUUID().slice(0, 8)}`;
    const name = input.name ?? input.scriptPath ?? "workflow";
    const args: Record<string, unknown> = { ...(input.args ?? {}) };
    const code = await this.resolveScript(input, ctx.cwd);
    const startedAt = new Date().toISOString();
    const record: RunRecord = {
      taskId,
      runId,
      name,
      status: "running",
      startedAt,
      args,
      script: code,
      scriptPath: input.scriptPath,
      journal: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      spent: 0,
      aborted: false,
      resumeFromRunId: input.resumeFromRunId,
    };
    this.runs.set(runId, record);
    this.taskIndex.set(taskId, runId);
    const dir = path.join(this.sessionDir, "workflows", runId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "workflow.json"),
      JSON.stringify(
        {
          taskId,
          runId,
          name,
          args,
          startedAt,
          status: "running",
          resumeFromRunId: input.resumeFromRunId ?? null,
        },
        null,
        2,
      ),
      "utf8",
    );
    await fs.writeFile(path.join(dir, "journal.jsonl"), "", "utf8");
    this.pushJournal(record, dir, "progress", `workflow ${name} started`);
    this.deps.emit({ type: "workflow.start", taskId, runId, name, args });
    void this.execute(record, code, dir);
    return { taskId, runId };
  }

  list(): RunSummary[] {
    return [...this.runs.values()].map((r) => ({
      taskId: r.taskId,
      runId: r.runId,
      name: r.name,
      status: r.status,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
    }));
  }

  query(id: string): RunDetail {
    const record = this.runs.get(id) ?? this.runs.get(this.taskIndex.get(id) ?? "");
    if (!record) throw codedError(E_WORKFLOW_NOT_FOUND, `run not found: ${id}`);
    return {
      taskId: record.taskId,
      runId: record.runId,
      name: record.name,
      status: record.status,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      args: { ...record.args },
      script: record.script,
      scriptPath: record.scriptPath,
      journal: [...record.journal],
      finalState: record.finalState,
      usage: { ...record.usage },
      spent: record.spent,
    };
  }

  async cancel(runId: string): Promise<void> {
    const record = this.runs.get(runId);
    if (!record) throw codedError(E_WORKFLOW_NOT_FOUND, `run not found: ${runId}`);
    if (record.status !== "running") return;
    record.aborted = true;
    record.status = "cancelled";
    record.finishedAt = new Date().toISOString();
    const finalState = {
      runId: record.runId,
      workflowName: record.name,
      codeVersion: "unknown",
      status: "cancelled",
      outputs: {},
      usageTotal: { ...record.usage },
      startedAt: record.startedAt,
      endedAt: record.finishedAt,
    } as FinalState;
    record.finalState = finalState;
    const dir = path.join(this.sessionDir, "workflows", record.runId);
    this.pushJournal(record, dir, "cancelled", "workflow cancelled");
    await this.writeFinalState(dir, finalState);
    this.deps.emit({ type: "workflow.cancel", taskId: record.taskId, runId: record.runId });
  }

  private async resolveScript(input: SubmitInput, cwd: string): Promise<string> {
    if (typeof input.script === "string") return input.script;
    if (typeof input.scriptPath === "string") {
      const abs = resolveUserPath(input.scriptPath, cwd);
      return await fs.readFile(abs, "utf8");
    }
    if (typeof input.name === "string") {
      const manifests = await scanManifests([
        { dir: defaultGlobalDir(), scope: "global" },
        { dir: builtinDir(), scope: "global" },
        { dir: defaultProjectDir(cwd), scope: "project" },
      ]);
      const handle = resolveTrusted(input.name, manifests);
      return await fs.readFile(handle.path, "utf8");
    }
    throw codedError(E_WORKFLOW_NOT_FOUND, "submit requires one of script/scriptPath/name");
  }

  private pushJournal(record: RunRecord, dir: string, event: JournalEntry["event"], message: string): void {
    const entry = {
      seq: record.journal.length,
      ts: new Date().toISOString(),
      runId: record.runId,
      event,
      message,
    } as JournalEntry;
    record.journal.push(entry);
    try {
      this.deps.journalAppend(entry);
    } catch {
      // host journal failures must not break the run
    }
    void fs
      .appendFile(path.join(dir, "journal.jsonl"), JSON.stringify(entry) + "\n", "utf8")
      .catch(() => undefined);
  }

  private async writeFinalState(dir: string, finalState: FinalState): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "final-state.json"),
      JSON.stringify(finalState, null, 2),
      "utf8",
    );
  }

  private async execute(record: RunRecord, code: string, dir: string): Promise<void> {
    const rawEstimated =
      (record.args as Record<string, unknown>)["estimated"] ??
      (record.args as Record<string, unknown>)["budget"];
    const estimated = Number(rawEstimated ?? 10) || 10;
    const ledger = new BudgetLedger({
      estimated,
      onWarn: () =>
        this.deps.emit({
          type: "budget.warn",
          taskId: record.taskId,
          runId: record.runId,
          spent: ledger.spent,
        }),
      onConfirm: () =>
        this.deps.emit({
          type: "budget.confirm",
          taskId: record.taskId,
          runId: record.runId,
          spent: ledger.spent,
        }),
      onHard: () =>
        this.deps.emit({
          type: "budget.hard",
          taskId: record.taskId,
          runId: record.runId,
          spent: ledger.spent,
        }),
    });

    const checkCancelled = (): void => {
      if (record.aborted) throw codedError("E_WORKFLOW_CANCELLED", "workflow cancelled");
    };
    const addUsage = (u: { inputTokens: number; outputTokens: number }): void => {
      record.usage.inputTokens += Number(u.inputTokens) || 0;
      record.usage.outputTokens += Number(u.outputTokens) || 0;
    };

    const agent = async (
      prompt: string,
      opts: { model?: string; tools?: string[]; timeoutMs?: number; schema?: ZodTypeAny } = {},
    ): Promise<unknown> => {
      checkCancelled();
      const model = opts.model ?? "deepseek-v4.1-flash";
      const callOpts = {
        model,
        tools: opts.tools,
        timeoutMs: opts.timeoutMs ?? this.defaultTimeoutMs,
        schema: opts.schema,
      };
      const first = await this.deps.spawn(prompt, callOpts);
      addUsage(first.usage);
      ledger.charge(first.usage, model);
      record.spent = ledger.spent;
      if (!opts.schema) return first.text;
      const p1 = trySchemaParse(first.text, opts.schema);
      if (p1.ok) return p1.data;
      const second = await this.deps.spawn(prompt, callOpts);
      addUsage(second.usage);
      ledger.charge(costForUsage(second.usage, model) * 2);
      record.spent = ledger.spent;
      const p2 = trySchemaParse(second.text, opts.schema);
      if (!p2.ok)
        throw p2.error instanceof Error ? p2.error : new Error("agent schema parse failed");
      return p2.data;
    };

    const parallel = async (...args: unknown[]): Promise<unknown[]> => {
      checkCancelled();
      const tasks: unknown[] =
        args.length === 1 && Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
      try {
        const promises = tasks.map((t) =>
          typeof t === "function" ? (t as () => Promise<unknown>)() : (t as Promise<unknown>),
        );
        return await Promise.all(promises);
      } catch {
        throw codedError(E_PARALLEL_FAIL_FAST, "parallel fail-fast");
      }
    };

    const onPhase = (name: string): void => {
      this.pushJournal(record, dir, "phase", String(name));
    };
    const onLog = (message: string): void => {
      this.pushJournal(record, dir, "log", String(message));
    };
    try {
      const sandboxAgent = (...a: unknown[]): unknown =>
        agent(a[0] as string, ((a[1] ?? {}) as { model?: string; tools?: string[]; timeoutMs?: number; schema?: ZodTypeAny }));
      const result = await runScript(
        code,
        {
          agent: sandboxAgent,
          parallel: parallel as (...args: unknown[]) => unknown,
          args: Object.freeze({ ...record.args }),
          budget: Object.freeze({ spent: ledger.spent, estimated: ledger.estimated }),
          onPhase,
          onLog,
        },
        { timeoutMs: this.defaultTimeoutMs, filename: `workflow-${record.runId}.js` },
      );
      if (record.aborted || record.status === "cancelled") return;
      record.status = "succeeded";
      record.finishedAt = new Date().toISOString();
      const finalState = {
        runId: record.runId,
        workflowName: record.name,
        codeVersion: "unknown",
        status: "succeeded",
        outputs: {},
        result,
        usageTotal: { ...record.usage },
        startedAt: record.startedAt,
        endedAt: record.finishedAt,
      } as FinalState;
      record.finalState = finalState;
      record.spent = ledger.spent;
      this.pushJournal(record, dir, "done", "workflow succeeded");
      await this.writeFinalState(dir, finalState);
      this.deps.emit({
        type: "workflow.done",
        taskId: record.taskId,
        runId: record.runId,
        name: record.name,
        result,
        usage: { ...record.usage },
      });
    } catch (e) {
      if (record.aborted || record.status === "cancelled") {
        if (!record.finalState) {
          const fallback = {
            runId: record.runId,
            workflowName: record.name,
            codeVersion: "unknown",
            status: "cancelled",
            outputs: {},
            usageTotal: { ...record.usage },
            startedAt: record.startedAt,
            endedAt: record.finishedAt ?? new Date().toISOString(),
          } as FinalState;
          record.finalState = fallback;
          await this.writeFinalState(dir, fallback);
        }
        return;
      }
      record.status = "failed";
      record.finishedAt = new Date().toISOString();
      const err = e as Error & { code?: string };
      const finalState = {
        runId: record.runId,
        workflowName: record.name,
        codeVersion: "unknown",
        status: "failed",
        outputs: {},
        result: null,
        usageTotal: { ...record.usage },
        startedAt: record.startedAt,
        endedAt: record.finishedAt,
      } as FinalState;
      record.finalState = finalState;
      record.spent = ledger.spent;
      this.pushJournal(record, dir, "error", err?.message ?? String(e));
      await this.writeFinalState(dir, finalState);
      this.deps.emit({
        type: "workflow.error",
        taskId: record.taskId,
        runId: record.runId,
        error: err?.message,
        code: err?.code ?? null,
      });
    }
  }
}
