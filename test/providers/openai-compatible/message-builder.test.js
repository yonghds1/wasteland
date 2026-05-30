/**
 * message-builder.test.js - 消息构建器单元测试
 *
 * 测试 buildMessages 和 buildToolResultMessages 的正确性。
 */

import { describe, it, expect } from "vitest";
import { buildMessages, buildToolResultMessages, needsToolLoop } from "../../../dist/providers/openai-compatible/message-builder.js";

// ============================================================
// buildMessages 测试
// ============================================================

describe("buildMessages", () => {
  it("基本消息构建（无历史、无工具）", () => {
    const messages = buildMessages({
      history: [],
      input: "你好",
      toolResults: [],
    });

    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("你好");
  });

  it("包含 system prompt", () => {
    const messages = buildMessages({
      history: [],
      input: "测试",
      toolResults: [],
      prompt: "你是一个助手。",
    });

    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toBe("你是一个助手。");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toBe("测试");
  });

  it("包含历史对话", () => {
    const history = [
      { type: "message", role: "user", turn: 1, content: "问题1", source: "message", timestamp: "2026-01-01 00:00:00" },
      { type: "message", role: "assistant", turn: 1, content: "回答1", source: "provider", timestamp: "2026-01-01 00:00:01" },
      { type: "message", role: "user", turn: 2, content: "问题2", source: "message", timestamp: "2026-01-01 00:00:02" },
    ];

    const messages = buildMessages({
      history,
      input: "问题3",
      toolResults: [],
    });

    expect(messages.length).toBe(4);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("问题1");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("回答1");
    expect(messages[2].role).toBe("user");
    expect(messages[2].content).toBe("问题2");
    expect(messages[3].role).toBe("user");
    expect(messages[3].content).toBe("问题3");
  });

  it("跳过非消息类型的记录", () => {
    const history = [
      { type: "message", role: "user", turn: 1, content: "问题", source: "message", timestamp: "..." },
      { type: "tool_call", callId: "call_1", toolName: "bash", input: {}, timestamp: "..." },
      { type: "tool_result", callId: "call_1", toolName: "bash", status: "success", output: "result", timestamp: "..." },
      { type: "message", role: "assistant", turn: 1, content: "回答", source: "provider", timestamp: "..." },
    ];

    const messages = buildMessages({
      history,
      input: "继续",
      toolResults: [],
    });

    expect(messages.length).toBe(3);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[2].role).toBe("user");
  });

  it("包含工具结果", () => {
    const toolResults = [
      {
        callId: "call_abc",
        toolName: "read-file",
        status: "success",
        output: "文件内容",
        input: { path: "test.txt" },
      },
    ];

    const messages = buildMessages({
      history: [],
      input: "读取文件",
      toolResults,
    });

    expect(messages.length).toBe(3);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("读取文件");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBeNull();
    expect(messages[1].tool_calls).toBeTruthy();
    expect(messages[1].tool_calls.length).toBe(1);
    expect(messages[1].tool_calls[0].id).toBe("call_abc");
    expect(messages[1].tool_calls[0].function.name).toBe("read-file");
    expect(messages[2].role).toBe("tool");
    expect(messages[2].tool_call_id).toBe("call_abc");
    expect(messages[2].content).toBe("文件内容");
  });

  it("多个工具结果", () => {
    const toolResults = [
      { callId: "call_1", toolName: "read-file", status: "success", output: "内容1", input: { path: "a.txt" } },
      { callId: "call_2", toolName: "bash", status: "success", output: "结果2", input: { command: "pwd" } },
    ];

    const messages = buildMessages({ history: [], input: "执行任务", toolResults });

    expect(messages.length).toBe(4);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].tool_calls.length).toBe(2);
    expect(messages[2].role).toBe("tool");
    expect(messages[2].tool_call_id).toBe("call_1");
    expect(messages[3].role).toBe("tool");
    expect(messages[3].tool_call_id).toBe("call_2");
  });

  it("工具执行失败", () => {
    const toolResults = [
      { callId: "call_error", toolName: "bash", status: "error", error: "命令执行失败", input: { command: "invalid" } },
    ];

    const messages = buildMessages({ history: [], input: "执行命令", toolResults });

    expect(messages.length).toBe(3);
    expect(messages[2].role).toBe("tool");
    expect(messages[2].content).toBe("命令执行失败");
  });

  it("工具结果无输出", () => {
    const toolResults = [
      { callId: "call_empty", toolName: "bash", status: "success", input: { command: "echo" } },
    ];

    const messages = buildMessages({ history: [], input: "执行", toolResults });
    // 返回 i18n key 或本地化文本
    expect(messages[2].content).toBeTruthy();
    expect(messages[2].role).toBe("tool");
  });

  it("完整场景（system + history + tool results）", () => {
    const history = [
      { type: "message", role: "user", turn: 1, content: "你好", source: "message", timestamp: "..." },
      { type: "message", role: "assistant", turn: 1, content: "你好！", source: "provider", timestamp: "..." },
    ];
    const toolResults = [
      { callId: "call_1", toolName: "read-file", status: "success", output: "文件内容", input: { path: "test.txt" } },
    ];

    const messages = buildMessages({ history, input: "读取文件", toolResults, prompt: "你是一个助手。" });

    expect(messages.length).toBe(6);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toBe("你好");
    expect(messages[2].role).toBe("assistant");
    expect(messages[2].content).toBe("你好！");
    expect(messages[3].role).toBe("user");
    expect(messages[3].content).toBe("读取文件");
    expect(messages[4].role).toBe("assistant");
    expect(messages[4].tool_calls).toBeTruthy();
    expect(messages[5].role).toBe("tool");
  });
});

