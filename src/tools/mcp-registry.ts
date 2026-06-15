/**
 * mcp-registry.ts - MCP 工具注册表
 *
 * 管理多个 MCP Server 连接，并将它们的工具暴露为统一的 AgentTool 接口。
 *
 * ## 功能
 *
 * - 启动/停止多个 MCP Server
 * - 自动发现每个 server 的工具列表
 * - 将 MCP 工具包装为 AgentTool
 * - 支持工具名冲突处理（添加 server 前缀）
 *
 * ## 配置示例
 *
 * ```json
 * {
 *   "mcpServers": {
 *     "coder": {
 *       "command": "claude",
 *       "args": ["--mcp"]
 *     },
 *     "reviewer": {
 *       "command": "codex",
 *       "args": ["--mcp"]
 *     }
 *   }
 * }
 * ```
 *
 * ## 使用示例
 *
 * ```typescript
 * const registry = new MCPToolRegistry();
 *
 * // 注册 MCP servers
 * await registry.registerServer("coder", {
 *   command: "claude",
 *   args: ["--mcp"]
 * });
 *
 * // 获取所有工具
 * const tools = registry.getAllTools();
 *
 * // 调用工具
 * const result = await registry.callTool("coder", "write_code", { task: "..." });
 * ```
 */

import type {
  AgentTool,
  JsonSchema,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolInput,
} from './tool-types.js';
import {
  MCPClient,
  type MCPToolDefinition,
  type MCPToolResult,
  type MCPServerConfig,
} from './mcp-client.js';
import { t } from '../locales/index.js';

// ============================================================
// 类型定义
// ============================================================

/**
 * MCP 服务器配置映射
 */
export type MCPServersConfig = Record<string, MCPServerConfig>;

/**
 * 已注册的 MCP 服务器信息
 */
export type RegisteredServer = {
  /** 服务器名称 */
  name: string;
  /** MCP 客户端 */
  client: MCPClient;
  /** 工具列表 */
  tools: MCPToolDefinition[];
  /** 是否已启动 */
  started: boolean;
};

/**
 * 工具查找结果
 */
export type ToolLookup = {
  /** 服务器名称 */
  serverName: string;
  /** 工具定义 */
  tool: MCPToolDefinition;
};

// ============================================================
// MCP 工具注册表
// ============================================================

/**
 * MCP 工具注册表
 *
 * 管理多个 MCP Server 连接，提供统一的工具访问接口。
 */
export class MCPToolRegistry {
  private servers: Map<string, RegisteredServer> = new Map();
  private toolIndex: Map<string, ToolLookup> = new Map();

  /**
   * 注册 MCP 服务器配置
   *
   * 注意：这只是记录配置，不会立即启动。
   * 调用 startServer() 或 startAll() 来启动。
   */
  registerServerConfig(name: string, config: MCPServerConfig): void {
    if (this.servers.has(name)) {
      throw new Error(t('mcp.serverAlreadyRegistered', { name }));
    }

    const client = new MCPClient({ name, server: config });

    this.servers.set(name, {
      name,
      client,
      tools: [],
      started: false,
    });
  }

  /**
   * 批量注册 MCP 服务器配置
   */
  registerServersConfigs(configs: MCPServersConfig): void {
    for (const [name, config] of Object.entries(configs)) {
      this.registerServerConfig(name, config);
    }
  }

  /**
   * 启动单个 MCP 服务器
   */
  async startServer(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) {
      throw new Error(t('mcp.serverNotFound', { name }));
    }

    if (server.started) {
      return;
    }

    // 启动客户端
    const initResult = await server.client.start();
    console.log(
      t('mcp.serverStarted', {
        name,
        serverInfo: initResult.serverInfo.name,
        version: initResult.serverInfo.version,
      })
    );

    // 获取工具列表
    if (initResult.capabilities.tools?.supported !== false) {
      const tools = await server.client.listTools();
      server.tools = tools;

      // 索引工具（使用 server 前缀避免冲突）
      for (const tool of tools) {
        const fullName = `${name}/${tool.name}`;
        this.toolIndex.set(fullName, { serverName: name, tool });

        // 也注册无前缀版本（如果不存在冲突）
        if (!this.toolIndex.has(tool.name)) {
          this.toolIndex.set(tool.name, { serverName: name, tool });
        }
      }

      console.log(t('mcp.serverHasTools', { name, count: String(tools.length) }));
    }

