import { describe, expect, it } from "vitest";
import {
  finalStateSchema,
  journalEntrySchema,
  runStatusSchema,
  submitInputSchema,
} from "../types.js";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const TS = "2026-10-16T00:00:00.000Z";

describe("runStatus", () => {
  it("accepts all contract statuses", () => {
    for (const s of ["running", "done", "interrupted", "failed", "cancelled"]) {
      expect(runStatusSchema.safeParse(s).success).toBe(true);
    }
    expect(runStatusSchema.safeParse("succeeded").success).toBe(false);
  });
});

describe("submitInputSchema", () => {
  it("accepts script-only and scriptPath-only inputs", () => {
    expect(
      submitInputSchema.safeParse({ name: "demo-1", script: "hello" }).success,
    ).toBe(true);
    expect(
      submitInputSchema.safeParse({ name: "demo-1", scriptPath: "./w.yaml" })
        .success,
    ).toBe(true);
    expect(
      submitInputSchema.safeParse({
        name: "demo-1",
        script: "hello",
        args: ["a", "b"],
        resumeFromRunId: UUID,
      }).success,
    ).toBe(true);
  });

  it("rejects missing/both script fields", () => {
    expect(submitInputSchema.safeParse({ name: "demo" }).success).toBe(false);
    expect(
      submitInputSchema.safeParse({
        name: "demo",
        script: "a",
        scriptPath: "./w.yaml",
      }).success,
    ).toBe(false);
  });

  it("rejects bad name, oversized script, args over limit", () => {
    expect(
      submitInputSchema.safeParse({ name: "Bad_Name!", script: "x" }).success,
    ).toBe(false);
    expect(
      submitInputSchema.safeParse({ name: "", script: "x" }).success,
    ).toBe(false);
    expect(
      submitInputSchema.safeParse({ name: "a".repeat(65), script: "x" })
        .success,
    ).toBe(false);
    expect(
      submitInputSchema.safeParse({ name: "ok", script: "x".repeat(8193) })
        .success,
    ).toBe(false);
    expect(
      submitInputSchema.safeParse({
        name: "ok",
        script: "x",
        args: Array.from({ length: 21 }, (_, i) => `a${i}`),
      }).success,
    ).toBe(false);
    expect(
      submitInputSchema.safeParse({
        name: "ok",
        script: "x",
        args: ["x".repeat(1025)],
      }).success,
    ).toBe(false);
  });

  it("rejects non-uuid resumeFromRunId", () => {
    expect(
      submitInputSchema.safeParse({
        name: "ok",
        script: "x",
        resumeFromRunId: "not-a-uuid",
      }).success,
    ).toBe(false);
  });
});

describe("journalEntrySchema", () => {
  it("accepts minimal and full entries", () => {
    expect(
      journalEntrySchema.safeParse({
        seq: 0,
        ts: TS,
        runId: UUID,
        event: "agent_start",
      }).success,
    ).toBe(true);
    expect(
      journalEntrySchema.safeParse({
        seq: 3,
        ts: TS,
        runId: UUID,
        agentId: "agent-1",
        event: "agent_end",
        promptHash: "abc",
        codeVersion: "v1",
        resultRef: "ref-1",
        cached: true,
        usage: { inputTokens: 10, outputTokens: 5 },
        status: "ok",
        message: "done",
      }).success,
    ).toBe(true);
  });

  it("rejects bad event, ts, seq", () => {
    expect(
      journalEntrySchema.safeParse({
        seq: 0,
        ts: TS,
        runId: UUID,
        event: "nope",
      }).success,
    ).toBe(false);
    expect(
      journalEntrySchema.safeParse({
        seq: 0,
        ts: "not-a-date",
        runId: UUID,
        event: "log",
      }).success,
    ).toBe(false);
    expect(
      journalEntrySchema.safeParse({
        seq: -1,
        ts: TS,
        runId: UUID,
        event: "log",
      }).success,
    ).toBe(false);
    expect(
      journalEntrySchema.safeParse({ seq: 0, ts: TS, event: "log" }).success,
    ).toBe(false);
  });
});

describe("finalStateSchema", () => {
  it("accepts a full final state", () => {
    const r = finalStateSchema.safeParse({
      runId: UUID,
      workflowName: "demo-1",
      codeVersion: "v1",
      status: "succeeded",
      outputs: { a: "b" },
      usageTotal: { inputTokens: 1, outputTokens: 2 },
      startedAt: TS,
      endedAt: TS,
      resumeFromRunId: UUID,
    });
    expect(r.success).toBe(true);
  });

  it("rejects bad status, outputs, dates", () => {
    const base = {
      runId: UUID,
      workflowName: "demo-1",
      codeVersion: "v1",
      status: "succeeded",
      outputs: {},
      usageTotal: { inputTokens: 0, outputTokens: 0 },
      startedAt: TS,
      endedAt: TS,
    };
    expect(
      finalStateSchema.safeParse({ ...base, status: "running" }).success,
    ).toBe(false);
    expect(
      finalStateSchema.safeParse({ ...base, outputs: { a: 1 } }).success,
    ).toBe(false);
    expect(
      finalStateSchema.safeParse({ ...base, startedAt: "bad" }).success,
    ).toBe(false);
    expect(
      finalStateSchema.safeParse({ ...base, resumeFromRunId: "x" }).success,
    ).toBe(false);
  });
});
