/**
 * new-tools.test.js - 新增工具测试
 *
 * 测试 ask-user 和 http-request 工具。
 */

import { describe, it, expect, beforeAll } from "vitest";

// ============================================================
// Ask User 工具测试
// ============================================================

describe("ask-user 工具", () => {
  let createAskUserTool;

  beforeAll(async () => {
    const mod = await import("../../dist/tools/ask-user.js");
    createAskUserTool = mod.createAskUserTool;
  });

  it("导入工具模块", () => {
    expect(createAskUserTool).toBeTruthy();
  });

  it("创建工具实例", () => {
    const tool = createAskUserTool();
    expect(tool).toBeTruthy();
    expect(tool.name).toBe("ask-user");
    expect(tool.riskLevel).toBe("read");
    expect(tool.execute).toBeTruthy();
  });

  it("执行提问（无选项）", async () => {
    const tool = createAskUserTool();
    const result = await tool.execute(
      { question: "你想做什么？" },
      { sessionId: "test", turn: 1, cwd: process.cwd() },
    );

    expect(result).toBeTruthy();
    expect(result.status).toBe("success");
    expect(result.output).toContain("你想做什么");
    expect(result.data?.pendingUserInput).toBeTruthy();
  });

  it("执行提问（有选项）", async () => {
    const tool = createAskUserTool();
    const result = await tool.execute(
      { question: "选择一个选项", options: ["A", "B", "C"] },
      { sessionId: "test", turn: 1, cwd: process.cwd() },
    );

    expect(result).toBeTruthy();
    expect(result.status).toBe("success");
    expect(result.output).toContain("选择一个选项");
    expect(result.output).toContain("A, B, C");
  });

  it("缺少 question 参数", async () => {
    const tool = createAskUserTool();
    const result = await tool.execute(
      {},
      { sessionId: "test", turn: 1, cwd: process.cwd() },
    );

    expect(result).toBeTruthy();
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/question|Required|missing|Invalid|invalid_type/i);
  });
});

// ============================================================
// HTTP Request 工具测试
// ============================================================

describe("http-request 工具", () => {
  let createHttpRequestTool;

  beforeAll(async () => {
    const mod = await import("../../dist/tools/http-request.js");
    createHttpRequestTool = mod.createHttpRequestTool;
  });

  it("导入工具模块", () => {
    expect(createHttpRequestTool).toBeTruthy();
  });

  it("创建工具实例", () => {
    const tool = createHttpRequestTool();
    expect(tool).toBeTruthy();
    expect(tool.name).toBe("http-request");
    expect(tool.riskLevel).toBe("execute");
    expect(tool.execute).toBeTruthy();
  });

  it("缺少 url 参数", async () => {
    const tool = createHttpRequestTool();
    const result = await tool.execute(
      {},
      { sessionId: "test", turn: 1, cwd: process.cwd() },
    );

    expect(result).toBeTruthy();
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/url|Invalid|Required/i);
  });

  it("无效的 URL", async () => {
    const tool = createHttpRequestTool();
    const result = await tool.execute(
      { url: "not-a-valid-url" },
      { sessionId: "test", turn: 1, cwd: process.cwd() },
    );

    expect(result).toBeTruthy();
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/无效|Invalid|invalid/i);
  });
});

// ============================================================
// 工具注册表测试
// ============================================================

describe("工具注册表（包含新工具）", () => {
  let createDefaultToolRegistry;

  beforeAll(async () => {
    const mod = await import("../../dist/tools/default-registry.js");
    createDefaultToolRegistry = mod.createDefaultToolRegistry;
  });

  it("导入注册表模块", () => {
    expect(createDefaultToolRegistry).toBeTruthy();
  });

  it("注册表包含新工具", () => {
    const { toolRegistry } = createDefaultToolRegistry();
    const tools = toolRegistry.list();

    expect(tools).toContain("ask-user");
    expect(tools).toContain("http-request");
  });

  it("通过注册表获取新工具", () => {
    const { toolRegistry } = createDefaultToolRegistry();

    const askUserTool = toolRegistry.get("ask-user");
    expect(askUserTool).toBeTruthy();
    expect(askUserTool.name).toBe("ask-user");

    const httpRequestTool = toolRegistry.get("http-request");
    expect(httpRequestTool).toBeTruthy();
    expect(httpRequestTool.name).toBe("http-request");
  });
});
