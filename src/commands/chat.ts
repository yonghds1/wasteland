import { NotificationBridge } from "../core/runtime/notification-bridge.js";
import { merge } from "rxjs";
/**
 * chat.ts - 统一的 chat 命令实现（含无头命令行增强）
 */

import type { Observable } from 'rxjs';
import { tap } from 'rxjs';
import { Command } from 'commander';

import type { ChatInputTurn, FinishReason, RuntimeEvent, RuntimeMode } from '@core/runtime/event-types.js';
import { UserInputBridge } from '@core/engine/user-input-bridge.js';
import {
  initializeRuntime,
  resolveAgentMode,
  type RuntimeEnvironment,
} from '@core/shared/initialize-runtime.js';
import {
  startAgentLoop,
  stopRuntimeAgents,
} from '@core/shared/run-agent-helpers.js';
import { attachDebugTrace } from '@ui/debug-trace-helper.js';
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

export type OutputFormat = 'text' | 'json' | 'stream-json';

export type SessionOutcome = {
  sessionId?: string;
  finishReason: FinishReason;
  error?: string;
  finalMessage?: string;
};

type ChatOptions = {
  debug?: boolean;
  debugFormat?: DebugFormat;
  prompt?: string;
  message?: string;
  provider?: string;
  role?: string;
  dangerouslySkipPermissions?: boolean;
  permissionMode?: string;
  mode?: string;
  outputFormat?: OutputFormat;
  json?: boolean;
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
  return value === 'jsonl' ? 'jsonl' : 'pretty';
}

