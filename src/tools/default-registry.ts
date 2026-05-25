import { createBashTool } from "./bash.js";
import { createEditFileTool } from "./edit-file.js";
import { createGlobTool } from "./glob.js";
import { createGrepTool } from "./grep.js";
import { createListDirectoryTool } from "./list-directory.js";
import { ToolRegistry } from "./tool-registry.js";
import { createReadFileTool } from "./read-file.js";
import { createWebFetchTool } from "./web-fetch.js";
import { createWriteFileTool } from "./write-file.js";

/**
 * 创建 spawn_agent 的占位工具定义
 *
 * 这是一个"伪工具"，用于向 Provider 声明 spawn_agent 的存在。
 * 实际执行在 dispatchToolCall 中拦截并处理。
 */
function createSpawnAgentPlaceholder() {
  return {
    name: "spawn_agent",
    riskLevel: "execute" as const,
    // 这个 execute 永远不会被调用，因为 dispatchToolCall 会拦截
    async execute(): Promise<never> {
      throw new Error("spawn_agent should be handled by dispatchToolCall");
    },
  };
}

export function createDefaultToolRegistry(): ToolRegistry {
  return new ToolRegistry([
    createReadFileTool(),
    createGlobTool(),
    createGrepTool(),
    createListDirectoryTool(),
    createWebFetchTool(),
    createBashTool(),
    createEditFileTool(),
    createWriteFileTool(),
    createSpawnAgentPlaceholder(),
  ]);
}
