/**
 * tool-calling-e2e.test.js - Tool Calling 端到端测试
 *
 * 测试真实模型 provider 的 tool calling 功能，验证多步工具调用循环。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createQwenProvider } from "../../dist/providers/qwen.js";
import { createOpenAIProvider } from "../../dist/providers/openai.js";
import { createDefaultToolRegistry } from "../../dist/tools/default-registry.js";
import { ToolRegistry } from "../../dist/tools/tool-registry.js";
import { firstValueFrom, toArray } from "rxjs";

// ============================================================
// 辅助函数
// ============================================================

/**
 * 创建测试用的 turnContext
 */
function createTestTurnContext(toolRegistry, input = "test") {
  return {
    sessionId: "test-session",
    turn: 1,
    input: { turn: 1, content: input, source: "message" },
    history: [],
    cwd: process.cwd(),
    toolRegistry,
    permissionMode: "bypass_permissions",
    maxStepsPerTurn: 8,
  };
}

/**
 * 创建测试用的 turnState
 */
function createTestTurnState(input = "test") {
  return {
    sessionId: "test-session",
    turn: 1,
    cwd: process.cwd(),
    input: { turn: 1, content: input, source: "message" },
    history: [],
    step: 0,
    status: "running",
    assistantChunks: [],
    toolCalls: [],
    toolResults: [],
  };
}

/**
 * 收集 Observable 的所有事件
 */
async function collectEvents(observable) {
  return firstValueFrom(observable.pipe(toArray()));
}

// ============================================================
// Qwen Provider Tool Calling 测试
// ============================================================

test("Qwen Provider: 基本 tool calling 能力", async () => {
  // 跳过如果没有配置 API Key
  if (!process.env.APP_CHAT_API_KEY) {
    console.log("跳过 Qwen 测试：缺少 APP_CHAT_API_KEY");
    return;
  }

  const provider = createQwenProvider({
    baseUrl: process.env.APP_CHAT_BASE_URL,
    apiKey: process.env.APP_CHAT_API_KEY,
    model: process.env.APP_CHAT_MODEL || "qwen3-max",
  });

  const { toolRegistry } = createDefaultToolRegistry();
  const context = createTestTurnContext(toolRegistry, "读取 package.json 文件");
  const state = createTestTurnState("读取 package.json 文件");

  try {
    const events = await collectEvents(provider.runStep({ context, state }));

    // 验证事件类型
    const eventTypes = events.map(e => e.type);
    console.log("Qwen 事件类型:", eventTypes);

    // 应该有 tool_call 或 assistant_message
    const hasToolCall = eventTypes.includes("tool_call");
    const hasAssistantMessage = eventTypes.includes("assistant_message");

    assert.ok(hasToolCall || hasAssistantMessage, "应该有 tool_call 或 assistant_message");

    if (hasToolCall) {
      const toolCallEvent = events.find(e => e.type === "tool_call");
      console.log("工具调用:", toolCallEvent.call.toolName);
      assert.ok(toolCallEvent.call.toolName, "工具调用应该有工具名称");
      assert.ok(toolCallEvent.call.id, "工具调用应该有调用 ID");
    }
  } catch (error) {
    console.error("Qwen 测试失败:", error.message);
    throw error;
  }
});

