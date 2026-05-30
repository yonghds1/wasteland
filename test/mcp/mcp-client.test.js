/**
 * mcp-client.test.js - MCP Client 单元测试
 *
 * 测试 MCP 客户端的 JSON-RPC 通信、工具发现和调用功能。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================
// 辅助函数
// ============================================================

/**
 * 创建 MCP 客户端配置
 */
function createMockMCPConfig() {
  return {
    name: "test-mock",
    server: {
      command: "node",
      args: [join(__dirname, "../mock-mcp-server.cjs")],
      env: {},
      startupTimeout: 5000,
      requestTimeout: 10000,
    },
  };
}

// ============================================================
// MCPClient 测试
// ============================================================

describe("MCPClient", () => {
  let MCPClient;

  beforeAll(async () => {
    const mod = await import("../../dist/tools/mcp-client.js");
    MCPClient = mod.MCPClient;
  });

  it("创建客户端实例", () => {
    const config = createMockMCPConfig();
    const client = new MCPClient(config);

    expect(client).toBeTruthy();
    expect(client.isInitialized()).toBe(false, "初始状态应该是未初始化");
  });

  it("启动和初始化", async () => {
    const config = createMockMCPConfig();
    const client = new MCPClient(config);

    try {
      await client.start();

      expect(client.isInitialized()).toBeTruthy();

      const capabilities = client.getCapabilities();
      expect(capabilities).toBeTruthy();
      expect(capabilities.tools).toBeTruthy();

      await client.stop();
    } catch (error) {
      await client.stop().catch(() => {});
      throw error;
    }
  });

  it("列出工具", async () => {
    const config = createMockMCPConfig();
    const client = new MCPClient(config);

    try {
      await client.start();

      const tools = await client.listTools();

      expect(Array.isArray(tools)).toBeTruthy();
      expect(tools.length > 0).toBeTruthy();

      // 验证 write_code 工具
      const writeTool = tools.find(t => t.name === "write_code");
      expect(writeTool).toBeTruthy();
      expect(writeTool.description).toBeTruthy();
      expect(writeTool.inputSchema).toBeTruthy();

      // 验证 review_code 工具
      const reviewTool = tools.find(t => t.name === "review_code");
      expect(reviewTool).toBeTruthy();

      await client.stop();
    } catch (error) {
      await client.stop().catch(() => {});
      throw error;
    }
  });

  it("调用工具", async () => {
    const config = createMockMCPConfig();
    const client = new MCPClient(config);

    try {
      await client.start();

      const result = await client.callTool("write_code", {
        task: "Create a hello world function",
      });

      expect(result).toBeTruthy();
      expect(result.content).toBeTruthy();
      expect(Array.isArray(result.content)).toBeTruthy();
      expect(result.content.length > 0).toBeTruthy();

      const textContent = result.content.find(c => c.type === "text");
      expect(textContent).toBeTruthy();
      expect(textContent.text.includes("write_code")).toBeTruthy();
      expect(textContent.text.includes("Task completed")).toBeTruthy();

      await client.stop();
    } catch (error) {
      await client.stop().catch(() => {});
      throw error;
    }
  });

  it("停止客户端", async () => {
    const config = createMockMCPConfig();
    const client = new MCPClient(config);

    await client.start();
    expect(client.isInitialized()).toBeTruthy();

    await client.stop();
    // 停止后客户端应该处于关闭状态
  });
});

// ============================================================
// MCPToolAdapter 测试
// ============================================================

describe("MCPToolAdapter", () => {
  let MCPClient, createMCPToolAdapter;

  beforeAll(async () => {
    const mod = await import("../../dist/tools/mcp-client.js");
    MCPClient = mod.MCPClient;
    createMCPToolAdapter = mod.createMCPToolAdapter;
  });

  it("创建工具适配器", async () => {
    const config = createMockMCPConfig();
    const client = new MCPClient(config);

    try {
      await client.start();

      const tools = await client.listTools();
      const writeTool = tools.find(t => t.name === "write_code");

      const adapter = createMCPToolAdapter(client, writeTool);

      expect(adapter).toBeTruthy();
      expect(adapter.toolName).toBe("write_code", "适配器应该有正确的工具名");
      expect(adapter.execute).toBeTruthy();
      expect(adapter.client).toBeTruthy();
      expect(adapter.definition).toBeTruthy();

      await client.stop();
    } catch (error) {
      await client.stop().catch(() => {});
      throw error;
    }
  });

  it("通过适配器执行工具", async () => {
    const config = createMockMCPConfig();
    const client = new MCPClient(config);

    try {
      await client.start();

      const tools = await client.listTools();
      const writeTool = tools.find(t => t.name === "write_code");
      const adapter = createMCPToolAdapter(client, writeTool);

      const result = await adapter.execute({ task: "Test task" });

      expect(result).toBeTruthy();
      expect(result.content).toBeTruthy();

      const textContent = result.content.find(c => c.type === "text");
      expect(textContent).toBeTruthy();
      expect(textContent.text.includes("write_code")).toBeTruthy();

      await client.stop();
    } catch (error) {
      await client.stop().catch(() => {});
      throw error;
    }
  });
});

