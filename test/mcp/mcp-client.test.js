/**
 * mcp-client.test.js - MCP Client 单元测试
 *
 * 测试 MCP 客户端的 JSON-RPC 通信、工具发现和调用功能。
 */

import assert from "node:assert/strict";
import { test, describe, before, after } from "node:test";
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

  before(async () => {
    const mod = await import("../../dist/tools/mcp-client.js");
    MCPClient = mod.MCPClient;
  });

  test("创建客户端实例", () => {
    const config = createMockMCPConfig();
    const client = new MCPClient(config);

    assert.ok(client, "应该创建客户端实例");
    assert.equal(client.isInitialized(), false, "初始状态应该是未初始化");
  });

  test("启动和初始化", async () => {
    const config = createMockMCPConfig();
    const client = new MCPClient(config);

    try {
      await client.start();

      assert.ok(client.isInitialized(), "启动后应该是已初始化状态");

      const capabilities = client.getCapabilities();
      assert.ok(capabilities, "应该有服务器能力信息");
      assert.ok(capabilities.tools, "服务器应该支持工具");

      await client.stop();
    } catch (error) {
      await client.stop().catch(() => {});
      throw error;
    }
  });

  test("列出工具", async () => {
    const config = createMockMCPConfig();
    const client = new MCPClient(config);

    try {
      await client.start();

      const tools = await client.listTools();

      assert.ok(Array.isArray(tools), "应该返回工具数组");
      assert.ok(tools.length > 0, "应该有至少一个工具");

      // 验证 write_code 工具
      const writeTool = tools.find(t => t.name === "write_code");
      assert.ok(writeTool, "应该有 write_code 工具");
      assert.ok(writeTool.description, "工具应该有描述");
      assert.ok(writeTool.inputSchema, "工具应该有输入 schema");

      // 验证 review_code 工具
      const reviewTool = tools.find(t => t.name === "review_code");
      assert.ok(reviewTool, "应该有 review_code 工具");

      await client.stop();
    } catch (error) {
      await client.stop().catch(() => {});
      throw error;
    }
  });

  test("调用工具", async () => {
    const config = createMockMCPConfig();
    const client = new MCPClient(config);

    try {
      await client.start();

      const result = await client.callTool("write_code", {
        task: "Create a hello world function",
      });

      assert.ok(result, "应该有返回结果");
      assert.ok(result.content, "结果应该有 content 字段");
      assert.ok(Array.isArray(result.content), "content 应该是数组");
      assert.ok(result.content.length > 0, "content 应该有内容");

      const textContent = result.content.find(c => c.type === "text");
      assert.ok(textContent, "应该有文本内容");
      assert.ok(textContent.text.includes("write_code"), "响应应该包含工具名称");
      assert.ok(textContent.text.includes("Task completed"), "响应应该包含完成信息");

      await client.stop();
    } catch (error) {
      await client.stop().catch(() => {});
      throw error;
    }
  });

  test("停止客户端", async () => {
    const config = createMockMCPConfig();
    const client = new MCPClient(config);

    await client.start();
    assert.ok(client.isInitialized(), "启动后应该初始化");

    await client.stop();
    // 停止后客户端应该处于关闭状态
  });
});

// ============================================================
// MCPToolAdapter 测试
// ============================================================

