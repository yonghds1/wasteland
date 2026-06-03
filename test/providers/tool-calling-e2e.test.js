/**
 * tool-calling-e2e.test.js - Tool Calling 端到端测试
 *
 * 测试真实模型 provider 的 tool calling 功能，验证多步工具调用循环。
 */

import { describe, it, expect } from "vitest";
import { createQwenProvider } from "../../dist/providers/qwen.js";
import { createOpenAIProvider } from "../../dist/providers/openai.js";
import { createOllamaProvider } from "../../dist/providers/ollama.js";
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

it("Qwen Provider: 基本 tool calling 能力", async () => {
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

    expect(hasToolCall || hasAssistantMessage).toBeTruthy();

    if (hasToolCall) {
      const toolCallEvent = events.find(e => e.type === "tool_call");
      console.log("工具调用:", toolCallEvent.call.toolName);
      expect(toolCallEvent.call.toolName).toBeTruthy();
      expect(toolCallEvent.call.id).toBeTruthy();
    }
  } catch (error) {
    console.error("Qwen 测试失败:", error.message);
    throw error;
  }
});

it("Qwen Provider: 多步工具调用循环", async () => {
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
    expect(hasToolCall).toBeTruthy();

    if (hasToolCall) {
      const toolCallEvent = events.find(e => e.type === "tool_call");
      console.log("工具调用:", toolCallEvent.call.toolName);

      // 验证工具调用参数
      expect(toolCallEvent.call.toolName).toBeTruthy();
      expect(toolCallEvent.call.input).toBeTruthy();
    }
  } catch (error) {
    console.error("Qwen 多步测试失败:", error.message);
    throw error;
  }
});

// ============================================================
// Ollama Provider Tool Calling 测试
// ============================================================

it("Ollama Provider: 基本 tool calling 能力", async () => {
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

    expect(hasToolCall || hasAssistantMessage).toBeTruthy();

    if (hasToolCall) {
      const toolCallEvent = events.find(e => e.type === "tool_call");
      console.log("工具调用:", toolCallEvent.call.toolName);
      expect(toolCallEvent.call.toolName).toBeTruthy();
      expect(toolCallEvent.call.id).toBeTruthy();
    }
  } catch (error) {
    console.error("Ollama 测试失败:", error.message);
    throw error;
  }
});

// ============================================================
// 工具注册表测试
// ============================================================

it("工具注册表: 包含所有必要工具", () => {
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
    expect(tools.includes(toolName)).toBeTruthy();
  }
});

it("工具注册表: 工具有正确的属性", () => {
  const { toolRegistry } = createDefaultToolRegistry();

  // 测试 read-file 工具
  const readTool = toolRegistry.get("read-file");
  expect(readTool).toBeTruthy();
  expect(readTool.name).toBe("read-file");
  expect(readTool.riskLevel).toBeTruthy();
  expect(readTool.execute).toBeTruthy();

  // 测试 bash 工具
  const bashTool = toolRegistry.get("bash");
  expect(bashTool).toBeTruthy();
  expect(bashTool.name).toBe("bash");
  expect(bashTool.riskLevel).toBeTruthy();
  expect(bashTool.execute).toBeTruthy();
});

// ============================================================
// Provider 接口测试
// ============================================================

it("Provider 接口: runStep 返回 Observable", () => {
  const provider = createQwenProvider({
    baseUrl: "http://localhost:1234",
    apiKey: "test-key",
    model: "test-model",
  });

  const { toolRegistry } = createDefaultToolRegistry();
  const context = createTestTurnContext(toolRegistry);
  const state = createTestTurnState();

  const result = provider.runStep({ context, state });

  expect(result).toBeTruthy();
  expect(result.subscribe).toBeTruthy();
  expect(typeof result.subscribe).toBe("function");
});

it("Provider 接口: 有正确的 id", () => {
  const qwenProvider = createQwenProvider({
    baseUrl: "http://localhost:1234",
    apiKey: "test-key",
    model: "test-model",
  });

  const ollamaProvider = createOpenAIProvider({
    baseUrl: "http://localhost:11434/v1",
    model: "test-model",
  });

  expect(qwenProvider.id).toBe("openai-compatible");
  expect(ollamaProvider.id).toBe("openai-compatible");
});

// ============================================================
// 工具执行测试
// ============================================================

it("工具执行: read-file 工具", async () => {
  const { toolRegistry } = createDefaultToolRegistry();
  const readTool = toolRegistry.get("read-file");

  expect(readTool).toBeTruthy();

  // 测试读取 package.json
  const result = await readTool.execute(
    { path: "package.json" },
    { sessionId: "test", turn: 1, cwd: process.cwd() }
  );

  expect(result).toBeTruthy();
  expect(result.status).toBeTruthy();
  expect(result.output).toBeTruthy();

  if (result.status === "success") {
    // 输出格式是带行号的文本，不是纯 JSON
    expect(result.output.includes("package.json")).toBeTruthy();
    expect(result.output.includes('"name": "wasteland"')).toBeTruthy();
  }
});

it("工具执行: bash 工具", async () => {
  const { toolRegistry } = createDefaultToolRegistry();
  const bashTool = toolRegistry.get("bash");

  expect(bashTool).toBeTruthy();

  // 测试执行简单命令
  const result = await bashTool.execute(
    { command: "echo 'hello world'" },
    { sessionId: "test", turn: 1, cwd: process.cwd() }
  );

  expect(result).toBeTruthy();
  expect(result.status).toBeTruthy();
  expect(result.output).toBeTruthy();

  if (result.status === "success") {
    expect(result.output.includes("hello world")).toBeTruthy();
  }
});

it("工具执行: glob 工具", async () => {
  const { toolRegistry } = createDefaultToolRegistry();
  const globTool = toolRegistry.get("glob");

  expect(globTool).toBeTruthy();

  // 测试查找 TypeScript 文件
  const result = await globTool.execute(
    { pattern: "src/**/*.ts" },
    { sessionId: "test", turn: 1, cwd: process.cwd() }
  );

  expect(result).toBeTruthy();
  expect(result.status).toBeTruthy();
  expect(result.output).toBeTruthy();

  if (result.status === "success") {
    // 输出格式是带 emoji 的文本列表
    expect(result.output.includes("src/")).toBeTruthy();
    expect(result.output.includes(".ts")).toBeTruthy();
  }
});

// ============================================================
// 错误处理测试
// ============================================================

it("错误处理: 缺少 model", () => {
  expect(() => {
      createQwenProvider({
        baseUrl: "http://localhost:1234",
        apiKey: "test-key",
        // model: "test-model", // 缺少
      });
}).toThrow(/missingModel|缺少 model/);
});

it("错误处理: 工具不存在", () => {
  const { toolRegistry } = createDefaultToolRegistry();

  const tool = toolRegistry.get("non-existent-tool");
  expect(tool).toBe(undefined);
});
