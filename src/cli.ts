import { Command } from "commander";

import { createChatCommand } from "./commands/chat.js";
import { createConfigCommand, createCurrentConfigCommand } from "./commands/config.js";
import { createTuiCommand } from "./commands/tui.js";
import { createSessionsCommand } from "./commands/sessions.js";
import { createResumeCommand } from "./commands/resume.js";
import { createSkinCommand } from "./commands/skin.js";
import { ensureRoleAliases } from "./utils/symlink-manager.js";
import { loadWastelandSettings } from "./config/load-settings.js";
import { initI18n, t } from "./locales/index.js";

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
    .name("wasteland")
    .description(t("cli.description"))
    .version("0.1.0");

  registerRootCommands(program);

  const devShim = new Command("wasteland")
    .description(t("cli.devDescription"));

  registerRootCommands(devShim);
  program.addCommand(devShim);

  return program;
}

export async function run(argv = process.argv): Promise<void> {
  // 确保角色别名符号链接存在
  await ensureRoleAliases();

  // 初始化 i18n
  try {
    const loadedSettings = await loadWastelandSettings({ cwd: process.cwd(), env: process.env });
    const language = loadedSettings.settings.runtime.language;
    await initI18n(language);
  } catch {
    // 如果加载配置失败，使用默认语言
    await initI18n("en");
  }

  await createProgram().parseAsync(argv);
}

void run();
