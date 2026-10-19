import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

import { configureChatCommand } from './commands/chat.js';
import { createConfigCommand, createCurrentConfigCommand } from './commands/config.js';
import { createSetupCommand, runInitWizardFlow } from './commands/init.js';
import { createTuiCommand } from './commands/tui.js';
import { createSessionsCommand } from './commands/sessions.js';
import { createResumeCommand } from './commands/resume.js';
import { createSkinCommand } from './commands/skin.js';
import { createExportCommand } from './commands/export.js';
import { createLogsCommand } from './commands/logs.js';
import { createSkillsCommand } from './commands/skills.js';
import { createDoctorCommand } from './commands/doctor.js';
import { createContextCommand, createContextHistoryCommand, createContextCompactionCommand, createContextTrendCommand } from './commands/context.js';
import { isConfigEmpty } from './config/config-writer.js';
import { ensureRoleAliases } from './config/symlink-manager.js';
import { loadWastelandSettings } from './config/load-settings.js';
import { setLoadedSettings, clearLoadedSettings } from './config/loaded-settings.js';
import { initI18n, t, DEFAULT_LANGUAGE } from './locales/index.js';
import { detectTTY } from './ui/tty-detect.js';

export const REGISTERED_SUBCOMMANDS = new Set([
  'config',
  'setup',
  'init',
  'tui',
  'sessions',
  'resume',
  'skin',
  'export',
  'logs',
  'skills',
  'context',
  'chat',
  'doctor',
]);

export function resolveEffectiveArgv(argv: string[], isStdinTTY = process.stdin.isTTY): string[] {
  const binArgs = argv.length >= 2 ? argv.slice(0, 2) : ['node', 'wasteland'];
  const rawArgs = argv.slice(2);

  if (rawArgs.length === 0) {
    if (!isStdinTTY) {
      return [...binArgs, 'chat'];
    }
    return [...binArgs, 'tui'];
  }

  const firstArg = rawArgs[0];
  const isHelpOrVersion =
    firstArg === '-h' ||
    firstArg === '--help' ||
    firstArg === '-V' ||
    firstArg === '--version';

  if (!REGISTERED_SUBCOMMANDS.has(firstArg) && !isHelpOrVersion) {
    return [...binArgs, 'chat', ...rawArgs];
  }

  return argv;
}

function registerRootCommands(program: Command): void {
  // chat 命令作为非交互式 fallback（非 TTY 场景使用 --message / -p / prompt）
  configureChatCommand(program.command('chat'));
  program.addCommand(createConfigCommand());
  program.addCommand(createCurrentConfigCommand());
  program.addCommand(createSetupCommand());
  program.addCommand(createTuiCommand());
  program.addCommand(createSessionsCommand());
  program.addCommand(createResumeCommand());
  program.addCommand(createSkinCommand());
  program.addCommand(createExportCommand());
  program.addCommand(createLogsCommand());
  program.addCommand(createSkillsCommand());
  program.addCommand(createDoctorCommand());

  // Context 命令
  const contextCmd = createContextCommand();
  contextCmd.addCommand(createContextHistoryCommand());
  contextCmd.addCommand(createContextCompactionCommand());
  contextCmd.addCommand(createContextTrendCommand());
  program.addCommand(contextCmd);
}

function getPackageVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return pkg.version || '0.1.0';
  } catch {
    return '0.1.0';
  }
}

export function createProgram(): Command {
  const program = new Command();

  program.name('wasteland').description(t('cli.description')).version(getPackageVersion());

  registerRootCommands(program);

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

  const effectiveArgv = resolveEffectiveArgv(argv, process.stdin.isTTY);
  const cliArgs = effectiveArgv.slice(2);

  // 首次运行引导：空配置 + 交互式终端 + 非 init/setup/help/version 子命令 → 自动进入引导
  const isConfigCommand =
    cliArgs[0] === 'init' ||
    cliArgs[0] === 'setup' ||
    cliArgs[0] === 'doctor' ||
    cliArgs.includes('--help') ||
    cliArgs.includes('-h') ||
    cliArgs.includes('--version') ||
    cliArgs.includes('-V');

  if (!isConfigCommand && loadedSettings && isConfigEmpty(loadedSettings.settings) && detectTTY().isInteractive) {
    try {
      const outcome = await runInitWizardFlow({ onExisting: 'skip' });
      if (outcome.kind === 'cancelled') {
        console.error(t('commands.init.cancelled'));
        process.exit(1);
      }
      // 重新加载配置
      loadedSettings = await loadWastelandSettings({ cwd: process.cwd(), env: process.env });
      const language = loadedSettings.settings.runtime.language;
      await initI18n(language);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  // 确保皮肤命令别名符号链接存在（静默降级，不阻断主流程）
  const skinId = loadedSettings?.settings.runtime.skinId ?? 'warlord-immortal';
  await ensureRoleAliases(skinId).catch(() => {});

  // 缓存已加载配置，供 initializeRuntime 复用，避免重复加载
  setLoadedSettings(loadedSettings);

  await createProgram().parseAsync(effectiveArgv);

  // 清理配置缓存
  clearLoadedSettings();
}

// 仅当作为主模块直接被 node/tsx 启动时才自动运行
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  void run();
}
