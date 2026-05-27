/**
 * tool-adapter.test.js - 工具适配器单元测试
 *
 * 测试 buildOpenAITools 和 parseToolCalls 的正确性。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOpenAITools, parseToolCalls, hasParseError, getParseErrorMessage } from "../../../dist/providers/openai-compatible/tool-adapter.js";
import { ToolRegistry } from "../../../dist/tools/tool-registry.js";

// ============================================================
// buildOpenAITools 测试
// ============================================================

test("buildOpenAITools: 空注册表返回空数组", () => {
  const registry = new ToolRegistry();
  const tools = buildOpenAITools(registry);

  assert.deepEqual(tools, []);
});

test("buildOpenAITools: 单个工具转换", () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "read-file",
    description: "读取文件",
    riskLevel: "read",
    execute: async () => ({ status: "success", output: "" }),
  });

  const tools = buildOpenAITools(registry);

  assert.equal(tools.length, 1);
  assert.equal(tools[0].type, "function");
  assert.equal(tools[0].function.name, "read-file");
  assert.ok(tools[0].function.description);
  assert.ok(tools[0].function.parameters);
  assert.equal(tools[0].function.parameters.type, "object");
  assert.ok(tools[0].function.parameters.properties.path);
  assert.deepEqual(tools[0].function.parameters.required, ["path"]);
});

test("buildOpenAITools: 多个工具转换", () => {
  const registry = new ToolRegistry();

  registry.register({
    name: "read-file",
    description: "读取文件",
    riskLevel: "read",
    execute: async () => ({ status: "success", output: "" }),
  });

  registry.register({
    name: "bash",
    description: "执行命令",
    riskLevel: "write",
    execute: async () => ({ status: "success", output: "" }),
  });

  const tools = buildOpenAITools(registry);

  assert.equal(tools.length, 2);

  const toolNames = tools.map(t => t.function.name);
  assert.ok(toolNames.includes("read-file"));
  assert.ok(toolNames.includes("bash"));
});

test("buildOpenAITools: edit-file 参数 Schema 正确", () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "edit-file",
    description: "编辑文件",
    riskLevel: "write",
    execute: async () => ({ status: "success", output: "" }),
  });

  const tools = buildOpenAITools(registry);
  const params = tools[0].function.parameters;

  assert.ok(params.properties.path);
  assert.ok(params.properties.old_string);
  assert.ok(params.properties.new_string);
  assert.ok(params.properties.replace_all);
  assert.deepEqual(params.required, ["path", "old_string", "new_string"]);
});

test("buildOpenAITools: spawn_agent 参数 Schema 正确", () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "spawn_agent",
    description: "创建子 Agent",
    riskLevel: "write",
    execute: async () => ({ status: "success", output: "" }),
  });

  const tools = buildOpenAITools(registry);
  const params = tools[0].function.parameters;

  assert.ok(params.properties.name);
  assert.ok(params.properties.task);
  assert.ok(params.properties.model);
  assert.ok(params.properties.tools);
  assert.ok(params.properties.inheritHistory);
  assert.deepEqual(params.required, ["name", "task"]);
});

// ============================================================
// parseToolCalls 测试
// ============================================================

test("parseToolCalls: 空数组返回空数组", () => {
  const calls = parseToolCalls([]);
  assert.deepEqual(calls, []);
});

test("parseToolCalls: 单个工具调用解析", () => {
  const toolCalls = [
    {
      id: "call_abc123",
      type: "function",
      function: {
        name: "read-file",
        arguments: '{"path": "package.json"}',
      },
    },
  ];

  const calls = parseToolCalls(toolCalls);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, "call_abc123");
  assert.equal(calls[0].toolName, "read-file");
  assert.deepEqual(calls[0].input, { path: "package.json" });
});

test("parseToolCalls: 多个工具调用解析", () => {
  const toolCalls = [
    {
      id: "call_1",
      type: "function",
      function: {
        name: "read-file",
        arguments: '{"path": "a.txt"}',
      },
    },
    {
      id: "call_2",
      type: "function",
      function: {
        name: "bash",
        arguments: '{"command": "pwd"}',
      },
    },
  ];

  const calls = parseToolCalls(toolCalls);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].toolName, "read-file");
  assert.equal(calls[1].toolName, "bash");
});

test("parseToolCalls: 复杂参数解析", () => {
  const toolCalls = [
    {
      id: "call_edit",
      type: "function",
      function: {
        name: "edit-file",
        arguments: '{"path": "test.ts", "old_string": "foo", "new_string": "bar", "replace_all": true}',
      },
    },
  ];

  const calls = parseToolCalls(toolCalls);

  assert.deepEqual(calls[0].input, {
    path: "test.ts",
    old_string: "foo",
    new_string: "bar",
    replace_all: true,
  });
});

test("parseToolCalls: 无效 JSON 返回错误标记", () => {
  const toolCalls = [
    {
      id: "call_error",
      type: "function",
      function: {
        name: "read-file",
        arguments: 'not valid json',
      },
    },
  ];

  const calls = parseToolCalls(toolCalls);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, "call_error");
  assert.equal(calls[0].toolName, "read-file");
  assert.equal(calls[0].input._parseError, true);
  assert.ok(calls[0].input._rawArguments);
  assert.ok(calls[0].input._errorMessage);
});

test("parseToolCalls: 部分无效 JSON", () => {
  const toolCalls = [
    {
      id: "call_valid",
      type: "function",
      function: {
        name: "bash",
        arguments: '{"command": "ls"}',
      },
    },
    {
      id: "call_invalid",
      type: "function",
      function: {
        name: "read-file",
        arguments: '{invalid}',
      },
    },
  ];

  const calls = parseToolCalls(toolCalls);

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].input, { command: "ls" });
  assert.equal(calls[1].input._parseError, true);
});

// ============================================================
// hasParseError 测试
// ============================================================

test("hasParseError: 有效调用返回 false", () => {
  const call = {
    id: "call_1",
    toolName: "read-file",
    input: { path: "test.txt" },
  };

  assert.equal(hasParseError(call), false);
});

test("hasParseError: 无效调用返回 true", () => {
  const call = {
    id: "call_1",
    toolName: "read-file",
    input: {
      _parseError: true,
      _rawArguments: "bad json",
      _errorMessage: "parse error",
    },
  };

  assert.equal(hasParseError(call), true);
});

// ============================================================
// getParseErrorMessage 测试
// ============================================================

test("getParseErrorMessage: 提取错误消息", () => {
  const call = {
    id: "call_1",
    toolName: "read-file",
    input: {
      _parseError: true,
      _rawArguments: "bad",
      _errorMessage: "无法解析工具参数：无效的 JSON 格式",
    },
  };

  assert.equal(
    getParseErrorMessage(call),
    "无法解析工具参数：无效的 JSON 格式"
  );
});

test("getParseErrorMessage: 缺少消息返回默认值", () => {
  const call = {
    id: "call_1",
    toolName: "read-file",
    input: {
      _parseError: true,
    },
  };

  assert.equal(getParseErrorMessage(call), "未知解析错误。");
});
