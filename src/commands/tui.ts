/**
 * TUI 命令
 *
 * 启动交互式 TUI Dashboard
 */

import { Command } from "commander";

import { runTUI } from "../tui/index.js";

export function createTuiCommand(): Command {
  return new Command("tui")
    .description("启动交互式 TUI Dashboard")
    .option("--attach <session>", "附加到已有 session")
    .action(async (options) => {
      console.log("启动 TUI Dashboard...");
      console.log("按 Tab 切换页面，按 q 退出");
      console.log("");

      try {
        await runTUI();
      } catch (error) {
        console.error("TUI 启动失败:", error);
        process.exit(1);
      }
    });
}
