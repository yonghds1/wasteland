/**
 * wasteland init - 首次运行配置向导
 *
 * 交互式生成 `~/.wasteland/settings.json` 与 `auth.json`。
 *
 * 用法：
 *   wasteland init          # 已有配置时报错退出
 *   wasteland init --force  # 强制覆盖
 *
 * 也会在无参数入口检测到空配置时被 `src/cli.ts` 自动调用（`runInitWizardFlow`）。
 */

import { access } from 'node:fs/promises';

import { Command } from 'commander';
import React from 'react';
import { render } from 'ink';

import { writeInitialConfig } from '../config/config-writer.js';
import {
  resolveUserAuthPath,
  resolveUserSettingsPath,
} from '../config/paths.js';
import { InitWizard, type InitWizardResult } from '../tui/InitWizard.js';
import { t } from '../locales/index.js';
import { detectTTY } from '../ui/tty-detect.js';

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export type InitFlowOptions = {
  /** 覆盖已有配置 */
  force?: boolean;
  /** 已有配置存在时的处理：'error' 抛错退出（显式命令），'skip' 静默跳过（自动触发） */
  onExisting?: 'error' | 'skip';
};

export type InitFlowOutcome =
  | { kind: 'submitted' }
  | { kind: 'cancelled' }
  | { kind: 'skipped-existing' };

/**
 * 引导流程入口（可被 cli.ts 或 commander action 共用）
 *
 * 只处理"是否运行 wizard + 结果处理"的编排；实际写入委托给 config-writer。
 * 非交互环境（非 TTY）会抛错。
 */
export async function runInitWizardFlow(
  options: InitFlowOptions = {}
): Promise<InitFlowOutcome> {
  const { force = false, onExisting = 'error' } = options;

  const settingsPath = resolveUserSettingsPath();
  const authPath = resolveUserAuthPath();
  const [hasSettings, hasAuth] = await Promise.all([
    pathExists(settingsPath),
    pathExists(authPath),
  ]);

  if ((hasSettings || hasAuth) && !force) {
    if (onExisting === 'skip') {
      return { kind: 'skipped-existing' };
    }
    const message = [t('commands.init.existingConfig')];
    if (hasSettings) message.push(`  ${settingsPath}`);
    if (hasAuth) message.push(`  ${authPath}`);
    message.push(t('commands.init.existingHint'));
    throw new Error(message.join('\n'));
  }

  const tty = detectTTY();
  if (!tty.isInteractive) {
    throw new Error(t('commands.init.nonInteractive'));
  }

  const result = await runWizardRender();

  switch (result.kind) {
    case 'submitted':
      return { kind: 'submitted' };
    case 'cancelled':
      return { kind: 'cancelled' };
    case 'error':
      throw new Error(result.message);
  }
}

/**
 * 渲染 InitWizard 并等待用户完成
 *
 * 提取成独立函数便于测试打桩。
 */
function runWizardRender(): Promise<InitWizardResult> {
  return new Promise((resolve) => {
    let finalResult: InitWizardResult = { kind: 'cancelled' };
    const app = render(
      React.createElement(InitWizard, {
        writeConfig: writeInitialConfig,
        onComplete: (result: InitWizardResult) => {
          finalResult = result;
        },
      }),
      {
        stdout: process.stdout,
        stdin: process.stdin,
        exitOnCtrlC: false,
        patchConsole: false,
      }
    );

    app.waitUntilExit().then(() => resolve(finalResult));
  });
}

export function createInitCommand(): Command {
  return new Command('init')
    .description(t('commands.init.description'))
    .option('--force', t('commands.init.options.force'))
    .action(async (options: { force?: boolean }) => {
      try {
        const outcome = await runInitWizardFlow({ force: options.force, onExisting: 'error' });
        if (outcome.kind === 'cancelled') {
          console.error(t('commands.init.cancelled'));
          process.exit(1);
        }
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
