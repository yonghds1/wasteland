/**
 * message-builder.test.js - 消息构建器单元测试
 *
 * 测试 buildMessages 和 buildToolResultMessages 的正确性。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMessages, buildToolResultMessages, needsToolLoop } from "../../../dist/providers/openai-compatible/message-builder.js";

// ============================================================
// buildMessages 测试
// ============================================================

test("buildMessages: 基本消息构建（无历史、无工具）", () => {
  const messages = buildMessages({
    history: [],
    input: "你好",
    toolResults: [],
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[0].content, "你好");
});

test("buildMessages: 包含 system prompt", () => {
  const messages = buildMessages({
    history: [],
    input: "测试",
    toolResults: [],
    prompt: "你是一个助手。",
  });

  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, "system");
  assert.equal(messages[0].content, "你是一个助手。");
  assert.equal(messages[1].role, "user");
  assert.equal(messages[1].content, "测试");
});

test("buildMessages: 包含历史对话", () => {
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

  assert.equal(messages.length, 4);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[0].content, "问题1");
  assert.equal(messages[1].role, "assistant");
  assert.equal(messages[1].content, "回答1");
  assert.equal(messages[2].role, "user");
  assert.equal(messages[2].content, "问题2");
  assert.equal(messages[3].role, "user");
  assert.equal(messages[3].content, "问题3");
});

test("buildMessages: 跳过非消息类型的记录", () => {
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

  assert.equal(messages.length, 3);
  assert.equal(messages[0].role, "user");
  assert.equal(messages[1].role, "assistant");
  assert.equal(messages[2].role, "user");
});

test("buildMessages: 包含工具结果", () => {
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

  assert.equal(messages.length, 3);

  // 1. 用户输入
  assert.equal(messages[0].role, "user");
  assert.equal(messages[0].content, "读取文件");

  // 2. assistant 消息（包含 tool_calls）
  assert.equal(messages[1].role, "assistant");
  assert.equal(messages[1].content, null);
  assert.ok(messages[1].tool_calls);
  assert.equal(messages[1].tool_calls.length, 1);
  assert.equal(messages[1].tool_calls[0].id, "call_abc");
  assert.equal(messages[1].tool_calls[0].function.name, "read-file");

  // 3. tool 消息
  assert.equal(messages[2].role, "tool");
  assert.equal(messages[2].tool_call_id, "call_abc");
  assert.equal(messages[2].content, "文件内容");
});

test("buildMessages: 多个工具结果", () => {
  const toolResults = [
    {
      callId: "call_1",
      toolName: "read-file",
      status: "success",
      output: "内容1",
      input: { path: "a.txt" },
    },
    {
      callId: "call_2",
      toolName: "bash",
      status: "success",
      output: "结果2",
      input: { command: "pwd" },
    },
  ];

  const messages = buildMessages({
    history: [],
    input: "执行任务",
    toolResults,
  });

  assert.equal(messages.length, 4);

  // user
  assert.equal(messages[0].role, "user");

  // assistant with tool_calls
  assert.equal(messages[1].role, "assistant");
  assert.equal(messages[1].tool_calls.length, 2);

  // tool messages
  assert.equal(messages[2].role, "tool");
  assert.equal(messages[2].tool_call_id, "call_1");
  assert.equal(messages[3].role, "tool");
  assert.equal(messages[3].tool_call_id, "call_2");
});

test("buildMessages: 工具执行失败", () => {
  const toolResults = [
    {
      callId: "call_error",
      toolName: "bash",
      status: "error",
      error: "命令执行失败",
      input: { command: "invalid" },
    },
  ];

  const messages = buildMessages({
    history: [],
    input: "执行命令",
    toolResults,
  });

  assert.equal(messages.length, 3);

  // tool 消息包含错误信息
  assert.equal(messages[2].role, "tool");
  assert.equal(messages[2].content, "命令执行失败");
});

test("buildMessages: 工具结果无输出", () => {
  const toolResults = [
    {
      callId: "call_empty",
      toolName: "bash",
      status: "success",
      input: { command: "echo" },
    },
  ];

  const messages = buildMessages({
    history: [],
    input: "执行",
    toolResults,
  });

  // tool 消息使用默认值
  assert.equal(messages[2].content, "(无输出)");
});

test("buildMessages: 完整场景（system + history + tool results）", () => {
  const history = [
    { type: "message", role: "user", turn: 1, content: "你好", source: "message", timestamp: "..." },
    { type: "message", role: "assistant", turn: 1, content: "你好！", source: "provider", timestamp: "..." },
  ];

  const toolResults = [
    {
      callId: "call_1",
      toolName: "read-file",
      status: "success",
      output: "文件内容",
      input: { path: "test.txt" },
    },
  ];

  const messages = buildMessages({
    history,
    input: "读取文件",
    toolResults,
    prompt: "你是一个助手。",
  });

  assert.equal(messages.length, 6);

  // system
  assert.equal(messages[0].role, "system");

  // history
  assert.equal(messages[1].role, "user");
  assert.equal(messages[1].content, "你好");
  assert.equal(messages[2].role, "assistant");
  assert.equal(messages[2].content, "你好！");

  // current input
  assert.equal(messages[3].role, "user");
  assert.equal(messages[3].content, "读取文件");

  // tool results
  assert.equal(messages[4].role, "assistant");
  assert.ok(messages[4].tool_calls);
  assert.equal(messages[5].role, "tool");
});

// ============================================================
// buildToolResultMessages 测试
// ============================================================

test("buildToolResultMessages: 单个结果", () => {
  const results = [
    {
      callId: "call_1",
      toolName: "bash",
      status: "success",
      output: "success",
    },
  ];

  const messages = buildToolResultMessages(results);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "tool");
  assert.equal(messages[0].tool_call_id, "call_1");
  assert.equal(messages[0].content, "success");
});

test("buildToolResultMessages: 多个结果", () => {
  const results = [
    {
      callId: "call_1",
      toolName: "bash",
      status: "success",
      output: "result1",
    },
    {
      callId: "call_2",
      toolName: "read-file",
      status: "error",
      error: "文件不存在",
    },
  ];

  const messages = buildToolResultMessages(results);

  assert.equal(messages.length, 2);
  assert.equal(messages[0].content, "result1");
  assert.equal(messages[1].content, "文件不存在");
});

test("buildToolResultMessages: 空数组", () => {
  const messages = buildToolResultMessages([]);
  assert.deepEqual(messages, []);
});

// ============================================================
// needsToolLoop 测试
// ============================================================

test("needsToolLoop: 最后是 tool 消息返回 true", () => {
  const messages = [
    { role: "user", content: "test" },
    { role: "assistant", tool_calls: [] },
    { role: "tool", tool_call_id: "call_1", content: "result" },
  ];

  assert.equal(needsToolLoop(messages), true);
});

test("needsToolLoop: 最后不是 tool 消息返回 false", () => {
  const messages = [
    { role: "user", content: "test" },
    { role: "assistant", content: "reply" },
  ];

  assert.equal(needsToolLoop(messages), false);
});

test("needsToolLoop: 空数组返回 false", () => {
  assert.equal(needsToolLoop([]), false);
});

test("needsToolLoop: user 消息在最后返回 false", () => {
  const messages = [
    { role: "assistant", content: "reply" },
    { role: "user", content: "new question" },
  ];

  assert.equal(needsToolLoop(messages), false);
});

test("needsToolLoop: system 消息在最后返回 false", () => {
  const messages = [
    { role: "user", content: "test" },
    { role: "system", content: "system message" },
  ];

  assert.equal(needsToolLoop(messages), false);
});