    server.started = true;
  }

  /**
   * 启动所有已注册的 MCP 服务器
   */
  async startAll(): Promise<void> {
    const errors: Array<{ name: string; error: Error }> = [];

    for (const [name] of this.servers) {
      try {
        await this.startServer(name);
      } catch (error) {
        errors.push({
          name,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    if (errors.length > 0) {
      console.warn(
        t('mcp.serversFailed'),
        errors.map((e) => `${e.name}: ${e.error.message}`).join(', ')
      );
    }
  }

  /**
   * 停止单个 MCP 服务器
   */
  async stopServer(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) {
      return;
    }

    // 移除工具索引
    for (const tool of server.tools) {
      this.toolIndex.delete(`${name}/${tool.name}`);
      this.toolIndex.delete(tool.name);
    }

    // 停止客户端
    await server.client.stop();
    server.tools = [];
    server.started = false;
  }

  /**
   * 停止所有 MCP 服务器
   */
  async stopAll(): Promise<void> {
    const stopPromises: Promise<void>[] = [];

    for (const [name] of this.servers) {
      stopPromises.push(this.stopServer(name));
    }

    await Promise.all(stopPromises);
  }

  /**
   * 获取所有工具定义
   */
  getAllTools(): Array<{ serverName: string; tool: MCPToolDefinition }> {
    const result: Array<{ serverName: string; tool: MCPToolDefinition }> = [];

    for (const [name, server] of this.servers) {
      for (const tool of server.tools) {
        result.push({ serverName: name, tool });
      }
    }

    return result;
  }

  /**
   * 查找工具
   */
  findTool(toolName: string): ToolLookup | undefined {
    return this.toolIndex.get(toolName);
  }

  /**
   * 调用工具
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<MCPToolResult> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(t('mcp.serverNotFound', { name: serverName }));
    }

    if (!server.started) {
      throw new Error(t('mcp.serverNotStarted', { name: serverName }));
    }

    return server.client.callTool(toolName, args);
  }

  /**
   * 获取已注册的服务器列表
   */
  getServers(): RegisteredServer[] {
    return Array.from(this.servers.values());
  }

  /**
   * 将 MCP 工具转换为 AgentTool 接口
   *
   * 这允许 MCP 工具与现有的 ToolRegistry 集成。
   * MCP Server 返回的 inputSchema 会直接传递给 AgentTool。
   */
  toAgentTools(): AgentTool[] {
    const tools: AgentTool[] = [];

    for (const [fullName, lookup] of this.toolIndex) {
      const server = this.servers.get(lookup.serverName);
      if (!server || !server.started) {
        continue;
      }

      const tool: AgentTool = {
        name: fullName,
        riskLevel: 'execute', // MCP 工具默认为执行级别
        description: lookup.tool.description,
        inputSchema: lookup.tool.inputSchema as JsonSchema,
        async execute(
          input: ToolInput,
          _context: ToolExecutionContext
        ): Promise<ToolExecutionResult> {
          try {
            const result = await server.client.callTool(lookup.tool.name, input);

            // 提取文本内容
            const textContent = result.content
              .filter((c) => c.type === 'text')
              .map((c) => c.text ?? '')
              .join('\n');

            if (result.isError) {
              return {
                status: 'error',
                error: textContent || 'MCP tool returned error',
              };
            }

            return {
              status: 'success',
              output: textContent,
              data: result,
            };
          } catch (error) {
            return {
              status: 'error',
              error: error instanceof Error ? error.message : String(error),
            };
          }
        },
      };

      tools.push(tool);
    }

    return tools;
  }
}

// ============================================================
// 便捷函数
// ============================================================

/**
 * 从配置创建 MCP 工具注册表
 */
export async function createMCPRegistry(
  configs: MCPServersConfig,
  autoStart = true
): Promise<MCPToolRegistry> {
  const registry = new MCPToolRegistry();
  registry.registerServersConfigs(configs);

  if (autoStart) {
    await registry.startAll();
  }

  return registry;
}
