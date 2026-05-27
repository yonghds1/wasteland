/**
 * test-mcp-mock.ts - MCP 工具注册模拟测试
 *
 * 使用 mock MCP Server 测试注册流程，不需要真实 API key
 */

import { createDefaultToolRegistry } from "./tools/default-registry.js";
import type { MCPServersConfig } from "./config/settings-types.js";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  console.log("=== MCP 工具注册模拟测试 ===\n");

  // Mock MCP Server 路径
  const mockServerPath = resolve(__dirname, "../test/mock-mcp-server.cjs");
  console.log("Mock MCP Server 路径:", mockServerPath, "\n");

  // 1. 定义 MCP Server 配置
  const mcpServers: MCPServersConfig = {
    "mock-coder": {
      command: "node",
      args: [mockServerPath],
      requestTimeout: 10000,
    },
  };

  console.log("Step 1: MCP Server 配置");
  console.log(JSON.stringify(mcpServers, null, 2));
  console.log();

  // 2. 创建工具注册表
  console.log("Step 2: 创建工具注册表...");
  const { toolRegistry, mcpRegistry, startMCP, stopMCP } = createDefaultToolRegistry(mcpServers);

  // 列出内置工具
  const builtinTools = toolRegistry.list();
  console.log("内置工具数量:", builtinTools.length);
  console.log("内置工具示例:", builtinTools.slice(0, 5));
  console.log();

  // 3. 启动 MCP Server
  console.log("Step 3: 启动 MCP Server...");
  try {
    await startMCP();
    console.log("✅ MCP Server 启动成功!\n");
  } catch (error) {
    console.error("❌ MCP Server 启动失败:", error);
    await stopMCP();
    process.exit(1);
  }

  // 4. 列出所有工具（包括 MCP 工具）
  console.log("Step 4: 所有已注册工具:");
  const allTools = toolRegistry.list();
  const mcpTools = allTools.filter(t => t.includes("/"));
  console.log("  内置工具数量:", allTools.length - mcpTools.length);
  console.log("  MCP 工具数量:", mcpTools.length);
  console.log("  MCP 工具列表:", mcpTools);
  console.log();

  // 5. 检查 MCP 工具是否注册
  console.log("Step 5: 检查 MCP 工具注册情况:");
  const coderTool = toolRegistry.get("mock-coder/write_code");
  if (coderTool) {
    console.log("  ✅ mock-coder/write_code 已注册");
    console.log("     工具名称:", coderTool.name);
    console.log("     风险等级:", coderTool.riskLevel);
  } else {
    console.log("  ❌ mock-coder/write_code 未注册");
  }

  const coderToolShort = toolRegistry.get("write_code");
  if (coderToolShort) {
    console.log("  ✅ write_code (无前缀) 已注册");
  } else {
    console.log("  ❌ write_code (无前缀) 未注册");
  }

  const reviewTool = toolRegistry.get("mock-coder/review_code");
  if (reviewTool) {
    console.log("  ✅ mock-coder/review_code 已注册");
  }
  console.log();

  // 6. 查看 MCP Server 信息
  if (mcpRegistry) {
    console.log("Step 6: MCP Server 信息:");
    const servers = mcpRegistry.getServers();
    for (const server of servers) {
      console.log(`  Server: ${server.name}`);
      console.log(`  Started: ${server.started}`);
      console.log(`  Tools: ${server.tools.length}`);
      for (const tool of server.tools) {
        console.log(`    - ${tool.name}: ${tool.description?.slice(0, 40) || "无描述"}`);
      }
    }
    console.log();
  }

  // 7. 测试调用工具
  console.log("Step 7: 测试调用 MCP 工具...");
  if (coderTool) {
    try {
      console.log("  调用 mock-coder/write_code...");
      console.log("  参数: { task: '写一个简单的 TypeScript 函数，计算两个数的和' }");

      const result = await coderTool.execute(
        {
          task: "写一个简单的 TypeScript 函数，计算两个数的和",
        },
        {
          sessionId: "test-session",
          turn: 1,
          cwd: process.cwd(),
        }
      );

      console.log("\n  调用结果:");
      console.log("  Status:", result.status);
      if (result.status === "success") {
        console.log("  Output:");
        console.log("  " + (result.output || "").split("\n").join("\n  "));
      } else {
        console.log("  Error:", result.error);
      }
    } catch (error) {
      console.error("  调用失败:", error);
    }
  }

  // 8. 停止 MCP Server
  console.log("\nStep 8: 停止 MCP Server...");
  await stopMCP();
  console.log("✅ MCP Server 已停止");

  console.log("\n=== 测试完成 ===");
}

main().catch(console.error);