export function resolveExitCode(finishReason: FinishReason): number {
  switch (finishReason) {
    case 'stop':
      return 0;
    case 'error':
      return 2;
    case 'max_steps':
      return 3;
    case 'abort':
      return 130;
    default:
      return 1;
  }
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
  doomLoopThreshold: number;
  prompt?: string;
  outputAdapter?: CliOutputAdapter;
  userInputBridge?: UserInputBridge;
}): Promise<SessionOutcome> {
  const { runtime } = params;

  let sessionId: string | undefined;
  let finishReason: FinishReason = 'stop';
  let error: string | undefined;
  let finalMessage: string | undefined;

  try {
    const run = startAgentLoop({
      input$: params.input$,
      runtime,
      cwd: params.cwd,
      mode: params.mode,
      maxStepsPerTurn: params.maxStepsPerTurn,
      doomLoopThreshold: params.doomLoopThreshold,
      prompt: params.prompt,
      debug: params.debug,
      userInputBridge: params.userInputBridge,
      interactive: params.mode === 'interactive',
    });

    const trackedEvents$ = run.events$.pipe(
      tap((event: RuntimeEvent) => {
        if (event.type === 'session_started') {
          sessionId = event.sessionId;
        } else if (event.type === 'assistant_message') {
          finalMessage = event.content;
        } else if (event.type === 'session_ended') {
          if (event.finishReason) {
            finishReason = event.finishReason;
          }
          error = event.error;
        }
      })
    );

    const outputAdapter = params.outputAdapter ?? new CliOutputAdapter();
    const work: Promise<void>[] = [outputAdapter.handleEvents(trackedEvents$)];

    attachDebugTrace(work, run.debug$, {
      debug: params.debug,
      debugFormat: params.debugFormat,
      cwd: params.cwd,
      projectConfigDir: params.projectConfigDir,
    });

    await Promise.all(work);
    return { sessionId, finishReason, error, finalMessage };
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
    .argument('[prompt]', t('commands.chat.options.prompt'))
    .option('-p, --prompt <text>', t('commands.chat.options.prompt'))
    .option('-m, --message <text>', t('commands.chat.options.once'))
    .option('--provider <name>', t('commands.chat.options.provider'))
    .option('-r, --role <name>', t('commands.chat.options.role'))
    .option('--output-format <format>', 'Output format: text, json, stream-json', 'text')
    .option('--json', 'Output result in JSON format (shortcut for --output-format json)')
    .option('--debug', t('commands.chat.options.debug'))
    .option('--debug-format <format>', t('commands.chat.options.debugFormat'))
    .option('--dangerously-skip-permissions', t('commands.chat.options.dangerouslySkipPermissions'))
    .option('--permission-mode <mode>', t('commands.chat.options.permissionMode'))
    .option('--mode <mode>', t('commands.chat.options.mode'))
    .action(async (promptArg: string | undefined, options: ChatOptions) => {
      try {
        let actualPromptArg: string | undefined;
        let actualOptions: ChatOptions;
        if (typeof promptArg === 'string') {
          actualPromptArg = promptArg;
          actualOptions = options ?? {};
        } else if (promptArg && typeof promptArg === 'object' && !options) {
          actualOptions = promptArg as ChatOptions;
        } else {
          actualOptions = options ?? {};
        }

        const cwd = process.cwd();
        initializeFileSinkFromEnv({ cwd, env: process.env });

        const explicitPermissionMode = actualOptions.dangerouslySkipPermissions
          ? 'bypass_permissions'
          : actualOptions.permissionMode;

        const runtime = await initializeRuntime({
          cwd,
          roleName: actualOptions.role,
          providerName: actualOptions.provider,
          mode: resolveAgentMode(actualOptions.mode),
          permissionMode: explicitPermissionMode ? resolvePermissionMode(explicitPermissionMode) : undefined,
        });

        const permissionMode = runtime.resolvedRuntime.permissionMode;
        const debug = actualOptions.debug === true || runtime.loadedSettings.settings.runtime.debug;
        const debugFormat = resolveDebugFormat(actualOptions.debugFormat);
        const maxStepsPerTurn = runtime.loadedSettings.settings.runtime.maxStepsPerTurn;
        const doomLoopThreshold = runtime.loadedSettings.settings.runtime.doomLoopThreshold;

        if (debug) {
          enableDebugLog();
        }

        const isJsonOutput = actualOptions.json === true || actualOptions.outputFormat === 'json';
        const tty = detectTTY();
        const renderStyle = isJsonOutput ? 'classic' : (tty.stdoutIsTTY ? 'interactive' : 'classic');
        const userPrompt = actualOptions.prompt ?? actualOptions.message ?? actualPromptArg;

        // 单消息模式
        if (userPrompt?.trim()) {
          const commandWriter = new CliCommandWriter(process.stdout, runtime.skillExecutor);
          const notificationBridge = new NotificationBridge();
          const baseInput$ = createSingleTurnInput(userPrompt, 'message').pipe(
            interceptCommands(commandWriter, { passthroughUnknown: true }),
          );
          const sessionInput$ = merge(baseInput$, notificationBridge.notification$);
          const outputAdapter = isJsonOutput
            ? undefined
            : new CliOutputAdapter({ style: renderStyle });

          try {
            const outcome = await runChatSession({
              input$: sessionInput$,
              runtime,
              cwd,
              mode: 'single',
              debug,
              debugFormat,
              projectConfigDir: runtime.loadedSettings.projectConfigDir,
              permissionMode,
              maxStepsPerTurn,
              doomLoopThreshold,
              prompt: runtime.resolvedRuntime.prompt,
              outputAdapter,
            });

            const exitCode = resolveExitCode(outcome.finishReason);
            if (isJsonOutput) {
              process.stdout.write(
                JSON.stringify(
                  {
                    sessionId: outcome.sessionId,
                    status: outcome.finishReason === 'stop' ? 'success' : 'failed',
                    finishReason: outcome.finishReason,
                    exitCode,
                    content: outcome.finalMessage,
                    error: outcome.error,
                  },
                  null,
                  2,
                ) + '\n',
              );
            }
            process.exitCode = exitCode;
            return;
          } finally {
            notificationBridge.destroy();
          }
        }

        // 管道输入模式
        const pipedInput = await readPipedInput(process.stdin);
        if (pipedInput) {
          const commandWriter = new CliCommandWriter(process.stdout, runtime.skillExecutor);
          const notificationBridge = new NotificationBridge();
          const baseInput$ = createSingleTurnInput(pipedInput, 'stdin').pipe(
            interceptCommands(commandWriter, { passthroughUnknown: true }),
          );
          const sessionInput$ = merge(baseInput$, notificationBridge.notification$);
          const outputAdapter = isJsonOutput
            ? undefined
            : new CliOutputAdapter({ style: 'classic' });

          try {
            const outcome = await runChatSession({
              input$: sessionInput$,
              runtime,
              cwd,
              mode: 'single',
              debug,
              debugFormat,
              projectConfigDir: runtime.loadedSettings.projectConfigDir,
              permissionMode,
              maxStepsPerTurn,
              doomLoopThreshold,
              prompt: runtime.resolvedRuntime.prompt,
              outputAdapter,
            });

            const exitCode = resolveExitCode(outcome.finishReason);
            if (isJsonOutput) {
              process.stdout.write(
                JSON.stringify(
                  {
                    sessionId: outcome.sessionId,
                    status: outcome.finishReason === 'stop' ? 'success' : 'failed',
                    finishReason: outcome.finishReason,
                    exitCode,
                    content: outcome.finalMessage,
                    error: outcome.error,
                  },
                  null,
                  2,
                ) + '\n',
              );
            }
            process.exitCode = exitCode;
            return;
          } finally {
            notificationBridge.destroy();
          }
        }

        if (!process.stdin.isTTY) {
          throw new Error(t('commands.chat.errors.emptyStdin'));
        }

        // 交互式模式 (REPL / readline)
        const userInputBridge = new UserInputBridge();
        const inputAdapter = new CliInputAdapter({
          skillExecutor: runtime.skillExecutor,
          userInputBridge,
          permissionGate: runtime.permissionGate,
        });

        const outputAdapter = new CliOutputAdapter({
          style: renderStyle,
          onTurnComplete: () => inputAdapter.prompt(),
          showThinking: runtime.loadedSettings.settings.runtime.showThinking,
        });

        const notificationBridge = new NotificationBridge();
        const sessionInput$ = merge(inputAdapter.input$, notificationBridge.notification$);

        try {
          await runChatSession({
            input$: sessionInput$,
            runtime,
            cwd,
            mode: 'interactive',
            debug,
            debugFormat,
            projectConfigDir: runtime.loadedSettings.projectConfigDir,
            permissionMode,
            maxStepsPerTurn,
            doomLoopThreshold,
            prompt: runtime.resolvedRuntime.prompt,
            outputAdapter,
            userInputBridge,
          });
        } finally {
          notificationBridge.destroy();
          inputAdapter.destroy();
        }

        await inputAdapter.done;
      } catch (error) {
        process.exitCode = 1;
        throw error;
      }
    });
}

export function createChatCommand(): Command {
  return configureChatCommand(new Command('chat'));
}
