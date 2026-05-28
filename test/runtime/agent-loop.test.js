/**
 * agent-loop.test.js - Agent 循环基础测试
 *
 * 使用 mock provider 测试核心循环逻辑。
 */

import assert from "node:assert/strict";
import { test, describe, before, after } from "node:test";
import { Observable, Subject } from "rxjs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("AgentLoop", () => {
  let runAgentLoop;
  let SessionManager;
  let createPermissionGate;
  let tempDir;

  before(async () => {
    const loopMod = await import("../../dist/runtime/agent-loop.js");
    runAgentLoop = loopMod.runAgentLoop;

    const sessionMod = await import("../../dist/runtime/session-manager.js");
    SessionManager = sessionMod.SessionManager;

    const permMod = await import("../../dist/runtime/permission-gate.js");
    createPermissionGate = permMod.createPermissionGate;

    tempDir = await mkdtemp(join(tmpdir(), "joe-agent-loop-"));
  });

  after(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  /**
   * 创建 mock provider
   */
  function createMockProvider(responseText) {
    return {
      id: "mock-provider",
      runStep() {
        return new Observable((subscriber) => {
          subscriber.next({ type: "assistant_chunk", text: responseText });
          subscriber.next({ type: "assistant_message", text: responseText });
          subscriber.complete();
        });
      },
    };
  }

  /**
   * 收集 Observable 的所有事件（带超时）
   */
  function collectEvents(observable, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const events = [];
      const timer = setTimeout(() => {
        reject(new Error(`Timeout after ${timeoutMs}ms. Collected ${events.length} events.`));
      }, timeoutMs);

      observable.subscribe({
        next: (event) => events.push(event),
        error: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        complete: () => {
          clearTimeout(timer);
          resolve(events);
        },
      });
    });
  }

  describe("基本功能", () => {
    test("runAgentLoop 返回 events$ 和 debug$ Observable", () => {
      const sessionManager = new SessionManager(tempDir);
      const permissionGate = createPermissionGate({ mode: "bypass_permissions" });
      const provider = createMockProvider("Test");
      const input$ = new Subject();

      const result = runAgentLoop({
        input$: input$.asObservable(),
        provider,
        sessionManager,
        permissionGate,
        cwd: process.cwd(),
        mode: "single",
        maxStepsPerTurn: 5,
      });

      assert.ok(result, "应该返回结果");
      assert.ok(result.events$, "应该有 events$");
      assert.ok(result.debug$, "应该有 debug$");
      assert.ok(typeof result.events$.subscribe === "function", "events$ 应该可订阅");

      input$.complete();
    });

    test("处理用户输入并产生完整事件流", async () => {
      const sessionManager = new SessionManager(tempDir);
      const permissionGate = createPermissionGate({ mode: "bypass_permissions" });
      const provider = createMockProvider("Hello!");
      const input$ = new Subject();

      const { events$ } = runAgentLoop({
        input$: input$.asObservable(),
        provider,
        sessionManager,
        permissionGate,
        cwd: process.cwd(),
        mode: "single",
        maxStepsPerTurn: 5,
      });

      const eventsPromise = collectEvents(events$);

      // defer async 创建 session 需要时间，等待订阅建立后再发射值
      await new Promise((r) => setTimeout(r, 50));
      input$.next({ turn: 1, content: "Hello", source: "interactive" });
      input$.complete();

      const allEvents = await eventsPromise;
      const eventTypes = allEvents.map((e) => e.type);

      assert.ok(eventTypes.includes("session_started"), "应该有 session_started");
      assert.ok(eventTypes.includes("user_turn"), "应该有 user_turn");
      assert.ok(eventTypes.includes("assistant_message"), "应该有 assistant_message");
      assert.ok(eventTypes.includes("session_ended"), "应该有 session_ended");
    });

    test("session_started 包含必要字段", async () => {
      const sessionManager = new SessionManager(tempDir);
      const permissionGate = createPermissionGate({ mode: "bypass_permissions" });
      const provider = createMockProvider("OK");
      const input$ = new Subject();

      const { events$ } = runAgentLoop({
        input$: input$.asObservable(),
        provider,
        sessionManager,
        permissionGate,
        cwd: "/test/cwd",
        mode: "interactive",
        maxStepsPerTurn: 5,
      });

      const eventsPromise = collectEvents(events$);

      input$.next({ turn: 1, content: "Hi", source: "interactive" });
      input$.complete();

      const allEvents = await eventsPromise;
      const sessionStarted = allEvents.find((e) => e.type === "session_started");

      assert.ok(sessionStarted, "应该有 session_started 事件");
      assert.ok(sessionStarted.sessionId, "应该有 sessionId");
      assert.ok(sessionStarted.sessionPath, "应该有 sessionPath");
      assert.equal(sessionStarted.mode, "interactive");
    });

    test("debug$ 产生调试事件", async () => {
      const sessionManager = new SessionManager(tempDir);
      const permissionGate = createPermissionGate({ mode: "bypass_permissions" });
      const provider = createMockProvider("OK");
      const input$ = new Subject();

      const { events$, debug$ } = runAgentLoop({
        input$: input$.asObservable(),
        provider,
        sessionManager,
        permissionGate,
        cwd: process.cwd(),
        mode: "single",
        maxStepsPerTurn: 5,
      });

      const debugPromise = collectEvents(debug$);
      const eventsPromise = collectEvents(events$);

      input$.next({ turn: 1, content: "Test", source: "interactive" });
      input$.complete();

      const allDebugEvents = await debugPromise;
      assert.ok(allDebugEvents.length > 0, "应该产生调试事件");

      // 确保 events$ 也能完成
      await eventsPromise;
    });
  });
});
