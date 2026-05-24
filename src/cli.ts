import { Command } from "commander";

import { createChatCommand } from "./commands/chat.js";
import { createConfigCommand, createCurrentConfigCommand } from "./commands/config.js";
import { createTuiCommand } from "./commands/tui.js";

function registerRootCommands(program: Command): void {
  program.addCommand(createChatCommand());
  program.addCommand(createConfigCommand());
  program.addCommand(createCurrentConfigCommand());
  program.addCommand(createTuiCommand());
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name("rxc")
    .description("一个基于 TypeScript 的 CLI 脚手架。")
    .version("0.1.0");

  registerRootCommands(program);

  const devShim = new Command("rxc")
    .description("开发模式兼容入口。");

  registerRootCommands(devShim);
  program.addCommand(devShim);

  return program;
}

export async function run(argv = process.argv): Promise<void> {
  await createProgram().parseAsync(argv);
}

void run();
