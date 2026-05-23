import { createBashTool } from "./bash.js";
import { createEditFileTool } from "./edit-file.js";
import { ToolRegistry } from "./tool-registry.js";
import { createReadFileTool } from "./read-file.js";
import { createWriteFileTool } from "./write-file.js";

export function createDefaultToolRegistry(): ToolRegistry {
  return new ToolRegistry([
    createReadFileTool(),
    createBashTool(),
    createEditFileTool(),
    createWriteFileTool(),
  ]);
}
