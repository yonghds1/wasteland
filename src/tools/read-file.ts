import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import type { AgentTool } from "./tool-types.js";

function resolveReadablePath(cwd: string, value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const targetPath = resolve(cwd, value);
  const relativePath = relative(cwd, targetPath);

  if (relativePath.startsWith("..")) {
    return null;
  }

  return targetPath;
}

export function createReadFileTool(): AgentTool {
  return {
    name: "read-file",
    riskLevel: "read",
    async execute(input, context) {
      const targetPath = resolveReadablePath(context.cwd, input.path);

      if (!targetPath) {
        return {
          status: "error",
          error: "read-file 需要一个位于当前工作目录内的相对路径。",
        };
      }

      try {
        const content = await readFile(targetPath, "utf8");

        return {
          status: "success",
          output: content,
        };
      } catch (error) {
        return {
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
