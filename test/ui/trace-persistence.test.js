/**
 * trace-persistence.test.js - Trace 持久化测试
 *
 * 测试 debug trace 的文件持久化功能。
 */

import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { from } from "rxjs";

const TEST_TRACE_DIR = join(tmpdir(), `joe-trace-test-${Date.now()}`);

let renderDebugTrace;

before(async () => {
  const mod = await import("../../dist/ui/debug-renderer.js");
  renderDebugTrace = mod.renderDebugTrace;

  try {
    await mkdir(TEST_TRACE_DIR, { recursive: true });
    console.log("创建测试目录:", TEST_TRACE_DIR);
  } catch (error) {
    console.error("创建目录失败:", error);
    throw error;
  }
});

after(async () => {
  try {
    await rm(TEST_TRACE_DIR, { recursive: true, force: true });
  } catch {
    // 忽略清理错误
  }
});

test("JSONL 格式写入文件", async () => {
  const sessionId = `test-session-${Date.now()}`;

  // 创建测试事件流
  const events$ = from([
    {
      sessionId,
      turn: 1,
      scope: "session",
      phase: "test_phase",
      message: "Test message 1",
      data: { key: "value" },
      timestamp: new Date().toISOString(),
    },
    {
      sessionId,
      turn: 1,
      scope: "session",
      phase: "another_phase",
      message: "Test message 2",
      data: { count: 42 },
      timestamp: new Date().toISOString(),
    },
  ]);

  // 启动渲染并等待完成
  await renderDebugTrace(events$, {
    format: "jsonl",
    traceDir: TEST_TRACE_DIR,
  });

  // 等待异步文件写入完成
  await new Promise(resolve => setTimeout(resolve, 200));

  // 验证文件已创建
  const traceFile = join(TEST_TRACE_DIR, `${sessionId}.jsonl`);
  const content = await readFile(traceFile, "utf8");
  const lines = content.trim().split("\n");

  assert.equal(lines.length, 2, "应该有 2 行 trace");

  // 解析并验证内容（顺序可能不同，因为文件写入是异步的）
  const events = lines.map(line => JSON.parse(line));
  const phases = events.map(e => e.phase).sort();
  assert.deepEqual(phases, ["another_phase", "test_phase"], "应该包含两个 phase");

  // 验证所有事件都有正确的 sessionId
  for (const event of events) {
    assert.equal(event.sessionId, sessionId, "sessionId 应该匹配");
    assert.equal(event.turn, 1, "turn 应该是 1");
    assert.equal(event.scope, "session", "scope 应该是 session");
  }

  // 验证事件内容
  const testPhase = events.find(e => e.phase === "test_phase");
  assert.ok(testPhase, "应该有 test_phase 事件");
  assert.equal(testPhase.message, "Test message 1");
  assert.deepEqual(testPhase.data, { key: "value" });

  const anotherPhase = events.find(e => e.phase === "another_phase");
  assert.ok(anotherPhase, "应该有 another_phase 事件");
  assert.equal(anotherPhase.message, "Test message 2");
  assert.deepEqual(anotherPhase.data, { count: 42 });
});

test("非 JSONL 格式不写入文件", async () => {
  const sessionId = `test-session-pretty-${Date.now()}`;

  // 创建测试事件流
  const events$ = from([
    {
      sessionId,
      turn: 1,
      scope: "session",
      phase: "test_phase",
      message: "Test message",
      data: { key: "value" },
      timestamp: new Date().toISOString(),
    },
  ]);

  // 启动渲染（pretty 格式）
  await renderDebugTrace(events$, {
    format: "pretty",
    traceDir: TEST_TRACE_DIR,
  });

  // 验证文件未创建
  const traceFile = join(TEST_TRACE_DIR, `${sessionId}.jsonl`);

  try {
    await readFile(traceFile, "utf8");
    assert.fail("不应该创建 trace 文件");
  } catch (error) {
    assert.equal(error.code, "ENOENT", "文件应该不存在");
  }
});

test("没有 traceDir 时不写入文件", async () => {
  const sessionId = `test-session-nodir-${Date.now()}`;

  // 创建测试事件流
  const events$ = from([
    {
      sessionId,
      turn: 1,
      scope: "session",
      phase: "test_phase",
      message: "Test message",
      timestamp: new Date().toISOString(),
    },
  ]);

  // 启动渲染（没有 traceDir）
  await renderDebugTrace(events$, {
    format: "jsonl",
    // traceDir 未提供
  });

  // 验证文件未创建
  const traceFile = join(TEST_TRACE_DIR, `${sessionId}.jsonl`);

  try {
    await readFile(traceFile, "utf8");
    assert.fail("不应该创建 trace 文件");
  } catch (error) {
    assert.equal(error.code, "ENOENT", "文件应该不存在");
  }
});
