import { Command } from "commander";

import { createChatCommand } from "./commands/chat.js";
import { createHelloCommand } from "./commands/hello.js";

export function createProgram(): Command {
  const program = new Command();

  program
    .name("rxc")
    .description("一个基于 TypeScript 的 CLI 脚手架。")
    .version("0.1.0");

  program.addCommand(createHelloCommand());
  program.addCommand(createChatCommand());

  return program;
}

export async function run(argv = process.argv): Promise<void> {
  await createProgram().parseAsync(argv);
}

void run();
