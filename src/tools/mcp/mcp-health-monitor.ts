import { EventEmitter } from 'node:events';
import type { MCPToolRegistry, RegisteredServer } from './mcp-registry.js';
import { Logger } from '@core/logger/index.js';

export type McpServerStatus = 'connected' | 'connecting' | 'stopped' | 'error';

export interface McpServerHealthInfo {
  name: string;
  type: 'stdio' | 'sse';
  status: McpServerStatus;
  toolsCount: number;
  toolNames: string[];
  error?: string;
  target?: string;
}

/**
 * McpHealthMonitor - MCP 服务器健康与探针状态监视器
 */
export class McpHealthMonitor extends EventEmitter {
  private readonly registry: MCPToolRegistry;
  private serverErrors = new Map<string, string>();

  constructor(registry: MCPToolRegistry) {
    super();
    this.registry = registry;
  }

  recordError(serverName: string, error: string): void {
    this.serverErrors.set(serverName, error);
    this.emit('statusChanged', serverName, 'error');
  }

  clearError(serverName: string): void {
    this.serverErrors.delete(serverName);
  }

  /**
   * 获取所有 MCP Server 的当前健康与状态信息
   */
  getHealthReport(): McpServerHealthInfo[] {
    const servers = this.registry.getServers();
    return servers.map((srv: RegisteredServer) => {
      const err = this.serverErrors.get(srv.name);
      let status: McpServerStatus = 'stopped';
      if (err) {
        status = 'error';
      } else if (srv.started) {
        status = 'connected';
      }

      const clientConfig = (srv.client as unknown as { serverConfig?: { command?: string; url?: string } })
        .serverConfig;
      const target = clientConfig?.url ?? clientConfig?.command ?? 'unknown';
      const type: 'stdio' | 'sse' = clientConfig?.url ? 'sse' : 'stdio';

      return {
        name: srv.name,
        type,
        status,
        toolsCount: srv.tools.length,
        toolNames: srv.tools.map((t) => t.name),
        error: err,
        target,
      };
    });
  }

  /**
   * 诊断并尝试 Ping/保活所有已启动的 MCP 客户端
   */
  async pingAll(): Promise<Record<string, boolean>> {
    const clients = this.registry.getStartedClients();
    const results: Record<string, boolean> = {};

    for (const [name, client] of clients) {
      try {
        await client.listTools();
        results[name] = true;
        this.clearError(name);
      } catch (e) {
        results[name] = false;
        const msg = e instanceof Error ? e.message : String(e);
        this.recordError(name, msg);
        Logger.warn({
          sessionId: 'unknown',
          scope: 'mcp',
          message: 'mcp.ping_failed',
          data: { serverName: name, error: msg },
        });
      }
    }

    return results;
  }
}
