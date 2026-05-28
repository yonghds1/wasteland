/**
 * TUI 命令
 *
 * 启动交互式 TUI Dashboard
 */

import { Command } from "commander";

import { detectTTY } from "../ui/tty-detect.js";
import { runTUI } from "../tui/index.js";
import { createTuiRuntime, cleanupTuiRuntime } from "../tui/hooks/useRuntime.js";

export function createTuiCommand(): Command {
  return new Command("tui")
    .description("启动交互式 TUI Dashboard")
    .option("--attach <session>", "附加到已有 session")
    .action(async (options) => {
      // TTY 检测
      const tty = detectTTY();

      if (!tty.isInteractive) {
        console.error("错误: TUI 需要交互式终端 (TTY) 环境。");
        console.error("");
        console.error("当前环境:");
        console.error(`  - stdin TTY:  ${tty.stdinIsTTY ? "是" : "否"}`);
        console.error(`  - stdout TTY: ${tty.stdoutIsTTY ? "是" : "否"}`);
        console.error("");
        console.error("请在终端中直接运行:");
        console.error("  joe tui");
        console.error("");
        console.error("或使用 CLI 模式:");
        console.error("  joe chat --message '你的消息'");
        process.exit(1);
      }

      try {
        // 创建 TUI 运行时
        const runtime = await createTuiRuntime(process.cwd());

        try {
          // 启动 TUI
          await runTUI(runtime);
        } finally {
          // 清理资源
          await cleanupTuiRuntime(runtime);
        }
      } catch (error) {
        console.error("TUI 启动失败:", error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
