import type { AgentTool } from './tool-types.js';

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  constructor(tools: AgentTool[] = []) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  get(toolName: string): AgentTool | undefined {
    return this.tools.get(toolName);
  }

  /** 列出所有已注册的工具名称 */
  list(): string[] {
    return Array.from(this.tools.keys());
  }

  /** 动态注销单个工具 */
  unregister(toolName: string): boolean {
    return this.tools.delete(toolName);
  }

  /** 根据名称前缀动态注销一组工具（如 "serverName/"） */
  unregisterByPrefix(prefix: string): string[] {
    const removed: string[] = [];
    for (const name of this.tools.keys()) {
      if (name.startsWith(prefix)) {
        this.tools.delete(name);
        removed.push(name);
      }
    }
    return removed;
  }

  /** 动态热替换指定 MCP Server 的全部工具 */
  replaceServerTools(serverName: string, newTools: AgentTool[]): void {
    this.unregisterByPrefix(`${serverName}/`);
    for (const tool of newTools) {
      this.register(tool);
    }
  }

  /** 获取所有工具实例列表 */
  getAll(): AgentTool[] {
    return Array.from(this.tools.values());
  }
}
