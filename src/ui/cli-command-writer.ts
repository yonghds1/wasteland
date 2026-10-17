/**
 * cli-command-writer.ts - CLI 命令结果输出 writer
 *
 * 把 SyncCommandResult 渲染到终端输出流。
 *
 * ## 设计
 *
 * - strategy pattern：每个 result.type 独立的渲染方法
 * - action handler 通过 record 注入，新增 action 只加一行
 * - 与 CliInputAdapter 解耦：可独立测试，可被 chat.ts 直接复用
 */

import type { Writable } from 'node:stream';

import type {
  SyncActionResult,
  SyncCommandResult,
  SyncErrorResult,
  SyncOutputResult,
} from '@core/shared/command-executor-sync.js';
import type { CommandWriter } from '@core/shared/command-writer.js';
import type { SkillExecutor } from '@core/skills/skill-executor.js';
import { updateRuntimeMode } from '@config/config-writer.js';
import { setAgentMode } from '@config/agent-mode-state.js';
import { t } from '@locales/index.js';
import { ANSI } from './terminal-theme.js';

// 接口已上浮到 `@core/shared/command-writer.js`，此处 re-export 仅为兼容既有导入。
export type { CommandWriter } from '@core/shared/command-writer.js';

/**
 * CLI 命令 writer：把 SyncCommandResult 格式化为终端文本。
 *
 * action 处理通过 actionHandlers 注册，新增 action 只加一行。
 */
export class CliCommandWriter implements CommandWriter {
  private readonly actionHandlers: Record<string, (r: SyncActionResult) => void>;

  constructor(
    private readonly output: Writable,
    private readonly skillExecutor?: SkillExecutor,
  ) {
    this.actionHandlers = {
      clear: () => this.handleClear(),
      exit: () => this.handleExit(),
      help: () => this.handleHelp(),
      mode: (r) => this.handleMode(r),
      // 其它 action（sessions / logs / context 等）默认 no-op；
      // TUI 模式有专属处理（App.tsx），CLI 模式忽略
    };
  }

  /**
   * 渲染 SyncCommandResult 到输出流。
   */
  isSkillCommand(input: string): boolean {
    return this.skillExecutor?.isSkillCommand(input) ?? false;
  }

  write(result: SyncCommandResult): void {
    switch (result.type) {
      case 'output':
        this.writeOutput(result);
        return;
      case 'action':
        this.writeAction(result);
        return;
      case 'error':
        this.writeError(result);
        return;
    }
  }

  // ---- result type handlers ----

  private writeOutput(result: SyncOutputResult): void {
    this.output.write(`${ANSI.reset}\n${result.output}\n\n`);
  }

  private writeAction(result: SyncActionResult): void {
    const handler = this.actionHandlers[result.action];
    if (handler) {
      handler(result);
    }
    // 未注册的 action：no-op（TUI 模式有专属处理）
  }

  private writeError(result: SyncErrorResult): void {
    this.output.write(`${ANSI.reset}\n${ANSI.red}[error] ${result.error}${ANSI.reset}\n\n`);
  }

  // ---- action handlers ----

  private handleClear(): void {
    this.output.write(`${ANSI.reset}\x1b[2J\x1b[H`);
  }

  private handleExit(): void {
    this.output.write(`${ANSI.reset}${t('commands.exit.goodbye')}\n\n`);
  }

  private handleHelp(): void {
    const skillsHelp = this.skillExecutor?.createSkillsHelp() ?? '';
    const helpText = [
      'Session commands:',
      '  /help   Show interactive help',
      '  /tools  Show current local tool syntax',
      '  /skills Show available skills',
      '  /clear  Clear screen and redraw',
      '  /sessions  List and browse past sessions',
      '  /exit   Exit the session',
      '',
      'Local tool syntax:',
      '  /read <path>           Read file contents',
      '  /write <path> <text>   Write to file',
      '  /edit <path> <old> <new>  Edit file (replace text)',
      '  /bash <command>        Execute shell command',
      '  /glob <pattern>        Find files by pattern',
      '  /grep <pattern>        Search file contents',
      '  /ls [path]             List directory contents',
      '',
      'Available skills:',
      skillsHelp || '  (Run /skills to see all available skills.)',
    ].join('\n');
    this.output.write(`${ANSI.reset}\n${helpText}\n\n`);
  }

  private handleMode(result: SyncActionResult): void {
    // /mode single|multi → 实时切换 + 异步写回 settings.json
    // action.data 携带原始 input（由 sync executor 设置），从 input 解析参数
    const rawInput = (result.data?.input as string | undefined) ?? '';
    const arg = rawInput.replace(/^\/mode\s*/, '').trim();
    if (arg !== 'single' && arg !== 'multi') {
      this.output.write(
        `${ANSI.reset}\n${t('commands.modeCommand.invalid', { mode: arg })}\n\n`
      );
      return;
    }
    setAgentMode(arg);
    void updateRuntimeMode(arg)
      .then(() => {
        this.output.write(
          `${ANSI.reset}\n${t('commands.modeCommand.switched', { mode: arg })}\n\n`
        );
      })
      .catch((err: unknown) => {
        this.output.write(
          `${ANSI.reset}\n${t('commands.modeCommand.failed', {
            error: err instanceof Error ? err.message : String(err),
          })}\n\n`
        );
      });
  }
}