import type { AgentTool } from "./tool-types.js";

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
}