describe("MCPToolAdapter", () => {
  let MCPClient, createMCPToolAdapter;

  before(async () => {
    const mod = await import("../../dist/tools/mcp-client.js");
    MCPClient = mod.MCPClient;
    createMCPToolAdapter = mod.createMCPToolAdapter;
  });

  test("创建工具适配器", async () => {
    const config = createMockMCPConfig();
    const client = new MCPClient(config);

    try {
      await client.start();

      const tools = await client.listTools();
      const writeTool = tools.find(t => t.name === "write_code");

      const adapter = createMCPToolAdapter(client, writeTool);

      assert.ok(adapter, "应该创建适配器");
      assert.equal(adapter.toolName, "write_code", "适配器应该有正确的工具名");
      assert.ok(adapter.execute, "适配器应该有 execute 方法");
      assert.ok(adapter.client, "适配器应该有 client 引用");
      assert.ok(adapter.definition, "适配器应该有工具定义");

      await client.stop();
    } catch (error) {
      await client.stop().catch(() => {});
      throw error;
    }
  });

  test("通过适配器执行工具", async () => {
    const config = createMockMCPConfig();
    const client = new MCPClient(config);

    try {
      await client.start();

      const tools = await client.listTools();
      const writeTool = tools.find(t => t.name === "write_code");
      const adapter = createMCPToolAdapter(client, writeTool);

      const result = await adapter.execute({ task: "Test task" });

      assert.ok(result, "应该有执行结果");
      assert.ok(result.content, "结果应该有 content 字段");

      const textContent = result.content.find(c => c.type === "text");
      assert.ok(textContent, "应该有文本内容");
      assert.ok(textContent.text.includes("write_code"), "响应应该包含工具名称");

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

  before(async () => {
    const mod = await import("../../dist/tools/mcp-registry.js");
    MCPToolRegistry = mod.MCPToolRegistry;
  });

  test("创建注册表", () => {
    const registry = new MCPToolRegistry();

    assert.ok(registry, "应该创建注册表实例");
  });

  test("注册服务器配置", () => {
    const registry = new MCPToolRegistry();

    registry.registerServerConfig("mock-server", {
      command: "node",
      args: [join(__dirname, "../mock-mcp-server.cjs")],
    });

    // 注册应该成功，没有抛出错误
    assert.ok(true, "注册服务器配置应该成功");
  });

  test("启动服务器并发现工具", async () => {
    const registry = new MCPToolRegistry();

    registry.registerServerConfig("mock-server", {
      command: "node",
      args: [join(__dirname, "../mock-mcp-server.cjs")],
    });

    try {
      await registry.startAll();

      const tools = registry.getAllTools();
      assert.ok(Array.isArray(tools), "应该返回工具数组");
      assert.ok(tools.length > 0, "应该有至少一个工具");

      await registry.stopAll();
    } catch (error) {
      await registry.stopAll().catch(() => {});
      throw error;
    }
  });

  test("工具名称查找（带前缀和不带前缀）", async () => {
    const registry = new MCPToolRegistry();

    registry.registerServerConfig("mock-server", {
      command: "node",
      args: [join(__dirname, "../mock-mcp-server.cjs")],
    });

    try {
      await registry.startAll();

      // 带前缀查找
      const prefixedTool = registry.findTool("mock-server/write_code");
      assert.ok(prefixedTool, "应该通过带前缀名称找到工具");

      // 不带前缀查找
      const unprefixedTool = registry.findTool("write_code");
      assert.ok(unprefixedTool, "应该通过不带前缀名称找到工具");

      // 不存在的工具
      const missingTool = registry.findTool("non-existent-tool");
      assert.equal(missingTool, undefined, "不存在的工具应该返回 undefined");

      await registry.stopAll();
    } catch (error) {
      await registry.stopAll().catch(() => {});
      throw error;
    }
  });

  test("调用工具", async () => {
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

      assert.ok(result, "应该有返回结果");
      assert.ok(result.content, "结果应该有 content 字段");

      const textContent = result.content.find(c => c.type === "text");
      assert.ok(textContent, "应该有文本内容");
      assert.ok(textContent.text.includes("write_code"), "响应应该包含工具名称");

      await registry.stopAll();
    } catch (error) {
      await registry.stopAll().catch(() => {});
      throw error;
    }
  });

  test("转换为 AgentTool 接口", async () => {
    const registry = new MCPToolRegistry();

    registry.registerServerConfig("mock-server", {
      command: "node",
      args: [join(__dirname, "../mock-mcp-server.cjs")],
    });

    try {
      await registry.startAll();

      const agentTools = registry.toAgentTools();

      assert.ok(Array.isArray(agentTools), "应该返回 AgentTool 数组");
      assert.ok(agentTools.length > 0, "应该有至少一个 AgentTool");

      // 验证 AgentTool 接口
      const writeTool = agentTools.find(t => t.name === "write_code");
      assert.ok(writeTool, "应该有 write_code 工具");
      assert.ok(writeTool.execute, "工具应该有 execute 方法");
      assert.ok(writeTool.riskLevel, "工具应该有 riskLevel");

      // 测试通过 AgentTool 执行
      const result = await writeTool.execute(
        { task: "Test task" },
        { sessionId: "test", turn: 1, cwd: process.cwd() },
      );

      assert.ok(result, "应该有执行结果");
      assert.ok(result.status, "应该有状态");

      await registry.stopAll();
    } catch (error) {
      await registry.stopAll().catch(() => {});
      throw error;
    }
  });
});