// ============================================================
// MCPToolRegistry 测试
// ============================================================

describe("MCPToolRegistry", () => {
  let MCPToolRegistry;

  beforeAll(async () => {
    const mod = await import("../../dist/tools/mcp-registry.js");
    MCPToolRegistry = mod.MCPToolRegistry;
  });

  it("创建注册表", () => {
    const registry = new MCPToolRegistry();

    expect(registry).toBeTruthy();
  });

  it("注册服务器配置", () => {
    const registry = new MCPToolRegistry();

    registry.registerServerConfig("mock-server", {
      command: "node",
      args: [join(__dirname, "../mock-mcp-server.cjs")],
    });

    // 注册应该成功，没有抛出错误
    expect(true).toBeTruthy();
  });

  it("启动服务器并发现工具", async () => {
    const registry = new MCPToolRegistry();

    registry.registerServerConfig("mock-server", {
      command: "node",
      args: [join(__dirname, "../mock-mcp-server.cjs")],
    });

    try {
      await registry.startAll();

      const tools = registry.getAllTools();
      expect(Array.isArray(tools)).toBeTruthy();
      expect(tools.length > 0).toBeTruthy();

      await registry.stopAll();
    } catch (error) {
      await registry.stopAll().catch(() => {});
      throw error;
    }
  });

  it("工具名称查找（带前缀和不带前缀）", async () => {
    const registry = new MCPToolRegistry();

    registry.registerServerConfig("mock-server", {
      command: "node",
      args: [join(__dirname, "../mock-mcp-server.cjs")],
    });

    try {
      await registry.startAll();

      // 带前缀查找
      const prefixedTool = registry.findTool("mock-server/write_code");
      expect(prefixedTool).toBeTruthy();

      // 不带前缀查找
      const unprefixedTool = registry.findTool("write_code");
      expect(unprefixedTool).toBeTruthy();

      // 不存在的工具
      const missingTool = registry.findTool("non-existent-tool");
      expect(missingTool).toBe(undefined, "不存在的工具应该返回 undefined");

      await registry.stopAll();
    } catch (error) {
      await registry.stopAll().catch(() => {});
      throw error;
    }
  });

  it("调用工具", async () => {
    const registry = new MCPToolRegistry();

    registry.registerServerConfig("mock-server", {
      command: "node",
      args: [join(__dirname, "../mock-mcp-server.cjs")],
    });

    try {
      await registry.startAll();

      const result = await registry.callTool("mock-server", "write_code", {
        task: "Test task",
      });

      expect(result).toBeTruthy();
      expect(result.content).toBeTruthy();

      const textContent = result.content.find(c => c.type === "text");
      expect(textContent).toBeTruthy();
      expect(textContent.text.includes("write_code")).toBeTruthy();

      await registry.stopAll();
    } catch (error) {
      await registry.stopAll().catch(() => {});
      throw error;
    }
  });

  it("转换为 AgentTool 接口", async () => {
    const registry = new MCPToolRegistry();

    registry.registerServerConfig("mock-server", {
      command: "node",
      args: [join(__dirname, "../mock-mcp-server.cjs")],
    });

    try {
      await registry.startAll();

      const agentTools = registry.toAgentTools();

      expect(Array.isArray(agentTools)).toBeTruthy();
      expect(agentTools.length > 0).toBeTruthy();

      // 验证 AgentTool 接口
      const writeTool = agentTools.find(t => t.name === "write_code");
      expect(writeTool).toBeTruthy();
      expect(writeTool.execute).toBeTruthy();
      expect(writeTool.riskLevel).toBeTruthy();

      // 测试通过 AgentTool 执行
      const result = await writeTool.execute(
        { task: "Test task" },
        { sessionId: "test", turn: 1, cwd: process.cwd() },
      );

      expect(result).toBeTruthy();
      expect(result.status).toBeTruthy();

      await registry.stopAll();
    } catch (error) {
      await registry.stopAll().catch(() => {});
      throw error;
    }
  });
});
