/**
 * help-skill.ts - 帮助技能
 *
 * 显示系统帮助信息，包括可用命令、工具和技能列表。
 */

import { t } from "../../locales/index.js";
import type {
  Skill,
  SkillArgs,
  SkillExecutionContext,
  SkillResult,
} from "../skill-types.js";

/**
 * /help 技能实现
 */
export const helpSkill: Skill = {
  definition: {
    name: "help",
    description: t("skills.help.description"),
    riskLevel: "read",
    aliases: ["h", "?"],
    category: "system",
    parameters: {
      topic: {
        type: "string",
        description: "帮助主题: commands, tools, skills, all",
        default: "all",
        enum: ["commands", "tools", "skills", "all"],
      },
    },
    examples: [
      "/help",
      "/help commands",
      "/help tools",
      "/help skills",
    ],
  },

  async execute(
    args: SkillArgs,
    context: SkillExecutionContext,
  ): Promise<SkillResult> {
    const topic = (args.named.topic as string) ?? "all";
    const lines: string[] = [];

    lines.push(`# ${t("skills.help.title")}`);
    lines.push("");

    if (topic === "all" || topic === "commands") {
      lines.push(`## ${t("skills.help.commands")}`);
      lines.push("");
      lines.push(`### ${t("skills.help.sessionCommands")}`);
      lines.push(`- \`/help\`, \`/h\`, \`/?\` - ${t("skills.help.showHelp")}`);
      lines.push(`- \`/tools\` - ${t("skills.help.showTools")}`);
      lines.push(`- \`/skills\` - ${t("skills.help.showSkills")}`);
      lines.push(`- \`/clear\` - ${t("skills.help.clearHistory")}`);
      lines.push(`- \`/exit\`, \`/quit\` - ${t("skills.help.exitSession")}`);
      lines.push("");
      lines.push(`### ${t("skills.help.shortcuts")}`);
      lines.push(`- \`Tab\` - ${t("skills.help.switchFocus")}`);
      lines.push(`- \`Enter\` - ${t("skills.help.sendMessage")}`);
      lines.push(`- \`Esc\` - ${t("skills.help.cancelInput")}`);
      lines.push(`- \`Ctrl+C\` - ${t("skills.help.exit")}`);
      lines.push("");
    }

    if (topic === "all" || topic === "tools") {
      lines.push(`## ${t("skills.help.builtInTools")}`);
      lines.push("");
      const toolNames = context.toolRegistry.list();

      // 按风险等级分组
      const readTools: string[] = [];
      const writeTools: string[] = [];
      const executeTools: string[] = [];

      for (const name of toolNames) {
        const tool = context.toolRegistry.get(name);
        if (tool) {
          switch (tool.riskLevel) {
            case "read":
              readTools.push(name);
              break;
            case "write":
              writeTools.push(name);
              break;
            case "execute":
              executeTools.push(name);
              break;
          }
        }
      }

      if (readTools.length > 0) {
        lines.push(`### ${t("skills.help.readOnlyTools")}`);
        for (const name of readTools) {
          lines.push(`- \`${name}\``);
        }
        lines.push("");
      }

      if (writeTools.length > 0) {
        lines.push(`### ${t("skills.help.writeTools")}`);
        for (const name of writeTools) {
          lines.push(`- \`${name}\``);
        }
        lines.push("");
      }

      if (executeTools.length > 0) {
        lines.push(`### ${t("skills.help.executeTools")}`);
        for (const name of executeTools) {
          lines.push(`- \`${name}\``);
        }
        lines.push("");
      }
    }

    if (topic === "all" || topic === "skills") {
      lines.push(`## ${t("skills.help.skillSystem")}`);
      lines.push("");
      lines.push(t("skills.help.skillDescription"));
      lines.push("");
      lines.push(t("skills.help.usage"));
      lines.push("```");
      lines.push("/<技能名> [参数] [选项]");
      lines.push("```");
      lines.push("");
      lines.push(t("skills.help.example"));
      lines.push("```");
      lines.push("/init              # 初始化项目上下文");
      lines.push("/ctx               # 显示项目概览");
      lines.push("/help              # 显示帮助");
      lines.push("```");
      lines.push("");
      lines.push(t("skills.help.runSkillsHint"));
      lines.push("");
    }

    lines.push("---");
    lines.push(`${t("skills.help.currentSession")} ${context.sessionId}`);
    lines.push(`${t("skills.help.workDir")} ${context.cwd}`);

    return {
      status: "success",
      output: lines.join("\n"),
    };
  },
};
