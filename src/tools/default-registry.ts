import { createBashTool } from './bash.js';
import { createEditFileTool } from './edit-file.js';
import { createGlobTool } from './glob.js';
import { createGrepTool } from './grep.js';
import { createListDirectoryTool } from './list-directory.js';
import { ToolRegistry } from './tool-registry.js';
import { createReadFileTool } from './read-file.js';
import { createWebFetchTool } from './web-fetch.js';
import { createWriteFileTool } from './write-file.js';
import { createAskUserTool } from './ask-user.js';
import { createHttpRequestTool } from './http-request.js';
import type { MCPServersConfig } from '../config/settings-types.js';
import { MCPToolRegistry } from './mcp-registry.js';
import { t } from '../locales/index.js';

/**
 * 创建 spawn_agent 的占位工具定义
 *
 * 这是一个"伪工具"，用于向 Provider 声明 spawn_agent 的存在。
 * 实际执行在 dispatchToolCall 中拦截并处理。
 */
function createSpawnAgentPlaceholder() {
  return {
    name: 'spawn_agent',
    riskLevel: 'execute' as const,
    // 这个 execute 永远不会被调用，因为 dispatchToolCall 会拦截
    async execute(): Promise<never> {
      throw new Error(t('mcp.spawnAgentHandled'));
    },
  };
}

/**
 * 创建 MCP 工具的占位定义
 *
 * MCP 工具在运行时动态发现和调用，这里只是占位声明。
 * 实际执行通过 MCPToolRegistry 进行。
 */
function createMCPToolPlaceholder(name: string) {
  return {
    name,
    riskLevel: 'execute' as const,
    async execute(): Promise<never> {
      throw new Error(t('mcp.mcpToolRegistry', { name }));
    },
  };
}

/**
 * 创建工具注册表的结果
 */
export type CreateToolRegistryResult = {
  /** 工具注册表（用于 Provider） */
  toolRegistry: ToolRegistry;
  /** MCP 注册表（用于 MCP 工具调用，可选） */
  mcpRegistry?: MCPToolRegistry;
  /** 启动 MCP 服务器 */
  startMCP: () => Promise<void>;
  /** 停止 MCP 服务器 */
  stopMCP: () => Promise<void>;
};

/**
 * 创建默认工具注册表
 *
 * @param mcpServers - MCP 服务器配置（可选）
 * @returns 包含 ToolRegistry 和 MCP 相关控制的对象
 */
export function createDefaultToolRegistry(mcpServers?: MCPServersConfig): CreateToolRegistryResult {
  // 内置工具（硬编码，安全可靠）
  const builtinTools = [
    createReadFileTool(),
    createGlobTool(),
    createGrepTool(),
    createListDirectoryTool(),
    createWebFetchTool(),
    createBashTool(),
    createEditFileTool(),
    createWriteFileTool(),
    createAskUserTool(),
    createHttpRequestTool(),
    createSpawnAgentPlaceholder(),
  ];

  // 创建 MCP 注册表（如果配置了）
  let mcpRegistry: MCPToolRegistry | undefined;
  let mcpStarted = false;

  if (mcpServers && Object.keys(mcpServers).length > 0) {
    mcpRegistry = new MCPToolRegistry();
    mcpRegistry.registerServersConfigs(mcpServers);

    // 添加 MCP 工具占位符（让 Provider 知道这些工具存在）
    // 注意：实际调用会通过 mcpRegistry 进行
    for (const serverName of Object.keys(mcpServers)) {
      builtinTools.push(createMCPToolPlaceholder(`${serverName}/*`));
    }
  }

  const toolRegistry = new ToolRegistry(builtinTools);

  return {
    toolRegistry,
    mcpRegistry,
    startMCP: async () => {
      if (mcpRegistry && !mcpStarted) {
        await mcpRegistry.startAll();
        mcpStarted = true;

        // 将 MCP 工具动态注册到 ToolRegistry
        const mcpTools = mcpRegistry.toAgentTools();
        for (const tool of mcpTools) {
          toolRegistry.register(tool);
        }
      }
    },
    stopMCP: async () => {
      if (mcpRegistry && mcpStarted) {
        await mcpRegistry.stopAll();
        mcpStarted = false;
      }
    },
  };
}

/**
 * 创建 MCP 工具注册表（独立使用）
 *
 * MCP (Model Context Protocol) 工具通过外部进程通信，
 * 支持动态发现和调用工具。
 *
 * @param mcpServers - MCP 服务器配置
 * @returns MCPToolRegistry 实例（需要手动启动）
 */
export function createMCPRegistry(mcpServers: MCPServersConfig): MCPToolRegistry {
  const registry = new MCPToolRegistry();
  registry.registerServersConfigs(mcpServers);
  return registry;
}
