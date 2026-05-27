/**
 * test-mcp.ts - MCP 工具注册测试
 *
 * 测试流程：
 * 1. 注册 MCP Server (claude-code)
 * 2. 启动 MCP Server
 * 3. 发现工具
 * 4. 调用工具
 */

import { createDefaultToolRegistry } from "./tools/default-registry.js";
import type { MCPServersConfig } from "./config/settings-types.js";

async function main() {
  console.log("=== MCP 工具注册测试 ===\n");

  // 1. 定义 MCP Server 配置
  const mcpServers: MCPServersConfig = {
    "claude-code": {
      command: "claude",
      args: ["--mcp"],
      env: {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || "",
      },
      requestTimeout: 300000,
    },
  };

  console.log("Step 1: MCP Server 配置");
  console.log(JSON.stringify(mcpServers, null, 2));
  console.log();

  // 2. 创建工具注册表
  console.log("Step 2: 创建工具注册表...");
  const { toolRegistry, mcpRegistry, startMCP, stopMCP } = createDefaultToolRegistry(mcpServers);

  // 列出内置工具
  console.log("内置工具:", toolRegistry.list());
  console.log();

  // 3. 启动 MCP Server
  console.log("Step 3: 启动 MCP Server...");
  try {
    await startMCP();
    console.log("MCP Server 启动成功!\n");
  } catch (error) {
    console.error("MCP Server 启动失败:", error);
    process.exit(1);
  }

  // 4. 列出所有工具（包括 MCP 工具）
  console.log("Step 4: 所有已注册工具:");
  const allTools = toolRegistry.list();
  console.log(allTools);
  console.log();

  // 5. 检查 MCP 工具是否注册
  console.log("Step 5: 检查 MCP 工具注册情况:");
  const coderTool = toolRegistry.get("claude-code/write_code");
  if (coderTool) {
    console.log("✅ claude-code/write_code 已注册");
    console.log("   工具名称:", coderTool.name);
    console.log("   风险等级:", coderTool.riskLevel);
  } else {
    console.log("❌ claude-code/write_code 未注册");
  }

  // 检查无前缀版本
  const coderToolShort = toolRegistry.get("write_code");
  if (coderToolShort) {
    console.log("✅ write_code (无前缀) 已注册");
  } else {
    console.log("❌ write_code (无前缀) 未注册");
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
        console.log(`    - ${tool.name}: ${tool.description?.slice(0, 50) || "无描述"}`);
      }
    }
    console.log();
  }

  // 7. 测试调用工具
  console.log("Step 7: 测试调用 MCP 工具...");
  if (coderTool) {
    try {
      console.log("调用 claude-code/write_code...");
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

      console.log("\n调用结果:");
      console.log("Status:", result.status);
      if (result.status === "success") {
        console.log("Output:", result.output?.slice(0, 500));
      } else {
        console.log("Error:", result.error);
      }
    } catch (error) {
      console.error("调用失败:", error);
    }
  }

  // 8. 停止 MCP Server
  console.log("\nStep 8: 停止 MCP Server...");
  await stopMCP();
  console.log("MCP Server 已停止");

  console.log("\n=== 测试完成 ===");
}

main().catch(console.error);
