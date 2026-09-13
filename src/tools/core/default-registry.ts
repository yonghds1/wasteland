import { createBashTool } from '../sys/bash.js';
import { createEditFileTool } from '../fs/edit-file.js';
import { createGlobTool } from '../fs/glob.js';
import { createGrepTool } from '../sys/grep.js';
import { createGitTool } from '../sys/git.js';
import { createListDirectoryTool } from '../fs/list-directory.js';
import { ToolRegistry } from './tool-registry.js';
import { createReadFileTool } from '../fs/read-file.js';
import { createWebFetchTool } from '../web/web-fetch.js';
import { createWebSearchTool } from '../web/web-search.js';
import { createWriteFileTool } from '../fs/write-file.js';
import { createAskUserTool } from '../interaction/ask-user.js';
import { createA2AAgentTool } from '../agent/a2a-agent-tool.js';
import { createAcpAgentTool } from '../agent/acp-agent-tool.js';
import { createTuiUpdatePanelTool } from '../interaction/tui-update-panel.js';
import {
  createTaskCreateTool,
  createTaskUpdateTool,
  createTaskListTool,
  createTaskGetTool,
} from '../agent/task-tools.js';
import type { A2ASettings, ACPSettings, MCPServersConfig } from '@config/settings-types.js';
import { MCPToolRegistry } from '../mcp/mcp-registry.js';
import { t } from '@locales/index.js';
import { SPAWN_AGENT_DESCRIPTION, SPAWN_AGENT_INPUT_SCHEMA_JSON } from '@tools/agent/spawn-agent/index.js';

/**
 * 创建 spawn_agent 的占位工具定义
 *
 * 这是一个"伪工具"，用于向 Provider 声明 spawn_agent 的存在。
 * 实际执行在 dispatchToolCall 中拦截并处理。
 *
 * 注：A2A 已重设计为直接工具（a2a_<name>），spawn_agent 不再被 A2A 覆盖，
 * 始终保持本地占位工具。
 */
function createSpawnAgentPlaceholder() {
  return {
    name: 'spawn_agent',
    riskLevel: 'read' as const,
    // 向 Provider 声明 spawn_agent 的参数契约（与实际工具共享同一 schema/description，
    // 避免模型看到空 schema 而不知道如何调用）。实际执行在 dispatchToolCall 中拦截。
    description: SPAWN_AGENT_DESCRIPTION,
    inputSchema: SPAWN_AGENT_INPUT_SCHEMA_JSON,
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
 * createDefaultToolRegistry 的选项对象
 *
 * 旧版使用 4 个位置参数（mcpServers / a2aAgents / a2aServers / agentConfigs），
 * 存在类型漂移。现统一为选项对象签名。
 */
export type CreateToolRegistryOptions = {
  /** MCP 服务器配置（可选） */
  mcpServers?: MCPServersConfig;
  /**
   * A2A 顶层配置块（可选）
   *
   * - `agents`：每个远程 agent 注册为直接工具 `a2a_<name>`。
   * - `servers`：本机托管的 A2A server，由 initialize-runtime 起进程，
   *   不注册为工具（此处忽略）。
   */
  a2a?: A2ASettings;
  /**
   * ACP 顶层配置块（可选）
   *
   * - `agents`：每个 stdio agent 注册为直接工具 `acp_<name>`（与 a2a_<name> 并存过渡）。
   * - `defaults.timeoutMs`：单次任务超时，透传给工具。
   */
  acp?: ACPSettings;
};

/**
 * 创建默认工具注册表
 *
 * @param options - 选项对象（mcpServers / a2a / acp）
 * @returns 包含 ToolRegistry 和 MCP 相关控制的对象
 */
export function createDefaultToolRegistry(
  options: CreateToolRegistryOptions = {}
): CreateToolRegistryResult {
  const { mcpServers, a2a, acp } = options;

  // 内置工具（硬编码，安全可靠）
  const builtinTools = [
    createReadFileTool(),
    createGlobTool(),
    createGrepTool(),
    createListDirectoryTool(),
    createWebFetchTool(),
    createWebSearchTool(),
    createBashTool(),
    createEditFileTool(),
    createWriteFileTool(),
    createAskUserTool(),
    createGitTool(),
    createSpawnAgentPlaceholder(),
    createTuiUpdatePanelTool(),
    // 任务管理工具
    createTaskCreateTool(),
    createTaskUpdateTool(),
    createTaskListTool(),
    createTaskGetTool(),
  ];

  // A2A 远程 agent → 直接工具（a2a_<name>）
  // single / multi 模式统一机制：主 agent 与子 agent（经继承）都能调用。
  // 注：a2a.servers 是"本机托管"职责（initialize-runtime 起进程），与工具无关，
  // 这里只消费 a2a.agents。
  for (const agent of a2a?.agents ?? []) {
    builtinTools.push(createA2AAgentTool(agent));
  }

  // ACP stdio agent → 直接工具（acp_<name>）
  // 与 a2a_<name> 并存过渡期：两套前缀互不重叠，各自配置驱动注册。
  for (const agent of acp?.agents ?? []) {
    builtinTools.push(createAcpAgentTool(agent, agent.timeoutMs ?? acp?.defaults?.timeoutMs));
  }

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
