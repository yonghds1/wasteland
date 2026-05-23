import { createBashTool } from "./bash.js";
import { ToolRegistry } from "./tool-registry.js";
import { createReadFileTool } from "./read-file.js";

export function createDefaultToolRegistry(): ToolRegistry {
  return new ToolRegistry([createReadFileTool(), createBashTool()]);
}
