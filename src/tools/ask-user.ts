/**
 * ask-user.ts - 向用户提问工具
 *
 * 允许 Agent 在需要澄清时向用户提问。
 */

import type { AgentTool, ToolRiskLevel, ToolExecutionResult } from "./tool-types.js";

type AskUserInput = {
  question: string;
  options?: string[];
};

export function createAskUserTool(): AgentTool {
  return {
    name: "ask-user",
    riskLevel: "low" as ToolRiskLevel,

    async execute(input: unknown): Promise<ToolExecutionResult> {
      const { question, options } = input as AskUserInput;

      if (!question || typeof question !== "string") {
        return {
          status: "error",
          error: "缺少 question 参数",
        };
      }

      // 在 CLI 模式下，这个问题会被上层拦截处理
      // 这里返回一个标记，让调用方知道需要用户交互
      return {
        status: "success",
        output: options
          ? `${question}\n选项: ${options.join(", ")}`
          : question,
        data: { pendingUserInput: true },
      };
    },
  };
}