// ============================================================
// buildToolResultMessages 测试
// ============================================================

describe("buildToolResultMessages", () => {
  it("单个结果", () => {
    const results = [{ callId: "call_1", toolName: "bash", status: "success", output: "success" }];
    const messages = buildToolResultMessages(results);

    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe("tool");
    expect(messages[0].tool_call_id).toBe("call_1");
    expect(messages[0].content).toBe("success");
  });

  it("多个结果", () => {
    const results = [
      { callId: "call_1", toolName: "bash", status: "success", output: "result1" },
      { callId: "call_2", toolName: "read-file", status: "error", error: "文件不存在" },
    ];
    const messages = buildToolResultMessages(results);

    expect(messages.length).toBe(2);
    expect(messages[0].content).toBe("result1");
    expect(messages[1].content).toBe("文件不存在");
  });

  it("空数组", () => {
    expect(buildToolResultMessages([])).toEqual([]);
  });
});

// ============================================================
// needsToolLoop 测试
// ============================================================

describe("needsToolLoop", () => {
  it("最后是 tool 消息返回 true", () => {
    const messages = [
      { role: "user", content: "test" },
      { role: "assistant", tool_calls: [] },
      { role: "tool", tool_call_id: "call_1", content: "result" },
    ];
    expect(needsToolLoop(messages)).toBe(true);
  });

  it("最后不是 tool 消息返回 false", () => {
    const messages = [
      { role: "user", content: "test" },
      { role: "assistant", content: "reply" },
    ];
    expect(needsToolLoop(messages)).toBe(false);
  });

  it("空数组返回 false", () => {
    expect(needsToolLoop([])).toBe(false);
  });

  it("user 消息在最后返回 false", () => {
    const messages = [
      { role: "assistant", content: "reply" },
      { role: "user", content: "new question" },
    ];
    expect(needsToolLoop(messages)).toBe(false);
  });

  it("system 消息在最后返回 false", () => {
    const messages = [
      { role: "user", content: "test" },
      { role: "system", content: "system message" },
    ];
    expect(needsToolLoop(messages)).toBe(false);
  });
});
