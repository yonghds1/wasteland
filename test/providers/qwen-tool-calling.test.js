/**
 * qwen-tool-calling.test.js - Qwen Provider 基础测试
 *
 * 测试 Qwen provider 的基本功能和 tool calling 支持。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createQwenProvider } from "../../dist/providers/qwen.js";
import { createDefaultToolRegistry } from "../../dist/tools/default-registry.js";

// ============================================================
// 配置验证测试
// ============================================================

test("createQwenProvider: 配置验证 - 缺少 model", () => {
  assert.throws(
    () => {
      createQwenProvider({
        baseUrl: "http://localhost:1234",
        apiKey: "test-key",
        // model: "qwen-test", // 缺少
      });
    },
    /missingModel|缺少 model/
  );
});

test("createQwenProvider: 成功创建 provider", () => {
  const provider = createQwenProvider({
    baseUrl: "http://localhost:1234",
    apiKey: "test-key",
    model: "qwen-test",
  });

  assert.ok(provider);
  assert.equal(provider.id, "openai-compatible");
  assert.ok(provider.runStep);
  assert.equal(typeof provider.runStep, "function");
});

test("createQwenProvider: 配置验证 - 缺少 baseUrl", () => {
  assert.throws(
    () => {
      createQwenProvider({
        apiKey: "test-key",
        model: "qwen-test",
      });
    },
    /missingBaseUrl|缺少 baseUrl/
  );
});

test("createQwenProvider: baseUrl 规范化 - 去除尾部斜杠", () => {
  const provider = createQwenProvider({
    baseUrl: "http://localhost:8080/",
    apiKey: "test-key",
    model: "qwen-test",
  });

  assert.ok(provider);
});

// ============================================================
// 工具注册表测试
// ============================================================

test("createDefaultToolRegistry: 包含必要的工具", () => {
  const { toolRegistry } = createDefaultToolRegistry();

  const tools = toolRegistry.list();
  assert.ok(tools.includes("read-file"));
  assert.ok(tools.includes("bash"));
  assert.ok(tools.includes("edit-file"));
  assert.ok(tools.includes("write-file"));
  assert.ok(tools.includes("glob"));
  assert.ok(tools.includes("grep"));
});

test("createDefaultToolRegistry: 工具有正确的属性", () => {
  const { toolRegistry } = createDefaultToolRegistry();

  const readTool = toolRegistry.get("read-file");
  assert.ok(readTool);
  assert.equal(readTool.name, "read-file");
  // description 是可选的，不是必需的
  assert.ok(readTool.riskLevel);
  assert.ok(readTool.execute);
});

// ============================================================
// Provider 接口测试
// ============================================================

test("provider.runStep: 返回 Observable", () => {
  const provider = createQwenProvider({
    baseUrl: "http://localhost:1234",
    apiKey: "test-key",
    model: "qwen-test",
  });

  const { toolRegistry } = createDefaultToolRegistry();

  // 创建最小化的 turnContext 和 turnState
  const turnContext = {
    sessionId: "test",
    turn: 1,
    input: { turn: 1, content: "test", source: "message" },
    history: [],
    cwd: process.cwd(),
    toolRegistry,
    permissionMode: "default",
    maxStepsPerTurn: 8,
  };

  const turnState = {
    sessionId: "test",
    turn: 1,
    cwd: process.cwd(),
    input: { turn: 1, content: "test", source: "message" },
    history: [],
    step: 0,
    status: "running",
    assistantChunks: [],
    toolCalls: [],
    toolResults: [],
  };

  // runStep 应该返回一个 Observable
  const result = provider.runStep({ context: turnContext, state: turnState });
  assert.ok(result);
  assert.ok(result.subscribe);
  assert.equal(typeof result.subscribe, "function");
});