test("Qwen Provider: 多步工具调用循环", async () => {
  // 跳过如果没有配置 API Key
  if (!process.env.APP_CHAT_API_KEY) {
    console.log("跳过 Qwen 测试：缺少 APP_CHAT_API_KEY");
    return;
  }

  const provider = createQwenProvider({
    baseUrl: process.env.APP_CHAT_BASE_URL,
    apiKey: process.env.APP_CHAT_API_KEY,
    model: process.env.APP_CHAT_MODEL || "qwen3-max",
  });

  const { toolRegistry } = createDefaultToolRegistry();
  const context = createTestTurnContext(toolRegistry, "列出当前目录的文件");
  const state = createTestTurnState("列出当前目录的文件");

  try {
    const events = await collectEvents(provider.runStep({ context, state }));

    // 验证事件类型
    const eventTypes = events.map(e => e.type);
    console.log("Qwen 多步事件类型:", eventTypes);

    // 应该有 tool_call
    const hasToolCall = eventTypes.includes("tool_call");
    assert.ok(hasToolCall, "应该有 tool_call 事件");

    if (hasToolCall) {
      const toolCallEvent = events.find(e => e.type === "tool_call");
      console.log("工具调用:", toolCallEvent.call.toolName);

      // 验证工具调用参数
      assert.ok(toolCallEvent.call.toolName, "工具调用应该有工具名称");
      assert.ok(toolCallEvent.call.input, "工具调用应该有输入参数");
    }
  } catch (error) {
    console.error("Qwen 多步测试失败:", error.message);
    throw error;
  }
});

// ============================================================
// Ollama Provider Tool Calling 测试
// ============================================================

test("Ollama Provider: 基本 tool calling 能力", async () => {
  // 跳过如果没有配置 Ollama
  if (!process.env.OLLAMA_BASE_URL) {
    console.log("跳过 Ollama 测试：缺少 OLLAMA_BASE_URL");
    return;
  }

  const provider = createOllamaProvider({
    baseUrl: process.env.OLLAMA_BASE_URL,
    model: process.env.OLLAMA_MODEL || "qwen2.5:7b",
  });

  const { toolRegistry } = createDefaultToolRegistry();
  const context = createTestTurnContext(toolRegistry, "读取 package.json 文件");
  const state = createTestTurnState("读取 package.json 文件");

  try {
    const events = await collectEvents(provider.runStep({ context, state }));

    // 验证事件类型
    const eventTypes = events.map(e => e.type);
    console.log("Ollama 事件类型:", eventTypes);

    // 应该有 tool_call 或 assistant_message
    const hasToolCall = eventTypes.includes("tool_call");
    const hasAssistantMessage = eventTypes.includes("assistant_message");

    assert.ok(hasToolCall || hasAssistantMessage, "应该有 tool_call 或 assistant_message");

    if (hasToolCall) {
      const toolCallEvent = events.find(e => e.type === "tool_call");
      console.log("工具调用:", toolCallEvent.call.toolName);
      assert.ok(toolCallEvent.call.toolName, "工具调用应该有工具名称");
      assert.ok(toolCallEvent.call.id, "工具调用应该有调用 ID");
    }
  } catch (error) {
    console.error("Ollama 测试失败:", error.message);
    throw error;
  }
});

// ============================================================
// 工具注册表测试
// ============================================================

test("工具注册表: 包含所有必要工具", () => {
  const { toolRegistry } = createDefaultToolRegistry();
  const tools = toolRegistry.list();

  console.log("已注册工具:", tools);

  // 验证必要工具存在
  const requiredTools = [
    "read-file",
    "bash",
    "edit-file",
    "write-file",
    "glob",
    "grep",
    "list-directory",
    "web-fetch",
  ];

  for (const toolName of requiredTools) {
    assert.ok(tools.includes(toolName), `应该包含工具: ${toolName}`);
  }
});

test("工具注册表: 工具有正确的属性", () => {
  const { toolRegistry } = createDefaultToolRegistry();

  // 测试 read-file 工具
  const readTool = toolRegistry.get("read-file");
  assert.ok(readTool, "read-file 工具应该存在");
  assert.equal(readTool.name, "read-file");
  assert.ok(readTool.riskLevel, "read-file 工具应该有风险级别");
  assert.ok(readTool.execute, "read-file 工具应该有执行函数");

  // 测试 bash 工具
  const bashTool = toolRegistry.get("bash");
  assert.ok(bashTool, "bash 工具应该存在");
  assert.equal(bashTool.name, "bash");
  assert.ok(bashTool.riskLevel, "bash 工具应该有风险级别");
  assert.ok(bashTool.execute, "bash 工具应该有执行函数");
});

// ============================================================
// Provider 接口测试
// ============================================================

