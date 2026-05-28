import { Command } from "commander";

import { createChatCommand } from "./commands/chat.js";
import { createConfigCommand, createCurrentConfigCommand } from "./commands/config.js";
import { createTuiCommand } from "./commands/tui.js";
import { createSessionsCommand } from "./commands/sessions.js";
import { createResumeCommand } from "./commands/resume.js";
import { createSkinCommand } from "./commands/skin.js";
import { ensureRoleAliases } from "./utils/symlink-manager.js";

function registerRootCommands(program: Command): void {
  program.addCommand(createChatCommand());
  program.addCommand(createConfigCommand());
  program.addCommand(createCurrentConfigCommand());
  program.addCommand(createTuiCommand());
  program.addCommand(createSessionsCommand());
  program.addCommand(createResumeCommand());
  program.addCommand(createSkinCommand());
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("joe")
    .description("Immortan Joe's War Machine - 多智能体 CLI 系统")
    .version("0.1.0");

  registerRootCommands(program);

  const devShim = new Command("joe")
    .description("开发模式兼容入口。");

  registerRootCommands(devShim);
  program.addCommand(devShim);

  return program;
}

export async function run(argv = process.argv): Promise<void> {
  // 确保角色别名符号链接存在
  await ensureRoleAliases();

  await createProgram().parseAsync(argv);
}

void run();
