/**
 * chat-unified.ts - 统一的 chat 命令实现
 *
 * 使用 initializeRuntime()、CliInputAdapter 和 DefaultOutputAdapter，
 * 替换原来的重复初始化代码。
 */

import type { Observable } from 'rxjs';
import { Command } from 'commander';

import type { ChatInputTurn, RuntimeMode } from '@core/runtime/event-types.js';
import { UserInputBridge } from '@core/runtime/user-input-bridge.js';
import {
  initializeRuntime,
  resolveAgentMode,
  type RuntimeEnvironment,
} from '@core/shared/initialize-runtime.js';
import {
  attachDebugTrace,
  startAgentLoop,
  stopRuntimeAgents,
} from '@core/shared/run-agent-helpers.js';
import { interceptCommands } from '@core/shared/intercept-commands.js';
import {
  enableDebugLog,
  initializeFileSinkFromEnv,
} from '@core/runtime/debug-logger.js';
import type { DebugFormat } from '@ui/debug-renderer.js';
import { CliInputAdapter } from '@ui/cli-input-adapter.js';
import { CliCommandWriter } from '@ui/cli-command-writer.js';
import { CliOutputAdapter } from '@ui/cli-output-adapter.js';
import { createSingleTurnInput, readPipedInput } from '@ui/readline-input.js';
import { detectTTY } from '@ui/tty-detect.js';
import { t } from '@locales/index.js';

// ============================================================
// Types
// ============================================================

type ChatOptions = {
  debug?: boolean;
  debugFormat?: DebugFormat;
  message?: string;
  provider?: string;
  role?: string;
  dangerouslySkipPermissions?: boolean;
  permissionMode?: string;
  /** --mode 启动参数（原始字符串，经 resolveAgentMode 收窄为 single/multi） */
  mode?: string;
};

// ============================================================
// Helper Functions
// ============================================================

function resolvePermissionMode(value: string | undefined) {
  const mode = value ?? 'default';

  if (mode === 'default' || mode === 'accept_edits' || mode === 'bypass_permissions') {
    return mode;
  }

  throw new Error(`${t('commands.chat.errors.permissionMode')} ${mode}`);
}

function resolveDebugFormat(value: string | undefined): DebugFormat {
  if (value === 'jsonl') {
    return 'jsonl';
  }

  return 'pretty';
}

// ============================================================
// Core Function
// ============================================================

async function runChatSession(params: {
  input$: Observable<ChatInputTurn>;
  runtime: RuntimeEnvironment;
  cwd: string;
  mode: RuntimeMode;
  debug: boolean;
  debugFormat: DebugFormat;
  projectConfigDir: string | null;
  permissionMode: ReturnType<typeof resolvePermissionMode>;
  maxStepsPerTurn: number;
  prompt?: string;
  outputAdapter?: CliOutputAdapter;
  userInputBridge?: UserInputBridge;
}): Promise<void> {
  const { runtime } = params;

  try {
    const run = startAgentLoop({
      input$: params.input$,
      runtime,
      cwd: params.cwd,
      mode: params.mode,
      maxStepsPerTurn: params.maxStepsPerTurn,
      prompt: params.prompt,
      debug: params.debug,
      userInputBridge: params.userInputBridge,
    });

    // 使用 CliOutputAdapter 处理事件
    const outputAdapter = params.outputAdapter ?? new CliOutputAdapter();
    const work: Promise<void>[] = [outputAdapter.handleEvents(run.events$)];

    attachDebugTrace(work, run.debug$, {
      debug: params.debug,
      debugFormat: params.debugFormat,
      cwd: params.cwd,
      projectConfigDir: params.projectConfigDir,
    });

    await Promise.all(work);
  } finally {
    await stopRuntimeAgents(runtime);
  }
}

// ============================================================
// Command Factory
// ============================================================

