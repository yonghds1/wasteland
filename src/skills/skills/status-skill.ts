/**
 * status-skill.ts - 状态查询技能
 *
 * 显示当前会话状态、配置和统计信息。
 */

import { t } from "../../locales/index.js";
import type {
  Skill,
  SkillArgs,
  SkillExecutionContext,
  SkillResult,
} from "../skill-types.js";

/**
 * /status 技能实现
 */
export const statusSkill: Skill = {
  definition: {
    name: "status",
    description: t("skills.status.description"),
    riskLevel: "read",
    aliases: ["stat", "info"],
    category: "system",
    parameters: {
      format: {
        type: "string",
        description: "输出格式: simple, detailed, json",
        default: "simple",
        enum: ["simple", "detailed", "json"],
      },
    },
    examples: [
      "/status",
      "/status --format detailed",
      "/stat",
    ],
  },

  async execute(
    args: SkillArgs,
    context: SkillExecutionContext,
  ): Promise<SkillResult> {
    const format = (args.named.format as string) ?? "simple";

    if (format === "json") {
      return {
        status: "success",
        output: JSON.stringify({
          sessionId: context.sessionId,
          turn: context.turn,
          cwd: context.cwd,
          historyLength: context.history.length,
          toolCount: context.toolRegistry.list().length,
        }, null, 2),
      };
    }

    const lines: string[] = [];

    if (format === "simple") {
      lines.push(`${t("skills.status.session")} ${context.sessionId}`);
      lines.push(`${t("skills.status.turn")} ${context.turn}`);
      lines.push(`${t("skills.status.history")} ${context.history.length} 条消息`);
      lines.push(`${t("skills.status.tools")} ${context.toolRegistry.list().length} 个可用`);
      lines.push(`${t("skills.status.directory")} ${context.cwd}`);
    } else {
      // detailed
      lines.push(`# ${t("skills.status.title")}`);
      lines.push("");
      lines.push(`## ${t("skills.status.basicInfo")}`);
      lines.push(`- ${t("skills.status.sessionId")} \`${context.sessionId}\``);
      lines.push(`- ${t("skills.status.currentTurn")} ${context.turn}`);
      lines.push(`- ${t("skills.status.workDir")} \`${context.cwd}\``);
      lines.push("");

      // 历史统计
      lines.push(`## ${t("skills.status.messageHistory")}`);
      const userMsgs = context.history.filter(m => m.role === "user").length;
      const assistantMsgs = context.history.filter(m => m.role === "assistant").length;
      lines.push(`- ${t("skills.status.userMessages")} ${userMsgs} 条`);
      lines.push(`- ${t("skills.status.assistantMessages")} ${assistantMsgs} 条`);
      lines.push(`- ${t("skills.status.total")} ${context.history.length} 条`);
      lines.push("");

      // 工具状态
      lines.push(`## ${t("skills.status.toolStatus")}`);
      const toolNames = context.toolRegistry.list();
      const byRisk = new Map<string, number>();

      for (const name of toolNames) {
        const tool = context.toolRegistry.get(name);
        if (tool) {
          const count = byRisk.get(tool.riskLevel) ?? 0;
          byRisk.set(tool.riskLevel, count + 1);
        }
      }

      for (const [level, count] of byRisk) {
        lines.push(`- ${level} 级工具: ${count} 个`);
      }
      lines.push("");

      // 权限模式
      lines.push(`## ${t("skills.status.permissionSettings")}`);
      lines.push(`- ${t("skills.status.mode")} ${context.session.mode}`);
    }

    return {
      status: "success",
      output: lines.join("\n"),
    };
  },
};
