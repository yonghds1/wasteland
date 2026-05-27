/**
 * sessions.ts - Sessions 命令
 *
 * 列出本地 session，支持搜索和过滤。
 */

import { Command } from "commander";
import { createSessionIndex, type SessionSummary } from "../runtime/session-index.js";

// ============================================================
// 辅助函数
// ============================================================

/**
 * 格式化日期时间
 */
function formatDateTime(dateStr: string): string {
  if (!dateStr) {
    return "未知";
  }

  try {
    const date = new Date(dateStr);
    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
}

/**
 * 截断文本
 */
function truncate(text: string | undefined, maxLength: number): string {
  if (!text) {
    return "";
  }

  if (text.length <= maxLength) {
    return text;
  }

  return text.substring(0, maxLength - 3) + "...";
}

/**
 * 格式化 session 列表
 */
function formatSessionList(sessions: SessionSummary[]): string {
  if (sessions.length === 0) {
    return "没有找到 session。";
  }

  const lines: string[] = [];

  for (const session of sessions) {
    const id = session.id;
    const date = formatDateTime(session.createdAt);
    const messages = `${session.messageCount} 条消息`;
    const provider = session.providerId || "未知";
    const preview = truncate(session.firstUserMessage, 50);

    lines.push(`  ${id}`);
    lines.push(`    时间: ${date}`);
    lines.push(`    消息: ${messages}`);
    lines.push(`    Provider: ${provider}`);

    if (preview) {
      lines.push(`    预览: ${preview}`);
    }

    if (session.hasChildren) {
      lines.push(`    子 Agent: ${session.childNames.join(", ")}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * 格式化 session 详情
 */
function formatSessionDetail(session: any): string {
  const lines: string[] = [];

  lines.push(`Session: ${session.id}`);
  lines.push(`时间: ${formatDateTime(session.createdAt)}`);
  lines.push(`消息数: ${session.messageCount}`);
  lines.push(`Provider: ${session.providerId || "未知"}`);
  lines.push(`模式: ${session.mode || "未知"}`);
  lines.push(`工作目录: ${session.cwd || "未知"}`);
  lines.push("");

  if (session.hasChildren) {
    lines.push(`子 Agent: ${session.childNames.join(", ")}`);
    lines.push("");
  }

  lines.push("消息记录:");
  lines.push("─".repeat(60));

  for (const record of session.records) {
    if (record.type === "message") {
      const role = record.role === "user" ? "用户" : "助手";
      const content = truncate(record.content, 200);
      lines.push(`[${role}] ${content}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ============================================================
// 命令定义
// ============================================================

/**
 * 创建 sessions 命令
 */
export function createSessionsCommand(): Command {
  const command = new Command("sessions")
    .description("列出本地 session")
    .option("-l, --limit <number>", "最大返回数量", "20")
    .option("-s, --search <query>", "搜索关键词")
    .option("-p, --provider <name>", "按 Provider 过滤")
    .option("-m, --mode <name>", "按模式过滤")
    .option("--sort <order>", "排序方式 (newest/oldest)", "newest")
    .option("--json", "输出 JSON 格式")
    .action(async (options) => {
      try {
        const sessionIndex = createSessionIndex();

        const sessions = await sessionIndex.listSessions({
          limit: parseInt(options.limit, 10),
          search: options.search,
          provider: options.provider,
          mode: options.mode,
          sort: options.sort as "newest" | "oldest",
        });

        if (options.json) {
          console.log(JSON.stringify(sessions, null, 2));
        } else {
          console.log(`\n找到 ${sessions.length} 个 session:\n`);
          console.log(formatSessionList(sessions));
        }
      } catch (error) {
        console.error("列出 session 失败:", error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // 添加子命令：查看 session 详情
  command
    .command("show <session-id>")
    .description("查看 session 详情")
    .option("--json", "输出 JSON 格式")
    .action(async (sessionId: string, options: any) => {
      try {
        const sessionIndex = createSessionIndex();
        const session = await sessionIndex.getSession(sessionId);

        if (!session) {
          console.error(`Session 不存在: ${sessionId}`);
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify(session, null, 2));
        } else {
          console.log(formatSessionDetail(session));
        }
      } catch (error) {
        console.error("查看 session 失败:", error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // 添加子命令：删除 session
  command
    .command("delete <session-id>")
    .description("删除 session")
    .option("--confirm", "确认删除")
    .action(async (sessionId: string, options: any) => {
      try {
        if (!options.confirm) {
          console.log(`要删除 session ${sessionId}，请添加 --confirm 参数。`);
          return;
        }

        const sessionIndex = createSessionIndex();
        const success = await sessionIndex.deleteSession(sessionId);

        if (success) {
          console.log(`Session ${sessionId} 已删除。`);
        } else {
          console.error(`删除 session 失败: ${sessionId}`);
          process.exit(1);
        }
      } catch (error) {
        console.error("删除 session 失败:", error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // 添加子命令：统计信息
  command
    .command("stats")
    .description("显示 session 统计信息")
    .option("--json", "输出 JSON 格式")
    .action(async (options: any) => {
      try {
        const sessionIndex = createSessionIndex();
        const stats = await sessionIndex.getStats();

        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          console.log("\nSession 统计信息:");
          console.log("─".repeat(40));
          console.log(`总 session 数: ${stats.totalSessions}`);
          console.log(`总消息数: ${stats.totalMessages}`);

          if (stats.oldestSession) {
            console.log(`最早 session: ${formatDateTime(stats.oldestSession)}`);
          }

          if (stats.newestSession) {
            console.log(`最新 session: ${formatDateTime(stats.newestSession)}`);
          }

          console.log("");
        }
      } catch (error) {
        console.error("获取统计信息失败:", error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  return command;
}