export function configureChatCommand(cmd: Command): Command {
  return cmd
    .description(t('commands.chat.description'))
    .option('-m, --message <text>', t('commands.chat.options.once'))
    .option('-p, --provider <name>', t('commands.chat.options.provider'))
    .option('-r, --role <name>', t('commands.chat.options.role'))
    .option('--debug', t('commands.chat.options.debug'))
    .option('--debug-format <format>', t('commands.chat.options.debugFormat'))
    .option('--dangerously-skip-permissions', t('commands.chat.options.dangerouslySkipPermissions'))
    .option('--permission-mode <mode>', t('commands.chat.options.permissionMode'))
    .option('--mode <mode>', t('commands.chat.options.mode'))
    .action(async (options: ChatOptions) => {
      const cwd = process.cwd();

      // 装配 FileSink + Logger（默认 info；debug 路径见下）
      initializeFileSinkFromEnv({ cwd, env: process.env });

      // 权限模式解析：--dangerously-skip-permissions 强置 bypass_permissions，否则取 --permission-mode
      const explicitPermissionMode = options.dangerouslySkipPermissions
        ? 'bypass_permissions'
        : options.permissionMode;

      // 使用 initializeRuntime() 初始化
      // mode：--mode 启动参数（收窄为 single/multi）透传给 initializeRuntime，
      // 只影响 agentMode（skin/singleAgent 语义），不碰 runChatSession 的 RuntimeMode
      const runtime = await initializeRuntime({
        cwd,
        roleName: options.role,
        providerName: options.provider,
        mode: resolveAgentMode(options.mode),
        permissionMode: explicitPermissionMode ? resolvePermissionMode(explicitPermissionMode) : undefined,
      });

      const permissionMode = runtime.resolvedRuntime.permissionMode;
      const debug = options.debug === true || runtime.loadedSettings.settings.runtime.debug;
      const debugFormat = resolveDebugFormat(options.debugFormat);
      const maxStepsPerTurn = runtime.loadedSettings.settings.runtime.maxStepsPerTurn;

      // debug 启用时升 Logger level（FileSink 已装配）
      if (debug) {
        enableDebugLog();
      }

      // TTY 检测
      const tty = detectTTY();
      const renderStyle = tty.stdoutIsTTY ? 'interactive' : 'classic';

      if (options.message?.trim()) {
        // 创建输出适配器
        const outputAdapter = new CliOutputAdapter({ style: renderStyle });
        // 命令 writer：拦截 / 命令时输出命令结果（help/clear/mode 等）
        const commandWriter = new CliCommandWriter(
          process.stdout,
          runtime.skillExecutor,
        );

        await runChatSession({
          // 单消息模式：pipe interceptCommands 拦截 / 命令
          input$: createSingleTurnInput(options.message, 'message').pipe(
            interceptCommands(commandWriter),
          ),
          runtime,
          cwd,
          mode: 'single',
          debug,
          debugFormat,
          projectConfigDir: runtime.loadedSettings.projectConfigDir,
          permissionMode,
          maxStepsPerTurn,
          prompt: runtime.resolvedRuntime.prompt,
          outputAdapter,
        });
        return;
      }

      const pipedInput = await readPipedInput(process.stdin);

      if (pipedInput) {
        // 创建输出适配器
        const outputAdapter = new CliOutputAdapter({ style: 'classic' });
        const commandWriter = new CliCommandWriter(
          process.stdout,
          runtime.skillExecutor,
        );

        await runChatSession({
          // 管道输入模式：pipe interceptCommands 拦截 / 命令
          input$: createSingleTurnInput(pipedInput, 'stdin').pipe(
            interceptCommands(commandWriter),
          ),
          runtime,
          cwd,
          mode: 'single',
          debug,
          debugFormat,
          projectConfigDir: runtime.loadedSettings.projectConfigDir,
          permissionMode,
          maxStepsPerTurn,
          prompt: runtime.resolvedRuntime.prompt,
          outputAdapter,
        });
        return;
      }

      if (!process.stdin.isTTY) {
        throw new Error(t('commands.chat.errors.emptyStdin'));
      }

      // 创建用户输入桥接器（用于 ask-user 工具）
      const userInputBridge = new UserInputBridge();

      const inputAdapter = new CliInputAdapter({
        skillExecutor: runtime.skillExecutor,
        userInputBridge,
        permissionGate: runtime.permissionGate,
      });

      // 创建输出适配器
      const outputAdapter = new CliOutputAdapter({
        style: renderStyle,
        onTurnComplete: () => inputAdapter.prompt(),
        showThinking: runtime.loadedSettings.settings.runtime.showThinking,
      });

      try {
        await runChatSession({
          input$: inputAdapter.input$,
          runtime,
          cwd,
          mode: 'interactive',
          debug,
          debugFormat,
          projectConfigDir: runtime.loadedSettings.projectConfigDir,
          permissionMode,
          maxStepsPerTurn,
          prompt: runtime.resolvedRuntime.prompt,
          outputAdapter,
          userInputBridge,
        });
      } catch (error) {
        inputAdapter.destroy();
        throw error;
      }

      await inputAdapter.done;
    });
}

export function createChatCommand(): Command {
  return configureChatCommand(new Command('chat'));
}