test("Provider 接口: runStep 返回 Observable", () => {
  const provider = createQwenProvider({
    baseUrl: "http://localhost:1234",
    apiKey: "test-key",
    model: "test-model",
  });

  const { toolRegistry } = createDefaultToolRegistry();
  const context = createTestTurnContext(toolRegistry);
  const state = createTestTurnState();

  const result = provider.runStep({ context, state });

  assert.ok(result, "runStep 应该返回值");
  assert.ok(result.subscribe, "runStep 应该返回 Observable");
  assert.equal(typeof result.subscribe, "function");
});

test("Provider 接口: 有正确的 id", () => {
  const qwenProvider = createQwenProvider({
    baseUrl: "http://localhost:1234",
    apiKey: "test-key",
    model: "test-model",
  });

  const ollamaProvider = createOpenAIProvider({
    baseUrl: "http://localhost:11434/v1",
    model: "test-model",
  });

  assert.equal(qwenProvider.id, "openai-compatible");
  assert.equal(ollamaProvider.id, "openai-compatible");
});

// ============================================================
// 工具执行测试
// ============================================================

test("工具执行: read-file 工具", async () => {
  const { toolRegistry } = createDefaultToolRegistry();
  const readTool = toolRegistry.get("read-file");

  assert.ok(readTool, "read-file 工具应该存在");

  // 测试读取 package.json
  const result = await readTool.execute(
    { path: "package.json" },
    { sessionId: "test", turn: 1, cwd: process.cwd() }
  );

  assert.ok(result, "应该有执行结果");
  assert.ok(result.status, "应该有状态");
  assert.ok(result.output, "应该有输出");

  if (result.status === "success") {
    // 输出格式是带行号的文本，不是纯 JSON
    assert.ok(result.output.includes("package.json"), "输出应该包含文件名");
    assert.ok(result.output.includes('"name": "rxc"'), "输出应该包含 package.json 内容");
  }
});

test("工具执行: bash 工具", async () => {
  const { toolRegistry } = createDefaultToolRegistry();
  const bashTool = toolRegistry.get("bash");

  assert.ok(bashTool, "bash 工具应该存在");

  // 测试执行简单命令
  const result = await bashTool.execute(
    { command: "echo 'hello world'" },
    { sessionId: "test", turn: 1, cwd: process.cwd() }
  );

  assert.ok(result, "应该有执行结果");
  assert.ok(result.status, "应该有状态");
  assert.ok(result.output, "应该有输出");

  if (result.status === "success") {
    assert.ok(result.output.includes("hello world"), "输出应该包含 'hello world'");
  }
});

test("工具执行: glob 工具", async () => {
  const { toolRegistry } = createDefaultToolRegistry();
  const globTool = toolRegistry.get("glob");

  assert.ok(globTool, "glob 工具应该存在");

  // 测试查找 TypeScript 文件
  const result = await globTool.execute(
    { pattern: "src/**/*.ts" },
    { sessionId: "test", turn: 1, cwd: process.cwd() }
  );

  assert.ok(result, "应该有执行结果");
  assert.ok(result.status, "应该有状态");
  assert.ok(result.output, "应该有输出");

  if (result.status === "success") {
    // 输出格式是带 emoji 的文本列表
    assert.ok(result.output.includes("src/"), "输出应该包含 src/ 目录");
    assert.ok(result.output.includes(".ts"), "输出应该包含 .ts 文件");
  }
});

// ============================================================
// 错误处理测试
// ============================================================

test("错误处理: 缺少 model", () => {
  assert.throws(
    () => {
      createQwenProvider({
        baseUrl: "http://localhost:1234",
        apiKey: "test-key",
        // model: "test-model", // 缺少
      });
    },
    /缺少 model/
  );
});

test("错误处理: 工具不存在", () => {
  const { toolRegistry } = createDefaultToolRegistry();

  const tool = toolRegistry.get("non-existent-tool");
  assert.equal(tool, undefined, "不存在的工具应该返回 undefined");
});
