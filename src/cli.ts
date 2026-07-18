import { Command } from 'commander';

import { configureChatCommand } from './commands/chat.js';
import { createConfigCommand, createCurrentConfigCommand } from './commands/config.js';
import { createTuiCommand } from './commands/tui.js';
import { createSessionsCommand } from './commands/sessions.js';
import { createResumeCommand } from './commands/resume.js';
import { createSkinCommand } from './commands/skin.js';
import { ensureRoleAliases } from './utils/symlink-manager.js';
import { loadWastelandSettings } from './config/load-settings.js';
import { initI18n, t, DEFAULT_LANGUAGE } from './locales/index.js';

function registerRootCommands(program: Command): void {
  // chat 命令保留功能，但从 --help 隐藏（TUI 为唯一主入口）
  configureChatCommand(program.command('chat', { hidden: true }));
  program.addCommand(createConfigCommand());
  program.addCommand(createCurrentConfigCommand());
  program.addCommand(createTuiCommand());
  program.addCommand(createSessionsCommand());
  program.addCommand(createResumeCommand());
  program.addCommand(createSkinCommand());
}

export function createProgram(): Command {
  const program = new Command();

  program.name('wasteland').description(t('cli.description')).version('0.1.0');

  registerRootCommands(program);

  const devShim = new Command('wasteland').description(t('cli.devDescription'));

  registerRootCommands(devShim);
  program.addCommand(devShim);

  return program;
}

export async function run(argv = process.argv): Promise<void> {
  // 初始化 i18n + 加载配置
  let loadedSettings;
  try {
    loadedSettings = await loadWastelandSettings({ cwd: process.cwd(), env: process.env });
    const language = loadedSettings.settings.runtime.language;
    await initI18n(language);
  } catch {
    // 如果加载配置失败，使用默认语言
    await initI18n(DEFAULT_LANGUAGE);
  }

  // 确保皮肤命令别名符号链接存在
  const skinId = loadedSettings?.settings.runtime.skinId ?? 'immortan-joe';
  await ensureRoleAliases(skinId);

  // 将已加载的配置存储到全局，避免重复加载
  // initializeRuntime() 会优先使用此配置
  (globalThis as Record<string, unknown>).__wasteland_loaded_settings = loadedSettings;

  // 无参数时默认启动 TUI（CLI chat 模式已从 help 隐藏，TUI 为唯一主入口）
  const cliArgs = argv.slice(2);
  if (cliArgs.length === 0) {
    argv = [...argv, 'tui'];
  }

  await createProgram().parseAsync(argv);

  // 清理全局配置
  delete (globalThis as Record<string, unknown>).__wasteland_loaded_settings;
}

void run();
