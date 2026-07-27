/**
 * multi-agent-advanced.test.js - 多 Agent 高级端到端测试
 *
 * 测试并行执行、超时、性能和更多错误场景。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { lastValueFrom, toArray, forkJoin, of, Observable } from "rxjs";
import { delay } from "rxjs/operators";

import { createPermissionGate } from "../../dist/core/runtime/permission-gate.js";
import { SessionManager } from "../../dist/core/runtime/session-manager.js";
import { dispatchToolCall } from "../../dist/core/runtime/tool-dispatch.js";
import { ToolRegistry } from "../../dist/tools/tool-registry.js";
import { createDefaultToolRegistry } from "../../dist/tools/default-registry.js";
import { createDefaultProviderRegistry } from "../../dist/providers/provider-registry.js";
import { createSessionIndex } from "../../dist/core/runtime/session-index.js";

// ============================================================
// 辅助函数
// ============================================================

async function createTestRuntime(providerId = "local", providerSettings = {}) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-multi-advanced-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const sessionManager = new SessionManager(sessionDir);
  const session = await sessionManager.startSession({
    cwd: tempRoot,
    mode: "single",
    providerId,
  });

  const providerRegistry = createDefaultProviderRegistry();
  const provider = providerRegistry.resolve(providerId, providerSettings);
  const { toolRegistry: registry } = createDefaultToolRegistry();
  const permissionGate = createPermissionGate({ mode: "bypass_permissions" });

  return {
    tempRoot,
    session,
    sessionManager,
    provider,
    providerRegistry,
    registry,
    permissionGate,
  };
}

// ============================================================
// 并行执行测试
// ============================================================

describe("多 Agent 并行执行", () => {
  it("多个 spawn_agent 并行执行", async () => {
    const {
      tempRoot,
      session,
      sessionManager,
      provider,
      providerRegistry,
      registry,
      permissionGate,
    } = await createTestRuntime();

    try {
      // 创建多个 spawn_agent 调用
      const calls = [
        {
          id: "parallel-1",
          toolName: "spawn_agent",
          input: { name: "agent-1", task: "任务 1" },
        },
        {
          id: "parallel-2",
          toolName: "spawn_agent",
          input: { name: "agent-2", task: "任务 2" },
        },
        {
          id: "parallel-3",
          toolName: "spawn_agent",
          input: { name: "agent-3", task: "任务 3" },
        },
      ];

      // 并行执行所有调用
      const observables = calls.map((call) =>
        dispatchToolCall({
          session,
          sessionManager,
          turn: 1,
          call,
          registry,
          permissionGate,
          cwd: tempRoot,
          provider,
          history: [],
          providerRegistry,
          providerSettings: {},
        }).pipe(toArray())
      );

      const results = await lastValueFrom(forkJoin(observables));

      // 验证所有调用都成功
      expect(results.length).toBe(3);

      for (const events of results) {
        const eventTypes = events.map((e) => e.type);
        expect(eventTypes).toContain("agent_spawned");
        expect(eventTypes).toContain("agent_completed");

        const completedEvent = events.find((e) => e.type === "agent_completed");
        expect(completedEvent.status).toBe("success");
      }
    } finally {
      await sessionManager.closeAll();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("并行执行的子 Agent 使用独立 session", async () => {
    const {
      tempRoot,
      session,
      sessionManager,
      provider,
      providerRegistry,
      registry,
      permissionGate,
    } = await createTestRuntime();

    try {
      // 创建两个并行调用
      const call1 = {
        id: "independent-1",
        toolName: "spawn_agent",
        input: { name: "independent-agent-1", task: "独立任务 1" },
      };

      const call2 = {
        id: "independent-2",
        toolName: "spawn_agent",
        input: { name: "independent-agent-2", task: "独立任务 2" },
      };

      // 并行执行
      const [events1, events2] = await lastValueFrom(
        forkJoin([
          dispatchToolCall({
            session,
            sessionManager,
            turn: 1,
            call: call1,
            registry,
            permissionGate,
            cwd: tempRoot,
            provider,
            history: [],
            providerRegistry,
            providerSettings: {},
          }).pipe(toArray()),
          dispatchToolCall({
            session,
            sessionManager,
            turn: 1,
            call: call2,
            registry,
            permissionGate,
            cwd: tempRoot,
            provider,
            history: [],
            providerRegistry,
            providerSettings: {},
          }).pipe(toArray()),
        ])
      );

      // 验证两个子 Agent 都创建了独立的 session
      const spawned1 = events1.find((e) => e.type === "agent_spawned");
      const spawned2 = events2.find((e) => e.type === "agent_spawned");

      expect(spawned1.childId).not.toBe(spawned2.childId);
      expect(spawned1.childSessionPath).not.toBe(spawned2.childSessionPath);
    } finally {
      await sessionManager.closeAll();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

// ============================================================
// 超时测试
// ============================================================

describe("多 Agent 超时处理", () => {
  it("子 Agent 超时后正确处理", async () => {
    const {
      tempRoot,
      session,
      sessionManager,
      provider,
      providerRegistry,
      registry,
      permissionGate,
    } = await createTestRuntime();

    try {
      // 创建一个会超时的 mock provider（使用 Observable）
      const slowProvider = {
        id: "slow-provider",
        runStep() {
          return new Observable((subscriber) => {
            // 模拟长时间运行
            setTimeout(() => {
              subscriber.next({ type: "assistant_message", text: "完成" });
              subscriber.complete();
            }, 10000);
          });
        },
      };

      const events = await lastValueFrom(
        dispatchToolCall({
          session,
          sessionManager,
          turn: 1,
          call: {
            id: "timeout-spawn",
            toolName: "spawn_agent",
            input: { name: "slow-agent", task: "慢任务" },
          },
          registry,
          permissionGate,
          cwd: tempRoot,
          provider: slowProvider,
          history: [],
          providerRegistry,
          providerSettings: {},
          childAgentTimeout: 100, // 100ms 超时
        }).pipe(toArray())
      );

      // 验证超时后正确处理
      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain("agent_spawned");

      const completedEvent = events.find((e) => e.type === "agent_completed");
      // 超时场景：agent_completed.status 为 'timeout'（event-types.ts 定义），
      // 错误信息含 timeout；不再要求强制为 'error'。
      expect(["error", "timeout"]).toContain(completedEvent.status);
      expect(completedEvent.error).toMatch(/timeout/i);
    } finally {
      await sessionManager.closeAll();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

// ============================================================
// 错误处理测试
// ============================================================

describe("多 Agent 错误处理", () => {
  it("子 Agent 执行失败时正确报告错误", async () => {
    const {
      tempRoot,
      session,
      sessionManager,
      provider,
      providerRegistry,
      registry,
      permissionGate,
    } = await createTestRuntime();

    try {
      // 创建一个会失败的 mock provider
      const failingProvider = {
        id: "failing-provider",
        async *runStep() {
          throw new Error("Provider 执行失败");
        },
      };

      const events = await lastValueFrom(
        dispatchToolCall({
          session,
          sessionManager,
          turn: 1,
          call: {
            id: "failing-spawn",
            toolName: "spawn_agent",
            input: { name: "failing-agent", task: "失败任务" },
          },
          registry,
          permissionGate,
          cwd: tempRoot,
          provider: failingProvider,
          history: [],
          providerRegistry,
          providerSettings: {},
        }).pipe(toArray())
      );

      // 验证错误处理
      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain("agent_spawned");

      const completedEvent = events.find((e) => e.type === "agent_completed");
      expect(completedEvent.status).toBe("error");
      expect(completedEvent.error).toBeTruthy();
    } finally {
      await sessionManager.closeAll();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("子 Agent 工具执行失败时正确处理", async () => {
    const {
      tempRoot,
      session,
      sessionManager,
      provider,
      providerRegistry,
      registry,
      permissionGate,
    } = await createTestRuntime();

    try {
      // 创建一个会调用不存在工具的 provider
      const invalidToolProvider = {
        id: "invalid-tool-provider",
        async *runStep() {
          yield {
            type: "tool_call",
            call: {
              id: "invalid-tool-call",
              toolName: "nonexistent-tool",
              input: {},
            },
          };
        },
      };

      const events = await lastValueFrom(
        dispatchToolCall({
          session,
          sessionManager,
          turn: 1,
          call: {
            id: "invalid-tool-spawn",
            toolName: "spawn_agent",
            input: { name: "invalid-tool-agent", task: "无效工具任务" },
          },
          registry,
          permissionGate,
          cwd: tempRoot,
          provider: invalidToolProvider,
          history: [],
          providerRegistry,
          providerSettings: {},
        }).pipe(toArray())
      );

      // 验证工具错误处理
      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain("agent_spawned");

      // 子 Agent 内部的工具失败会被捕获，spawn_agent 会返回错误结果
      const completedEvent = events.find((e) => e.type === "agent_completed");
      expect(completedEvent.status).toBe("error");
      expect(completedEvent.error).toBeTruthy();
    } finally {
      await sessionManager.closeAll();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("子 Agent 权限拒绝时正确处理", async () => {
    const {
      tempRoot,
      session,
      sessionManager,
      provider,
      providerRegistry,
      registry,
    } = await createTestRuntime();

    try {
      // 使用 default 权限模式（需要确认）
      const permissionGate = createPermissionGate({ mode: "default" });

      const events = await lastValueFrom(
        dispatchToolCall({
          session,
          sessionManager,
          turn: 1,
          call: {
            id: "permission-spawn",
            toolName: "spawn_agent",
            input: { name: "permission-agent", task: "权限测试任务" },
          },
          registry,
          permissionGate,
          cwd: tempRoot,
          provider,
          history: [],
          providerRegistry,
          providerSettings: {},
        }).pipe(toArray())
      );

      // 验证权限拒绝处理
      const eventTypes = events.map((e) => e.type);
      expect(eventTypes).toContain("permission_decision");

      const permissionEvent = events.find((e) => e.type === "permission_decision");
      expect(permissionEvent.decision).toBe("deny"); // default 模式无交互桥接时降级拒绝
    } finally {
      await sessionManager.closeAll();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

// ============================================================
// 性能测试
// ============================================================

describe("多 Agent 性能", () => {
  it("大量子 Agent 并行执行性能", async () => {
    const {
      tempRoot,
      session,
      sessionManager,
      provider,
      providerRegistry,
      registry,
      permissionGate,
    } = await createTestRuntime();

    try {
      const agentCount = 10;
      const calls = Array.from({ length: agentCount }, (_, i) => ({
        id: `perf-spawn-${i}`,
        toolName: "spawn_agent",
        input: { name: `perf-agent-${i}`, task: `性能测试任务 ${i}` },
      }));

      const startTime = Date.now();

      // 并行执行所有调用
      const observables = calls.map((call) =>
        dispatchToolCall({
          session,
          sessionManager,
          turn: 1,
          call,
          registry,
          permissionGate,
          cwd: tempRoot,
          provider,
          history: [],
          providerRegistry,
          providerSettings: {},
        }).pipe(toArray())
      );

      const results = await lastValueFrom(forkJoin(observables));
      const duration = Date.now() - startTime;

      // 验证所有调用都成功
      expect(results.length).toBe(agentCount);

      for (const events of results) {
        const completedEvent = events.find((e) => e.type === "agent_completed");
        expect(completedEvent.status).toBe("success");
      }

      // 性能断言：10 个并行子 Agent 应该在 5 秒内完成
      expect(duration).toBeLessThan(5000);
      console.log(`并行执行 ${agentCount} 个子 Agent 耗时: ${duration}ms`);
    } finally {
      await sessionManager.closeAll();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("顺序执行 vs 并行执行性能对比", async () => {
    const {
      tempRoot,
      session,
      sessionManager,
      provider,
      providerRegistry,
      registry,
      permissionGate,
    } = await createTestRuntime();

    try {
      const agentCount = 3;
      const calls = Array.from({ length: agentCount }, (_, i) => ({
        id: `compare-spawn-${i}`,
        toolName: "spawn_agent",
        input: { name: `compare-agent-${i}`, task: `对比测试任务 ${i}` },
      }));

      // 顺序执行
      const sequentialStart = Date.now();
      for (const call of calls) {
        await lastValueFrom(
          dispatchToolCall({
            session,
            sessionManager,
            turn: 1,
            call,
            registry,
            permissionGate,
            cwd: tempRoot,
            provider,
            history: [],
            providerRegistry,
            providerSettings: {},
          }).pipe(toArray())
        );
      }
      const sequentialDuration = Date.now() - sequentialStart;

      // 并行执行
      const parallelStart = Date.now();
      const observables = calls.map((call) =>
        dispatchToolCall({
          session,
          sessionManager,
          turn: 1,
          call,
          registry,
          permissionGate,
          cwd: tempRoot,
          provider,
          history: [],
          providerRegistry,
          providerSettings: {},
        }).pipe(toArray())
      );
      await lastValueFrom(forkJoin(observables));
      const parallelDuration = Date.now() - parallelStart;

      // 验证两种方式都成功完成
      // 注意：local provider 是同步的，所以并行执行可能不会更快
      // 这个测试主要是验证两种方式都能正常工作
      expect(sequentialDuration).toBeGreaterThan(0);
      expect(parallelDuration).toBeGreaterThan(0);
      console.log(`顺序执行: ${sequentialDuration}ms, 并行执行: ${parallelDuration}ms`);
    } finally {
      await sessionManager.closeAll();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

// ============================================================
// Session 隔离测试
// ============================================================

describe("多 Agent Session 隔离", () => {
  it("子 Agent 的 session 不影响父 Agent", async () => {
    const {
      tempRoot,
      session,
      sessionManager,
      provider,
      providerRegistry,
      registry,
      permissionGate,
    } = await createTestRuntime();

    try {
      // 执行子 Agent
      const events = await lastValueFrom(
        dispatchToolCall({
          session,
          sessionManager,
          turn: 1,
          call: {
            id: "isolation-spawn",
            toolName: "spawn_agent",
            input: { name: "isolation-agent", task: "隔离测试任务" },
          },
          registry,
          permissionGate,
          cwd: tempRoot,
          provider,
          history: [],
          providerRegistry,
          providerSettings: {},
        }).pipe(toArray())
      );

      // 验证子 Agent 创建了独立的 session
      const spawnedEvent = events.find((e) => e.type === "agent_spawned");
      expect(spawnedEvent.childId).not.toBe(session.id);
      expect(spawnedEvent.childSessionPath).not.toBe(session.path);

      // 关闭 session manager 以刷新缓冲区
      await sessionManager.closeAll();

      // 验证父 Agent 的 session 文件存在
      const { stat } = await import("node:fs/promises");
      const parentSessionPath = session.path;
      const parentSessionStat = await stat(parentSessionPath);
      expect(parentSessionStat).toBeTruthy();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("多个子 Agent 的 session 相互隔离", async () => {
    const {
      tempRoot,
      session,
      sessionManager,
      provider,
      providerRegistry,
      registry,
      permissionGate,
    } = await createTestRuntime();

    try {
      // 创建两个子 Agent
      const [events1, events2] = await lastValueFrom(
        forkJoin([
          dispatchToolCall({
            session,
            sessionManager,
            turn: 1,
            call: {
              id: "isolation-spawn-1",
              toolName: "spawn_agent",
              input: { name: "isolation-agent-1", task: "隔离任务 1" },
            },
            registry,
            permissionGate,
            cwd: tempRoot,
            provider,
            history: [],
            providerRegistry,
            providerSettings: {},
          }).pipe(toArray()),
          dispatchToolCall({
            session,
            sessionManager,
            turn: 1,
            call: {
              id: "isolation-spawn-2",
              toolName: "spawn_agent",
              input: { name: "isolation-agent-2", task: "隔离任务 2" },
            },
            registry,
            permissionGate,
            cwd: tempRoot,
            provider,
            history: [],
            providerRegistry,
            providerSettings: {},
          }).pipe(toArray()),
        ])
      );

      // 验证两个子 Agent 的 session 相互隔离
      const spawned1 = events1.find((e) => e.type === "agent_spawned");
      const spawned2 = events2.find((e) => e.type === "agent_spawned");

      expect(spawned1.childId).not.toBe(spawned2.childId);
      expect(spawned1.childSessionPath).not.toBe(spawned2.childSessionPath);
      expect(spawned1.childId).not.toBe(session.id);
      expect(spawned2.childId).not.toBe(session.id);
    } finally {
      await sessionManager.closeAll();
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
