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
}
