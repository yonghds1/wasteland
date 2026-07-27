/**
 * chat-unified.ts - 统一的 chat 命令实现
 *
 * 使用 initializeRuntime()、CliInputAdapter 和 DefaultOutputAdapter，
 * 替换原来的重复初始化代码。
 */

import type { Observable } from 'rxjs';
import { Command } from 'commander';

import { resolveDefaultTraceDir } from '@config/paths.js';
import type { ChatInputTurn, RuntimeMode } from '@core/runtime/event-types.js';
import { runAgentLoop, MAIN_AGENT_TOOL_NAMES, filterToolRegistry } from '@core/runtime/agent-loop.js';
import { UserInputBridge } from '@core/runtime/user-input-bridge.js';
import { initializeRuntime, type RuntimeEnvironment } from '@core/shared/initialize-runtime.js';
import { renderDebugTrace, type DebugFormat } from '@ui/debug-renderer.js';
import { CliInputAdapter } from '@ui/cli-input-adapter.js';
import { CliOutputAdapter } from '@ui/cli-output-adapter.js';
import {
  createSingleTurnInput,
  readPipedInput,
} from '@ui/readline-input.js';
import { detectTTY } from '@ui/tty-detect.js';
import { t } from '../locales/index.js';

// ============================================================
// Types
// ============================================================

type ChatOptions = {
  debug?: boolean;
  debugFormat?: DebugFormat;
  message?: string;
  provider?: string;
  role?: string;
  permissionMode?: string;
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
    // ---- 主 agent 工具集最小化 ----
    // minimax 是小模型，工具越多决策越乱。这里把完整的 toolRegistry
    // 过滤为 MAIN_AGENT_TOOL_NAMES（spawn_agent / read-file / bash），
    // 让 minimax 只能看到核心工具。其他工具下放给 subAgents。
    // 注：runAgentLoop 不再内部过滤，sub-agents 应保留自己的工具集。
    const mainAgentToolRegistry = runtime.toolRegistry
      ? filterToolRegistry(runtime.toolRegistry, MAIN_AGENT_TOOL_NAMES)
      : undefined;

    const run = runAgentLoop({
      input$: params.input$,
      provider: runtime.provider,
      sessionManager: runtime.sessionManager,
      toolRegistry: mainAgentToolRegistry,
      permissionGate: runtime.permissionGate,
      cwd: params.cwd,
      mode: params.mode,
      maxStepsPerTurn: params.maxStepsPerTurn,
      prompt: params.prompt,
      providerRegistry: runtime.providerRegistry,
      providerSettings: runtime.resolvedRuntime.providerConfig,
      skillExecutor: runtime.skillExecutor,
      childAgentTimeout: runtime.loadedSettings.settings.runtime.childAgentTimeout,
      userInputBridge: params.userInputBridge,
      // debug 开启条件：settings.runtime.debug 或 CLI --debug flag
      debug: Boolean(params.debug || runtime.loadedSettings.settings.runtime.debug),
      // 透传给 dispatchToolCall → spawn-agent（读 subAgents 配置 + 重试参数）
      loadedSettings: runtime.loadedSettings,
    });

    // 使用 CliOutputAdapter 处理事件
    const outputAdapter = params.outputAdapter ?? new CliOutputAdapter();
    const work: Promise<void>[] = [outputAdapter.handleEvents(run.events$)];

    if (params.debug) {
      const traceDir =
        params.debugFormat === 'jsonl'
          ? resolveDefaultTraceDir({
              cwd: params.cwd,
              projectConfigDir: params.projectConfigDir,
            })
          : undefined;

      work.unshift(
        renderDebugTrace(run.debug$, {
          output: process.stderr,
          format: params.debugFormat,
          traceDir,
        })
      );
    }

    await Promise.all(work);
  } finally {
    // 停止 MCP 服务器
    await runtime.mcpManager.stopMCP();
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
    .option('--permission-mode <mode>', t('commands.chat.options.permissionMode'))
    .action(async (options: ChatOptions) => {
      const cwd = process.cwd();

      // 使用 initializeRuntime() 初始化
      const runtime = await initializeRuntime({
        cwd,
        roleName: options.role,
        providerName: options.provider,
      });

      const permissionMode = resolvePermissionMode(
        options.permissionMode ?? runtime.resolvedRuntime.permissionMode
      );
      const debug = options.debug === true || runtime.loadedSettings.settings.runtime.debug;
      const debugFormat = resolveDebugFormat(options.debugFormat);
      const maxStepsPerTurn = runtime.loadedSettings.settings.runtime.maxStepsPerTurn;

      // TTY 检测
      const tty = detectTTY();
      const renderStyle = tty.stdoutIsTTY ? 'interactive' : 'classic';

      if (options.message?.trim()) {
        // 创建输出适配器
        const outputAdapter = new CliOutputAdapter({ style: renderStyle });

        await runChatSession({
          input$: createSingleTurnInput(options.message, 'message'),
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

        await runChatSession({
          input$: createSingleTurnInput(pipedInput, 'stdin'),
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

      // 使用 CliInputAdapter 替代 createInteractiveTurnStream
      const inputAdapter = new CliInputAdapter({
        skillExecutor: runtime.skillExecutor,
        userInputBridge,
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
