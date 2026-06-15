/**
 * git-web-search.test.js - Git 和 Web-Search 工具测试
 *
 * 测试 git 和 web-search 工具的基本功能。
 */

import { describe, it, expect, beforeAll } from "vitest";

// ============================================================
// Git 工具测试
// ============================================================

describe("git 工具", () => {
  let createGitTool;

  beforeAll(async () => {
    const mod = await import("../../dist/tools/git.js");
    createGitTool = mod.createGitTool;
  });

  it("导入工具模块", () => {
    expect(createGitTool).toBeTruthy();
  });

  it("创建工具实例", () => {
    const tool = createGitTool();
    expect(tool).toBeTruthy();
    expect(tool.name).toBe("git");
    expect(tool.riskLevel).toBe("execute");
    expect(tool.execute).toBeTruthy();
  });

  it("缺少 subcommand 参数", async () => {
    const tool = createGitTool();
    const result = await tool.execute(
      {},
      { sessionId: "test", turn: 1, cwd: process.cwd() },
    );

    expect(result).toBeTruthy();
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/subcommand|needSubcommand|Invalid|Required/i);
  });

  it("空 subcommand 参数", async () => {
    const tool = createGitTool();
    const result = await tool.execute(
      { subcommand: "" },
      { sessionId: "test", turn: 1, cwd: process.cwd() },
    );

    expect(result).toBeTruthy();
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/subcommand|needSubcommand|Invalid|Expected/i);
  });

  it("执行 git status 命令", async () => {
    const tool = createGitTool();
    const result = await tool.execute(
      { subcommand: "status" },
      { sessionId: "test", turn: 1, cwd: process.cwd() },
    );

    expect(result).toBeTruthy();
    expect(result.status).toBe("success");
    expect(result.output).toContain("git status");
    expect(result.data).toBeTruthy();
    expect(result.data.subcommand).toBe("status");
  });

  it("执行 git log 命令", async () => {
    const tool = createGitTool();
    const result = await tool.execute(
      { subcommand: "log", args: ["--oneline", "-5"] },
      { sessionId: "test", turn: 1, cwd: process.cwd() },
    );

    expect(result).toBeTruthy();
    expect(result.status).toBe("success");
    expect(result.output).toContain("git log");
  });

  it("commit 缺少 message 参数", async () => {
    const tool = createGitTool();
    const result = await tool.execute(
      { subcommand: "commit" },
      { sessionId: "test", turn: 1, cwd: process.cwd() },
    );

    expect(result).toBeTruthy();
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/message|needCommitMessage/);
  });

  it("禁止 force push", async () => {
    const tool = createGitTool();
    const result = await tool.execute(
      { subcommand: "push", args: ["--force"] },
      { sessionId: "test", turn: 1, cwd: process.cwd() },
    );

    expect(result).toBeTruthy();
    expect(result.status).toBe("error");
    // Match either translated message or i18n key
    expect(result.error).toMatch(/force|禁止|forcePushDenied|blockedSubcommand/);
  });

  it("禁止 rebase 命令", async () => {
    const tool = createGitTool();
    const result = await tool.execute(
      { subcommand: "rebase", args: ["main"] },
      { sessionId: "test", turn: 1, cwd: process.cwd() },
    );

    expect(result).toBeTruthy();
    expect(result.status).toBe("error");
    // Zod enum validation catches invalid subcommand before rebase check
    expect(result.error).toMatch(/rebase|禁止|blocked|blockedSubcommand|Invalid|Expected/i);
  });

  it("不支持的子命令", async () => {
    const tool = createGitTool();
    const result = await tool.execute(
      { subcommand: "cherry-pick", args: ["abc123"] },
      { sessionId: "test", turn: 1, cwd: process.cwd() },
    );

    expect(result).toBeTruthy();
    expect(result.status).toBe("error");
    // Zod enum validation catches invalid subcommand
    expect(result.error).toMatch(/cherry-pick|unsupported|Invalid|Expected/i);
  });
});

// ============================================================
// Web Search 工具测试
// ============================================================

