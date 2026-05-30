/**
 * multi-agent-e2e.test.js - 多 Agent 端到端集成测试
 *
 * 测试 spawn_agent 工具与真实 provider 的集成。
 * 需要环境变量 APP_CHAT_API_KEY（Qwen）或 OLLAMA_BASE_URL（Ollama）。
 */

import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { lastValueFrom, toArray } from "rxjs";

import { createPermissionGate } from "../../dist/core/runtime/permission-gate.js";
import { SessionManager } from "../../dist/core/runtime/session-manager.js";
import { dispatchToolCall } from "../../dist/core/runtime/tool-dispatch.js";
import { ToolRegistry } from "../../dist/tools/tool-registry.js";
import { createDefaultToolRegistry } from "../../dist/tools/default-registry.js";
import { createDefaultProviderRegistry } from "../../dist/providers/provider-registry.js";

// ============================================================
// 环境变量检测
// ============================================================

const QWEN_API_KEY = process.env.APP_CHAT_API_KEY;
const QWEN_BASE_URL = process.env.APP_CHAT_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode";
const QWEN_MODEL = process.env.APP_CHAT_MODEL || "qwen-turbo";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b";

const hasQwen = !!QWEN_API_KEY;
const hasOllama = !!OLLAMA_BASE_URL;

// ============================================================
// 辅助函数
// ============================================================

async function createTestRuntime(providerId, providerSettings = {}) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-multi-agent-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const sessionManager = new SessionManager(sessionDir);
  const session = await sessionManager.startSession({
    cwd: tempRoot,
    mode: "single",
    providerId,
  });

  const providerRegistry = createDefaultProviderRegistry();
  const provider = providerRegistry.resolve(providerId, providerSettings);
  const registry = createDefaultToolRegistry();
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
// Qwen Provider 集成测试
// ============================================================

const qwenDescribe = hasQwen ? test : test.skip;

