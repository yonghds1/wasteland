/**
 * agent-loop.test.js - Agent 循环基础测试
 *
 * 使用 mock provider 测试核心循环逻辑。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Observable, Subject } from "rxjs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let runAgentLoop;
let SessionManager;
let createPermissionGate;
let tempDir;

beforeAll(async () => {
  const loopMod = await import("../../dist/core/runtime/agent-loop.js");
  runAgentLoop = loopMod.runAgentLoop;

  const sessionMod = await import("../../dist/core/runtime/session-manager.js");
  SessionManager = sessionMod.SessionManager;

  const permMod = await import("../../dist/core/runtime/permission-gate.js");
  createPermissionGate = permMod.createPermissionGate;

  tempDir = await mkdtemp(join(tmpdir(), "joe-agent-loop-"));
});

afterAll(async () => {
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

describe("AgentLoop", () => {
  describe("基本功能", () => {
    it("runAgentLoop 返回 events$ 和 debug$ Observable", () => {
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

      expect(result).toBeTruthy();
      expect(result.events$).toBeTruthy();
      expect(result.debug$).toBeTruthy();
      expect(typeof result.events$.subscribe).toBe("function");

      input$.complete();
    });

    it("处理用户输入并产生完整事件流", async () => {
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

      await new Promise((r) => setTimeout(r, 50));
      input$.next({ turn: 1, content: "Hello", source: "interactive" });
      input$.complete();

      const allEvents = await eventsPromise;
      const eventTypes = allEvents.map((e) => e.type);

      expect(eventTypes).toContain("session_started");
      expect(eventTypes).toContain("user_turn");
      expect(eventTypes).toContain("assistant_message");
      expect(eventTypes).toContain("session_ended");
    });

    it("session_started 包含必要字段", async () => {
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

      expect(sessionStarted).toBeTruthy();
      expect(sessionStarted.sessionId).toBeTruthy();
      expect(sessionStarted.sessionPath).toBeTruthy();
      expect(sessionStarted.mode).toBe("interactive");
    });

    it("debug$ 产生调试事件", async () => {
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
      expect(allDebugEvents.length).toBeGreaterThan(0);

      await eventsPromise;
    });
  });
});