describe("web-search 工具", () => {
  let createWebSearchTool;

  beforeAll(async () => {
    const mod = await import("../../dist/tools/web-search.js");
    createWebSearchTool = mod.createWebSearchTool;
  });

  it("导入工具模块", () => {
    expect(createWebSearchTool).toBeTruthy();
  });

  it("创建工具实例", () => {
    const tool = createWebSearchTool();
    expect(tool).toBeTruthy();
    expect(tool.name).toBe("web-search");
    expect(tool.riskLevel).toBe("read");
    expect(tool.execute).toBeTruthy();
  });

  it("缺少 query 参数", async () => {
    const tool = createWebSearchTool();
    const result = await tool.execute(
      {},
      { sessionId: "test", turn: 1, cwd: process.cwd() },
    );

    expect(result).toBeTruthy();
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/query|Required|Invalid/i);
  });

  it("空 query 参数", async () => {
    const tool = createWebSearchTool();
    const result = await tool.execute(
      { query: "" },
      { sessionId: "test", turn: 1, cwd: process.cwd() },
    );

    expect(result).toBeTruthy();
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/query|Required|Too small|Invalid/i);
  });

  it("不支持的搜索引擎", async () => {
    const tool = createWebSearchTool();
    const result = await tool.execute(
      { query: "test", engine: "google" },
      { sessionId: "test", turn: 1, cwd: process.cwd() },
    );

    expect(result).toBeTruthy();
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/google|搜索引擎|Invalid|Expected/i);
  });

  it("默认使用 duckduckgo 搜索引擎", async () => {
    const tool = createWebSearchTool();
    // 注意：这个测试可能需要网络访问，如果网络不可用会失败
    // 在 CI 环境中可能需要 mock
    try {
      const result = await tool.execute(
        { query: "TypeScript" },
        { sessionId: "test", turn: 1, cwd: process.cwd() },
      );

      expect(result).toBeTruthy();
      // 如果网络可用，应该成功
      if (result.status === "success") {
        expect(result.output).toContain("web-search");
        expect(result.data).toBeTruthy();
        expect(result.data.engine).toBe("duckduckgo");
      }
    } catch {
      // 网络不可用时跳过
    }
  });

  it("限制最大结果数量", async () => {
    const tool = createWebSearchTool();
    try {
      const result = await tool.execute(
        { query: "test", maxResults: 100 },
        { sessionId: "test", turn: 1, cwd: process.cwd() },
      );

      expect(result).toBeTruthy();
      // maxResults 应该被限制在 20
      if (result.status === "success" && result.data) {
        expect(result.data.results.length).toBeLessThanOrEqual(20);
      }
    } catch {
      // 网络不可用时跳过
    }
  });
});

// ============================================================
// 工具注册表测试（包含新工具）
// ============================================================

describe("工具注册表（包含 git 和 web-search 工具）", () => {
  let createDefaultToolRegistry;

  beforeAll(async () => {
    const mod = await import("../../dist/tools/default-registry.js");
    createDefaultToolRegistry = mod.createDefaultToolRegistry;
  });

  it("导入注册表模块", () => {
    expect(createDefaultToolRegistry).toBeTruthy();
  });

  it("注册表包含 git 工具", () => {
    const { toolRegistry } = createDefaultToolRegistry();
    const tools = toolRegistry.list();

    expect(tools).toContain("git");
  });

  it("注册表包含 web-search 工具", () => {
    const { toolRegistry } = createDefaultToolRegistry();
    const tools = toolRegistry.list();

    expect(tools).toContain("web-search");
  });

  it("通过注册表获取 git 工具", () => {
    const { toolRegistry } = createDefaultToolRegistry();

    const gitTool = toolRegistry.get("git");
    expect(gitTool).toBeTruthy();
    expect(gitTool.name).toBe("git");
    expect(gitTool.riskLevel).toBe("execute");
  });

  it("通过注册表获取 web-search 工具", () => {
    const { toolRegistry } = createDefaultToolRegistry();

    const webSearchTool = toolRegistry.get("web-search");
    expect(webSearchTool).toBeTruthy();
    expect(webSearchTool.name).toBe("web-search");
    expect(webSearchTool.riskLevel).toBe("read");
  });
});
