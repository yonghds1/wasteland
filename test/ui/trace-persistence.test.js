/**
 * trace-persistence.test.js - Trace 持久化测试
 *
 * 测试 debug trace 的文件持久化功能。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { from } from "rxjs";

const TEST_TRACE_DIR = join(tmpdir(), `joe-trace-test-${Date.now()}`);

let renderDebugTrace;

beforeAll(async () => {
  const mod = await import("../../dist/ui/debug-renderer.js");
  renderDebugTrace = mod.renderDebugTrace;
  await mkdir(TEST_TRACE_DIR, { recursive: true });
});

afterAll(async () => {
  try {
    await rm(TEST_TRACE_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe("trace-persistence", () => {
  it("JSONL 格式写入文件", async () => {
    const sessionId = `test-session-${Date.now()}`;

    const events$ = from([
      { sessionId, turn: 1, scope: "session", phase: "test_phase", message: "Test message 1", data: { key: "value" }, timestamp: new Date().toISOString() },
      { sessionId, turn: 1, scope: "session", phase: "another_phase", message: "Test message 2", data: { count: 42 }, timestamp: new Date().toISOString() },
    ]);

    await renderDebugTrace(events$, { format: "jsonl", traceDir: TEST_TRACE_DIR });
    await new Promise(resolve => setTimeout(resolve, 200));

    const traceFile = join(TEST_TRACE_DIR, `${sessionId}.jsonl`);
    const content = await readFile(traceFile, "utf8");
    const lines = content.trim().split("\n");

    expect(lines.length).toBe(2);

    const events = lines.map(line => JSON.parse(line));
    const phases = events.map(e => e.phase).sort();
    expect(phases).toEqual(["another_phase", "test_phase"]);

    for (const event of events) {
      expect(event.sessionId).toBe(sessionId);
      expect(event.turn).toBe(1);
      expect(event.scope).toBe("session");
    }

    const testPhase = events.find(e => e.phase === "test_phase");
    expect(testPhase).toBeTruthy();
    expect(testPhase.message).toBe("Test message 1");
    expect(testPhase.data).toEqual({ key: "value" });

    const anotherPhase = events.find(e => e.phase === "another_phase");
    expect(anotherPhase).toBeTruthy();
    expect(anotherPhase.message).toBe("Test message 2");
    expect(anotherPhase.data).toEqual({ count: 42 });
  });

  it("非 JSONL 格式不写入文件", async () => {
    const sessionId = `test-session-pretty-${Date.now()}`;

    const events$ = from([
      { sessionId, turn: 1, scope: "session", phase: "test_phase", message: "Test message", data: { key: "value" }, timestamp: new Date().toISOString() },
    ]);

    await renderDebugTrace(events$, { format: "pretty", traceDir: TEST_TRACE_DIR });

    const traceFile = join(TEST_TRACE_DIR, `${sessionId}.jsonl`);
    await expect(readFile(traceFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("没有 traceDir 时不写入文件", async () => {
    const sessionId = `test-session-nodir-${Date.now()}`;

    const events$ = from([
      { sessionId, turn: 1, scope: "session", phase: "test_phase", message: "Test message", timestamp: new Date().toISOString() },
    ]);

    await renderDebugTrace(events$, { format: "jsonl" });

    const traceFile = join(TEST_TRACE_DIR, `${sessionId}.jsonl`);
    await expect(readFile(traceFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