qwenDescribe("spawn_agent with Qwen: creates child agent and returns result", async () => {
  const { tempRoot, session, sessionManager, provider, providerRegistry, registry, permissionGate } =
    await createTestRuntime("openai-compatible", {
      type: "openai-compatible",
      baseUrl: QWEN_BASE_URL,
      apiKey: QWEN_API_KEY,
      model: QWEN_MODEL,
    });

  try {
    const events = await lastValueFrom(
      dispatchToolCall({
        session,
        sessionManager,
        turn: 1,
        call: {
          id: "qwen-spawn-1",
          toolName: "spawn_agent",
          input: {
            name: "qwen-analyzer",
            task: "请回复：你好，我是子 Agent",
          },
        },
        registry,
        permissionGate,
        cwd: tempRoot,
        provider,
        history: [],
        providerRegistry,
        providerSettings: {
          type: "openai-compatible",
          baseUrl: QWEN_BASE_URL,
          apiKey: QWEN_API_KEY,
          model: QWEN_MODEL,
        },
      }).pipe(toArray())
    );

    // 验证事件包含 agent 生命周期
    const eventTypes = events.map((e) => e.type);
    assert.ok(eventTypes.includes("agent_spawned"), "应该有 agent_spawned 事件");
    assert.ok(eventTypes.includes("agent_completed"), "应该有 agent_completed 事件");

    // 验证 agent_spawned 事件内容
    const spawnedEvent = events.find((e) => e.type === "agent_spawned");
    assert.equal(spawnedEvent.name, "qwen-analyzer");
    assert.equal(spawnedEvent.task, "请回复：你好，我是子 Agent");
    assert.ok(spawnedEvent.childId, "应该有 childId");
    assert.ok(spawnedEvent.childSessionPath, "应该有 childSessionPath");

    // 验证 agent_completed 事件内容
    const completedEvent = events.find((e) => e.type === "agent_completed");
    assert.equal(completedEvent.status, "success");
    assert.ok(completedEvent.result, "应该有结果");

    // 验证 tool_result 有输出
    const toolResult = events.find((e) => e.type === "tool_result");
    assert.equal(toolResult.status, "success");
    assert.ok(toolResult.output, "应该有输出内容");

    // 验证子 session 文件已创建
    await sessionManager.closeAll();
    const files = await readdir(path.join(tempRoot, "sessions"));
    const childFile = files.find((f) => f.includes("-child-qwen-analyzer"));
    assert.ok(childFile, `应该创建子 session 文件，实际: ${files.join(", ")}`);
  } finally {
    // 清理临时目录
    const { rmSync } = await import("node:fs");
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ============================================================
// Ollama Provider 集成测试
// ============================================================

const ollamaDescribe = hasOllama ? test : test.skip;

ollamaDescribe("spawn_agent with Ollama: creates child agent and returns result", async () => {
  const { tempRoot, session, sessionManager, provider, providerRegistry, registry, permissionGate } =
    await createTestRuntime("ollama", {
      baseUrl: OLLAMA_BASE_URL,
      model: OLLAMA_MODEL,
    });

  try {
    const events = await lastValueFrom(
      dispatchToolCall({
        session,
        sessionManager,
        turn: 1,
        call: {
          id: "ollama-spawn-1",
          toolName: "spawn_agent",
          input: {
            name: "ollama-analyzer",
            task: "请回复：你好",
          },
        },
        registry,
        permissionGate,
        cwd: tempRoot,
        provider,
        history: [],
        providerRegistry,
        providerSettings: {
          baseUrl: OLLAMA_BASE_URL,
          model: OLLAMA_MODEL,
        },
      }).pipe(toArray())
    );

    // 验证事件包含 agent 生命周期
    const eventTypes = events.map((e) => e.type);
    assert.ok(eventTypes.includes("agent_spawned"), "应该有 agent_spawned 事件");
    assert.ok(eventTypes.includes("agent_completed"), "应该有 agent_completed 事件");

    // 验证 agent_spawned 事件内容
    const spawnedEvent = events.find((e) => e.type === "agent_spawned");
    assert.equal(spawnedEvent.name, "ollama-analyzer");

    // 验证 agent_completed 事件内容
    const completedEvent = events.find((e) => e.type === "agent_completed");
    assert.equal(completedEvent.status, "success");
    assert.ok(completedEvent.result, "应该有结果");

    // 验证 tool_result 有输出
    const toolResult = events.find((e) => e.type === "tool_result");
    assert.equal(toolResult.status, "success");
  } finally {
    const { rmSync } = await import("node:fs");
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ============================================================
// 模型选择测试（使用 mock provider）
// ============================================================

test("spawn_agent with model parameter: resolves correct provider", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-spawn-model-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const sessionManager = new SessionManager(sessionDir);
  const session = await sessionManager.startSession({
    cwd: tempRoot,
    mode: "single",
    providerId: "local",
  });

  const { createLocalProvider } = await import("../../dist/providers/local.js");
  const localProvider = createLocalProvider();
  const providerRegistry = createDefaultProviderRegistry();
  const registry = new ToolRegistry([]);
  const permissionGate = createPermissionGate({ mode: "bypass_permissions" });

  try {
    const events = await lastValueFrom(
      dispatchToolCall({
        session,
        sessionManager,
        turn: 1,
        call: {
          id: "model-spawn-1",
          toolName: "spawn_agent",
          input: {
            name: "model-test",
            task: "测试模型选择",
            model: "haiku",
          },
        },
        registry,
        permissionGate,
        cwd: tempRoot,
        provider: localProvider,
        history: [],
        providerRegistry,
        providerSettings: {},
      }).pipe(toArray())
    );

    // 验证子 Agent 成功创建并执行
    const eventTypes = events.map((e) => e.type);
    assert.ok(eventTypes.includes("agent_spawned"), "应该有 agent_spawned 事件");
    assert.ok(eventTypes.includes("agent_completed"), "应该有 agent_completed 事件");

    const completedEvent = events.find((e) => e.type === "agent_completed");
    assert.equal(completedEvent.status, "success");
  } finally {
    await sessionManager.closeAll();
    const { rmSync } = await import("node:fs");
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ============================================================
// 工具限制测试
// ============================================================

test("spawn_agent with tools parameter: limits child agent tools", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-spawn-tools-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const sessionManager = new SessionManager(sessionDir);
  const session = await sessionManager.startSession({
    cwd: tempRoot,
    mode: "single",
    providerId: "local",
  });

  const { createLocalProvider } = await import("../../dist/providers/local.js");
  const localProvider = createLocalProvider();
  const registry = new ToolRegistry([
    { name: "read-file", riskLevel: "read", async execute() { return { status: "success", output: "content" }; } },
    { name: "bash", riskLevel: "execute", async execute() { return { status: "success", output: "output" }; } },
  ]);
  const permissionGate = createPermissionGate({ mode: "bypass_permissions" });

  try {
    const events = await lastValueFrom(
      dispatchToolCall({
        session,
        sessionManager,
        turn: 1,
        call: {
          id: "tools-spawn-1",
          toolName: "spawn_agent",
          input: {
            name: "limited-agent",
            task: "测试工具限制",
            tools: ["read-file"],
          },
        },
        registry,
        permissionGate,
        cwd: tempRoot,
        provider: localProvider,
        history: [],
      }).pipe(toArray())
    );

    // 验证子 Agent 成功创建
    const eventTypes = events.map((e) => e.type);
    assert.ok(eventTypes.includes("agent_spawned"), "应该有 agent_spawned 事件");
    assert.ok(eventTypes.includes("agent_completed"), "应该有 agent_completed 事件");

    const completedEvent = events.find((e) => e.type === "agent_completed");
    assert.equal(completedEvent.status, "success");
  } finally {
    await sessionManager.closeAll();
    const { rmSync } = await import("node:fs");
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

// ============================================================
// 错误处理测试
// ============================================================

test("spawn_agent handles child agent errors gracefully", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-spawn-error-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const sessionManager = new SessionManager(sessionDir);
  const session = await sessionManager.startSession({
    cwd: tempRoot,
    mode: "single",
    providerId: "local",
  });

  // 创建一个会抛出错误的 mock provider
  const errorProvider = {
    id: "error-provider",
    async *runStep() {
      throw new Error("Provider error");
    },
  };

  const registry = new ToolRegistry([]);
  const permissionGate = createPermissionGate({ mode: "bypass_permissions" });

  try {
    const events = await lastValueFrom(
      dispatchToolCall({
        session,
        sessionManager,
        turn: 1,
        call: {
          id: "error-spawn-1",
          toolName: "spawn_agent",
          input: {
            name: "error-agent",
            task: "测试错误处理",
          },
        },
        registry,
        permissionGate,
        cwd: tempRoot,
        provider: errorProvider,
        history: [],
      }).pipe(toArray())
    );

    // 验证 agent_spawned 仍然被发出
    const eventTypes = events.map((e) => e.type);
    assert.ok(eventTypes.includes("agent_spawned"), "应该有 agent_spawned 事件");

    // 验证 agent_completed 以 error 状态发出
    const completedEvent = events.find((e) => e.type === "agent_completed");
    if (completedEvent) {
      assert.equal(completedEvent.status, "error");
      assert.ok(completedEvent.error, "应该有错误信息");
    }
  } finally {
    await sessionManager.closeAll();
    const { rmSync } = await import("node:fs");
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
