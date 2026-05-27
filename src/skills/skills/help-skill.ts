/**
 * help-skill.ts - 帮助技能
 *
 * 显示系统帮助信息，包括可用命令、工具和技能列表。
 */

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
    description: "显示帮助信息和可用命令列表",
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

    lines.push("# RxCLI 帮助");
    lines.push("");

    if (topic === "all" || topic === "commands") {
      lines.push("## 可用命令");
      lines.push("");
      lines.push("### 会话命令");
      lines.push("- `/help`, `/h`, `/?` - 显示帮助");
      lines.push("- `/tools` - 显示可用工具列表");
      lines.push("- `/skills` - 显示可用技能列表");
      lines.push("- `/clear` - 清除会话历史");
      lines.push("- `/exit`, `/quit` - 退出交互模式");
      lines.push("");
      lines.push("### 快捷键");
      lines.push("- `Tab` - 切换焦点区域");
      lines.push("- `Enter` - 发送消息");
      lines.push("- `Esc` - 取消输入/返回");
      lines.push("- `Ctrl+C` - 退出");
      lines.push("");
    }

    if (topic === "all" || topic === "tools") {
      lines.push("## 内置工具");
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
        lines.push("### 只读工具");
        for (const name of readTools) {
          lines.push(`- \`${name}\``);
        }
        lines.push("");
      }

      if (writeTools.length > 0) {
        lines.push("### 写入工具");
        for (const name of writeTools) {
          lines.push(`- \`${name}\``);
        }
        lines.push("");
      }

      if (executeTools.length > 0) {
        lines.push("### 执行工具");
        for (const name of executeTools) {
          lines.push(`- \`${name}\``);
        }
        lines.push("");
      }
    }

    if (topic === "all" || topic === "skills") {
      lines.push("## 技能系统");
      lines.push("");
      lines.push("技能是高级工作流，可以编排多个工具调用。");
      lines.push("");
      lines.push("使用方法:");
      lines.push("```");
      lines.push("/<技能名> [参数] [选项]");
      lines.push("```");
      lines.push("");
      lines.push("示例:");
      lines.push("```");
      lines.push("/init              # 初始化项目上下文");
      lines.push("/ctx               # 显示项目概览");
      lines.push("/help              # 显示帮助");
      lines.push("```");
      lines.push("");
      lines.push("运行 `/skills` 查看所有可用技能。");
      lines.push("");
    }

    lines.push("---");
    lines.push(`当前会话: ${context.sessionId}`);
    lines.push(`工作目录: ${context.cwd}`);

    return {
      status: "success",
      output: lines.join("\n"),
    };
  },
};
