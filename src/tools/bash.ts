import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { AgentTool } from "./tool-types.js";

const execFileAsync = promisify(execFile);

export function createBashTool(): AgentTool {
  return {
    name: "bash",
    riskLevel: "execute",
    async execute(input, context) {
      const command = typeof input.command === "string" ? input.command.trim() : "";

      if (command.length === 0) {
        return {
          status: "error",
          error: "bash 工具需要非空 command 字段。",
        };
      }

      try {
        const { stdout, stderr } = await execFileAsync("bash", ["-lc", command], {
          cwd: context.cwd,
        });
        const output = [stdout, stderr].filter((value) => value.length > 0).join("");

        return {
          status: "success",
          output: output.trimEnd(),
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
