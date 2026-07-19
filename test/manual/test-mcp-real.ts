/**
 * test-mcp-real.ts - MCP 工具注册真实测试
 *
 * 使用真实的 Claude Code MCP Server 测试注册流程
 */

import { createDefaultToolRegistry } from "./tools/default-registry.js";
import type { MCPServersConfig } from "./config/settings-types.js";

async function main() {
  console.log("=== MCP 工具注册真实测试 (Claude Code) ===\n");

  // 1. 定义 MCP Server 配置 - 使用真实的 Claude Code
  const mcpServers: MCPServersConfig = {
    "claude-code": {
      command: "claude",
      args: ["mcp", "serve"],
      requestTimeout: 60000, // 1 分钟超时
      startupTimeout: 30000, // 30 秒启动超时
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
  console.log("内置工具:", builtinTools);
  console.log();

  // 3. 启动 MCP Server
  console.log("Step 3: 启动 Claude Code MCP Server...");
  console.log("命令: claude mcp serve");
  console.log();

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
  console.log("  MCP 工具列表:");
  for (const tool of mcpTools) {
    console.log(`    - ${tool}`);
  }
  console.log();

  // 5. 查看 MCP Server 信息
  if (mcpRegistry) {
    console.log("Step 5: MCP Server 信息:");
    const servers = mcpRegistry.getServers();
    for (const server of servers) {
      console.log(`  Server: ${server.name}`);
      console.log(`  Started: ${server.started}`);
      console.log(`  Tools: ${server.tools.length}`);
      console.log("  工具详情:");
      for (const tool of server.tools.slice(0, 10)) { // 只显示前 10 个
        console.log(`    - ${tool.name}`);
      }
      if (server.tools.length > 10) {
        console.log(`    ... 还有 ${server.tools.length - 10} 个工具`);
      }
    }
    console.log();
  }

  // 6. 测试调用工具 - 找一个可用的工具
  console.log("Step 6: 测试调用 MCP 工具...");

  // 查找 Read 工具 (注意大小写)
  const readTool = toolRegistry.get("claude-code/Read") || toolRegistry.get("Read");
  if (readTool) {
    try {
      console.log("  找到工具:", readTool.name);
      console.log("  测试读取 package.json...");

      const result = await readTool.execute(
        {
          file_path: "/home/ubuntu/workspace/wasteland/package.json",
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
        console.log("  Output (前 300 字符):");
        console.log("  " + (result.output || "").slice(0, 300).replace(/\n/g, "\n  "));
      } else {
        console.log("  Error:", result.error);
      }
    } catch (error) {
      console.error("  调用失败:", error);
    }
  } else {
    console.log("  未找到 Read 工具");
    console.log("  可用工具:", mcpTools.slice(0, 10));
  }

  // 7. 停止 MCP Server
  console.log("\nStep 7: 停止 MCP Server...");
  await stopMCP();
  console.log("✅ MCP Server 已停止");

  console.log("\n=== 测试完成 ===");
}

main().catch(console.error);
