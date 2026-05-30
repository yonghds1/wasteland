/**
 * TUI 命令
 *
 * 启动交互式 TUI Dashboard
 */

import { Command } from 'commander';

import { detectTTY } from '../ui/tty-detect.js';
import { runTUI } from '../tui/index.js';
import { createTuiRuntime, cleanupTuiRuntime } from '../tui/hooks/useRuntime.js';
import { loadWastelandSettings } from '../config/load-settings.js';
import { initI18n, t } from '../locales/index.js';

export function createTuiCommand(): Command {
  return new Command('tui')
    .description(t('commands.tui.description'))
    .option('-r, --role <name>', t('commands.chat.options.role'))
    .option('-p, --provider <name>', t('commands.chat.options.provider'))
    .option('--permission-mode <mode>', t('commands.chat.options.permissionMode'))
    .option('--debug', t('commands.chat.options.debug'))
    .option('--attach <session>', t('commands.tui.options.attach'))
    .action(async (options) => {
      // 初始化 i18n
      const loadedSettings = await loadWastelandSettings({ cwd: process.cwd(), env: process.env });
      const language = loadedSettings.settings.runtime.language;
      await initI18n(language);

      // TTY 检测
      const tty = detectTTY();

      if (!tty.isInteractive) {
        console.error(t('commands.tui.errors.noTty'));
        console.error('');
        console.error(t('commands.tui.errors.currentEnv'));
        console.error(
          `  - stdin TTY:  ${tty.stdinIsTTY ? t('commands.tui.errors.yes') : t('commands.tui.errors.no')}`
        );
        console.error(
          `  - stdout TTY: ${tty.stdoutIsTTY ? t('commands.tui.errors.yes') : t('commands.tui.errors.no')}`
        );
        console.error('');
        console.error(t('commands.tui.errors.runDirectly'));
        console.error('  wasteland tui');
        console.error('');
        console.error(t('commands.tui.errors.useCli'));
        console.error("  wasteland chat --message 'your message'");
        process.exit(1);
      }

      try {
        // 创建 TUI 运行时
        const runtime = await createTuiRuntime(process.cwd(), options.role);

        try {
          // 启动 TUI
          await runTUI(runtime);
        } finally {
          // 清理资源
          await cleanupTuiRuntime(runtime);
        }
      } catch (error) {
        console.error(
          t('commands.tui.errors.failed'),
          error instanceof Error ? error.message : error
        );
        process.exit(1);
      }
    });
}
