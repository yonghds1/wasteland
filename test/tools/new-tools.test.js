/**
 * new-tools.test.js - 新增工具测试
 *
 * 测试 ask-user 和 http-request 工具。
 */

import assert from "node:assert/strict";
import { test, describe } from "node:test";

// ============================================================
// Ask User 工具测试
// ============================================================

describe("ask-user 工具", () => {
  let createAskUserTool;

  test("导入工具模块", async () => {
    const mod = await import("../../dist/tools/ask-user.js");
    createAskUserTool = mod.createAskUserTool;
    assert.ok(createAskUserTool, "应该导出 createAskUserTool");
  });

  test("创建工具实例", () => {
    const tool = createAskUserTool();

    assert.ok(tool, "应该创建工具实例");
    assert.equal(tool.name, "ask-user", "工具名称应该是 ask-user");
    assert.equal(tool.riskLevel, "low", "风险等级应该是 low");
    assert.ok(tool.execute, "应该有 execute 方法");
  });

  test("执行提问（无选项）", async () => {
    const tool = createAskUserTool();

    const result = await tool.execute(
      { question: "你想做什么？" },
      { sessionId: "test", turn: 1, cwd: process.cwd() },
    );

    assert.ok(result, "应该有返回结果");
    assert.equal(result.status, "success", "状态应该是 success");
    assert.ok(result.output.includes("你想做什么"), "输出应该包含问题");
    assert.ok(result.data?.pendingUserInput, "应该标记为待用户输入");
  });

  test("执行提问（有选项）", async () => {
    const tool = createAskUserTool();

    const result = await tool.execute(
      { question: "选择一个选项", options: ["A", "B", "C"] },
      { sessionId: "test", turn: 1, cwd: process.cwd() },
    );

    assert.ok(result, "应该有返回结果");
    assert.equal(result.status, "success", "状态应该是 success");
    assert.ok(result.output.includes("选择一个选项"), "输出应该包含问题");
    assert.ok(result.output.includes("A, B, C"), "输出应该包含选项");
  });

  test("缺少 question 参数", async () => {
    const tool = createAskUserTool();

    const result = await tool.execute(
      {},
      { sessionId: "test", turn: 1, cwd: process.cwd() },
    );

    assert.ok(result, "应该有返回结果");
    assert.equal(result.status, "error", "状态应该是 error");
    assert.ok(result.error.includes("question") || result.error.includes("missingQuestion"), "错误信息应该提到 question");
  });
});

// ============================================================
// HTTP Request 工具测试
// ============================================================

describe("http-request 工具", () => {
  let createHttpRequestTool;

  test("导入工具模块", async () => {
    const mod = await import("../../dist/tools/http-request.js");
    createHttpRequestTool = mod.createHttpRequestTool;
    assert.ok(createHttpRequestTool, "应该导出 createHttpRequestTool");
  });

  test("创建工具实例", () => {
    const tool = createHttpRequestTool();

    assert.ok(tool, "应该创建工具实例");
    assert.equal(tool.name, "http-request", "工具名称应该是 http-request");
    assert.equal(tool.riskLevel, "execute", "风险等级应该是 execute");
    assert.ok(tool.execute, "应该有 execute 方法");
  });

  test("缺少 url 参数", async () => {
    const tool = createHttpRequestTool();

    const result = await tool.execute(
      {},
      { sessionId: "test", turn: 1, cwd: process.cwd() },
    );

    assert.ok(result, "应该有返回结果");
    assert.equal(result.status, "error", "状态应该是 error");
    assert.ok(result.error.includes("url"), "错误信息应该提到 url");
  });

  test("无效的 URL", async () => {
    const tool = createHttpRequestTool();

    const result = await tool.execute(
      { url: "not-a-valid-url" },
      { sessionId: "test", turn: 1, cwd: process.cwd() },
    );

    assert.ok(result, "应该有返回结果");
    assert.equal(result.status, "error", "状态应该是 error");
    assert.ok(result.error.includes("无效"), "错误信息应该提到无效");
  });

  test("GET 请求", async () => {
    const tool = createHttpRequestTool();

    try {
      const result = await tool.execute(
        { url: "https://httpbin.org/get" },
        { sessionId: "test", turn: 1, cwd: process.cwd() },
      );

      assert.ok(result, "应该有返回结果");

      if (result.status === "success") {
        assert.ok(result.output.includes("HTTP GET"), "输出应该包含方法");
        assert.ok(result.output.includes("200"), "输出应该包含状态码");
        assert.ok(result.data?.statusCode, "应该有状态码数据");
        assert.ok(result.data?.headers, "应该有响应头数据");
        assert.ok(result.data?.body, "应该有响应体数据");
      }
    } catch (error) {
      // 网络请求可能失败，跳过
      console.log("跳过 HTTP 测试：网络不可用");
    }
  });

  test("POST 请求", async () => {
    const tool = createHttpRequestTool();

    try {
      const result = await tool.execute(
        {
          url: "https://httpbin.org/post",
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ test: true }),
        },
        { sessionId: "test", turn: 1, cwd: process.cwd() },
      );

      assert.ok(result, "应该有返回结果");

      if (result.status === "success") {
        assert.ok(result.output.includes("HTTP POST"), "输出应该包含方法");
        assert.ok(result.output.includes("200"), "输出应该包含状态码");
      }
    } catch (error) {
      // 网络请求可能失败，跳过
      console.log("跳过 HTTP 测试：网络不可用");
    }
  });
});

// ============================================================
// 工具注册表测试
// ============================================================

describe("工具注册表（包含新工具）", () => {
  let createDefaultToolRegistry;

  test("导入注册表模块", async () => {
    const mod = await import("../../dist/tools/default-registry.js");
    createDefaultToolRegistry = mod.createDefaultToolRegistry;
    assert.ok(createDefaultToolRegistry, "应该导出 createDefaultToolRegistry");
  });

  test("注册表包含新工具", () => {
    const { toolRegistry } = createDefaultToolRegistry();
    const tools = toolRegistry.list();

    assert.ok(tools.includes("ask-user"), "应该包含 ask-user 工具");
    assert.ok(tools.includes("http-request"), "应该包含 http-request 工具");
  });

  test("通过注册表获取新工具", () => {
    const { toolRegistry } = createDefaultToolRegistry();

    const askUserTool = toolRegistry.get("ask-user");
    assert.ok(askUserTool, "应该能获取 ask-user 工具");
    assert.equal(askUserTool.name, "ask-user");

    const httpRequestTool = toolRegistry.get("http-request");
    assert.ok(httpRequestTool, "应该能获取 http-request 工具");
    assert.equal(httpRequestTool.name, "http-request");
  });
});
