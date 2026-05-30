/**
 * tool-adapter.test.js - 工具适配器单元测试
 *
 * 测试 buildOpenAITools 和 parseToolCalls 的正确性。
 */

import { describe, it, expect } from "vitest";
import { buildOpenAITools, parseToolCalls, hasParseError, getParseErrorMessage } from "../../../dist/providers/openai-compatible/tool-adapter.js";
import { ToolRegistry } from "../../../dist/tools/tool-registry.js";

// ============================================================
// buildOpenAITools 测试
// ============================================================

describe("buildOpenAITools", () => {
  it("空注册表返回空数组", () => {
    const registry = new ToolRegistry();
    const tools = buildOpenAITools(registry);
    expect(tools).toEqual([]);
  });

  it("单个工具转换", () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "read-file",
      description: "读取文件",
      riskLevel: "read",
      execute: async () => ({ status: "success", output: "" }),
    });

    const tools = buildOpenAITools(registry);

    expect(tools.length).toBe(1);
    expect(tools[0].type).toBe("function");
    expect(tools[0].function.name).toBe("read-file");
    expect(tools[0].function.description).toBeTruthy();
    expect(tools[0].function.parameters).toBeTruthy();
    expect(tools[0].function.parameters.type).toBe("object");
    expect(tools[0].function.parameters.properties.path).toBeTruthy();
    expect(tools[0].function.parameters.required).toEqual(["path"]);
  });

  it("多个工具转换", () => {
    const registry = new ToolRegistry();
    registry.register({ name: "read-file", description: "读取文件", riskLevel: "read", execute: async () => ({ status: "success", output: "" }) });
    registry.register({ name: "bash", description: "执行命令", riskLevel: "write", execute: async () => ({ status: "success", output: "" }) });

    const tools = buildOpenAITools(registry);
    expect(tools.length).toBe(2);
    const toolNames = tools.map(t => t.function.name);
    expect(toolNames).toContain("read-file");
    expect(toolNames).toContain("bash");
  });

  it("edit-file 参数 Schema 正确", () => {
    const registry = new ToolRegistry();
    registry.register({ name: "edit-file", description: "编辑文件", riskLevel: "write", execute: async () => ({ status: "success", output: "" }) });

    const tools = buildOpenAITools(registry);
    const params = tools[0].function.parameters;

    expect(params.properties.path).toBeTruthy();
    expect(params.properties.old_string).toBeTruthy();
    expect(params.properties.new_string).toBeTruthy();
    expect(params.properties.replace_all).toBeTruthy();
    expect(params.required).toEqual(["path", "old_string", "new_string"]);
  });

  it("spawn_agent 参数 Schema 正确", () => {
    const registry = new ToolRegistry();
    registry.register({ name: "spawn_agent", description: "创建子 Agent", riskLevel: "write", execute: async () => ({ status: "success", output: "" }) });

    const tools = buildOpenAITools(registry);
    const params = tools[0].function.parameters;

    expect(params.properties.name).toBeTruthy();
    expect(params.properties.task).toBeTruthy();
    expect(params.properties.model).toBeTruthy();
    expect(params.properties.tools).toBeTruthy();
    expect(params.properties.inheritHistory).toBeTruthy();
    expect(params.required).toEqual(["name", "task"]);
  });
});

// ============================================================
// parseToolCalls 测试
// ============================================================

describe("parseToolCalls", () => {
  it("空数组返回空数组", () => {
    expect(parseToolCalls([])).toEqual([]);
  });

  it("单个工具调用解析", () => {
    const toolCalls = [
      { id: "call_abc123", type: "function", function: { name: "read-file", arguments: '{"path": "package.json"}' } },
    ];
    const calls = parseToolCalls(toolCalls);

    expect(calls.length).toBe(1);
    expect(calls[0].id).toBe("call_abc123");
    expect(calls[0].toolName).toBe("read-file");
    expect(calls[0].input).toEqual({ path: "package.json" });
  });

  it("多个工具调用解析", () => {
    const toolCalls = [
      { id: "call_1", type: "function", function: { name: "read-file", arguments: '{"path": "a.txt"}' } },
      { id: "call_2", type: "function", function: { name: "bash", arguments: '{"command": "pwd"}' } },
    ];
    const calls = parseToolCalls(toolCalls);

    expect(calls.length).toBe(2);
    expect(calls[0].toolName).toBe("read-file");
    expect(calls[1].toolName).toBe("bash");
  });

  it("复杂参数解析", () => {
    const toolCalls = [
      { id: "call_edit", type: "function", function: { name: "edit-file", arguments: '{"path": "test.ts", "old_string": "foo", "new_string": "bar", "replace_all": true}' } },
    ];
    const calls = parseToolCalls(toolCalls);

    expect(calls[0].input).toEqual({ path: "test.ts", old_string: "foo", new_string: "bar", replace_all: true });
  });

  it("无效 JSON 返回错误标记", () => {
    const toolCalls = [
      { id: "call_error", type: "function", function: { name: "read-file", arguments: "not valid json" } },
    ];
    const calls = parseToolCalls(toolCalls);

    expect(calls.length).toBe(1);
    expect(calls[0].id).toBe("call_error");
    expect(calls[0].toolName).toBe("read-file");
    expect(calls[0].input._parseError).toBe(true);
    expect(calls[0].input._rawArguments).toBeTruthy();
    expect(calls[0].input._errorMessage).toBeTruthy();
  });

  it("部分无效 JSON", () => {
    const toolCalls = [
      { id: "call_valid", type: "function", function: { name: "bash", arguments: '{"command": "ls"}' } },
      { id: "call_invalid", type: "function", function: { name: "read-file", arguments: "{invalid}" } },
    ];
    const calls = parseToolCalls(toolCalls);

    expect(calls.length).toBe(2);
    expect(calls[0].input).toEqual({ command: "ls" });
    expect(calls[1].input._parseError).toBe(true);
  });
});

// ============================================================
// hasParseError 测试
// ============================================================

describe("hasParseError", () => {
  it("有效调用返回 false", () => {
    const call = { id: "call_1", toolName: "read-file", input: { path: "test.txt" } };
    expect(hasParseError(call)).toBe(false);
  });

  it("无效调用返回 true", () => {
    const call = { id: "call_1", toolName: "read-file", input: { _parseError: true, _rawArguments: "bad json", _errorMessage: "parse error" } };
    expect(hasParseError(call)).toBe(true);
  });
});

// ============================================================
// getParseErrorMessage 测试
// ============================================================

describe("getParseErrorMessage", () => {
  it("提取错误消息", () => {
    const call = { id: "call_1", toolName: "read-file", input: { _parseError: true, _rawArguments: "bad", _errorMessage: "无法解析工具参数：无效的 JSON 格式" } };
    expect(getParseErrorMessage(call)).toBe("无法解析工具参数：无效的 JSON 格式");
  });

  it("缺少消息返回默认值", () => {
    const call = { id: "call_1", toolName: "read-file", input: { _parseError: true } };
    const msg = getParseErrorMessage(call);
    expect(msg).toBeTruthy();
    expect(typeof msg).toBe("string");
  });
});
