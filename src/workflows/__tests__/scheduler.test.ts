import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorkflowScheduler } from "../scheduler.js";
import type { SpawnFn } from "../scheduler.js";
import { E_WORKFLOW_QUOTA_EXCEEDED } from "../errors.js";

function makeSpawn(): SpawnFn {
  return async (prompt: string, opts: { schema?: unknown }) => {
    if (opts?.schema)
      return { text: JSON.stringify({ ok: true }), usage: { inputTokens: 10, outputTokens: 5 } };
    return { text: `echo:${prompt}`, usage: { inputTokens: 10, outputTokens: 5 } };
  };
}

async function tmpSession(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "wf-test-"));
}

async function waitFor(s: WorkflowScheduler, runId: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const d = s.query(runId);
    if (d.status !== "running") return;
    if (Date.now() - start > timeoutMs)
      throw new Error(`timeout waiting for ${runId}, still running`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const SLEEP = "await new Promise((r) => setTimeout(r, 50));";

describe("scheduler", () => {
  it("submit returns immediately without waiting", async () => {
    const sessionDir = await tmpSession();
    const journal: unknown[] = [];
    const events: unknown[] = [];
    const s = new WorkflowScheduler({
      spawn: makeSpawn(),
      sessionDir,
      journalAppend: (e) => journal.push(e),
      emit: (e) => events.push(e),
      concurrency: 2,
    });
    const p = s.submit({ script: `${SLEEP} return 42;`, args: {} }, { cwd: sessionDir });
    expect(p instanceof Promise).toBe(true);
    const { taskId, runId } = await p;
    expect(taskId.startsWith("task-")).toBe(true);
    expect(runId.startsWith("run-")).toBe(true);
    expect(s.list().length).toBe(1);
    await waitFor(s, runId);
    const d = s.query(runId);
    expect(d.status).toBe("succeeded");
    const fin = JSON.parse(
      await fs.readFile(path.join(sessionDir, "workflows", runId, "final-state.json"), "utf8"),
    );
    expect(fin.status).toBe("succeeded");
    expect(fin.result).toBe(42);
  });

  it("parallel preserves result order", async () => {
    const sessionDir = await tmpSession();
    const s = new WorkflowScheduler({
      spawn: makeSpawn(),
      sessionDir,
      journalAppend: () => undefined,
      emit: () => undefined,
    });
    const script = `const out = await parallel([async () => { await new Promise((r) => setTimeout(r, 40)); return 1; }, async () => { return 2; }, async () => { await new Promise((r) => setTimeout(r, 5)); return 3; }]); return out;`;
    const { runId } = await s.submit({ script, args: {} }, { cwd: sessionDir });
    await waitFor(s, runId);
    const d = s.query(runId);
    expect(d.status).toBe("succeeded");
    expect((d.finalState as unknown as { result: unknown }).result).toEqual([1, 2, 3]);
  });

  it("rejects when over concurrency with quota code", async () => {
    const sessionDir = await tmpSession();
    const s = new WorkflowScheduler({
      spawn: makeSpawn(),
      sessionDir,
      journalAppend: () => undefined,
      emit: () => undefined,
      concurrency: 1,
    });
    const longScript = `await new Promise((r) => setTimeout(r, 600)); return 1;`;
    const first = await s.submit({ script: longScript, args: {} }, { cwd: sessionDir });
    expect(Boolean(first.runId)).toBe(true);
    const err = await s
      .submit({ script: "return 2;", args: {} }, { cwd: sessionDir })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect((err as { code?: string } | null)?.code).toBe(E_WORKFLOW_QUOTA_EXCEEDED);
    await s.cancel(first.runId);
    await waitFor(s, first.runId);
  });

  it("cancel marks cancelled and writes final-state", async () => {
    const sessionDir = await tmpSession();
    const s = new WorkflowScheduler({
      spawn: makeSpawn(),
      sessionDir,
      journalAppend: () => undefined,
      emit: () => undefined,
    });
    const { runId } = await s.submit(
      { script: `await new Promise((r) => setTimeout(r, 2000)); return 1;`, args: {} },
      { cwd: sessionDir },
    );
    await s.cancel(runId);
    await waitFor(s, runId);
    const d = s.query(runId);
    expect(d.status).toBe("cancelled");
    const fin = JSON.parse(
      await fs.readFile(path.join(sessionDir, "workflows", runId, "final-state.json"), "utf8"),
    );
    expect(fin.status).toBe("cancelled");
    const wf = await fs.readFile(
      path.join(sessionDir, "workflows", runId, "workflow.json"),
      "utf8",
    );
    expect(wf.includes(runId)).toBe(true);
    const journal = await fs.readFile(
      path.join(sessionDir, "workflows", runId, "journal.jsonl"),
      "utf8",
    );
    expect(journal.length > 0).toBe(true);
  });

  it("query supports both taskId and runId keys", async () => {
    const sessionDir = await tmpSession();
    const s = new WorkflowScheduler({
      spawn: makeSpawn(),
      sessionDir,
      journalAppend: () => undefined,
      emit: () => undefined,
    });
    const { taskId, runId } = await s.submit(
      { script: "return 7;", args: { a: 1 } },
      { cwd: sessionDir },
    );
    await waitFor(s, runId);
    const byTask = s.query(taskId);
    const byRun = s.query(runId);
    expect(byTask.runId).toBe(byRun.runId);
    expect(byTask.taskId).toBe(taskId);
    expect(byRun.taskId).toBe(taskId);
    expect((byTask.finalState as unknown as { result: unknown }).result).toBe(7);
  });
});
