import type { Observable } from "rxjs";
import { Command } from "commander";

import { loadRxcSettings } from "../config/load-settings.js";
import { resolveDefaultSessionDir, resolveDefaultTraceDir } from "../config/paths.js";
import { resolveChatRuntime } from "../config/resolve-chat-runtime.js";
import type { AgentProvider } from "../providers/provider-types.js";
import { createDefaultProviderRegistry, type ProviderRegistry } from "../providers/provider-registry.js";
import type { ChatInputTurn, RuntimeMode } from "../runtime/event-types.js";
import { runAgentLoop } from "../runtime/agent-loop.js";
import { createPermissionGate } from "../runtime/permission-gate.js";
import { SessionManager } from "../runtime/session-manager.js";
import { createDefaultToolRegistry, type CreateToolRegistryResult } from "../tools/default-registry.js";
import { renderDebugTrace, type DebugFormat } from "../ui/debug-renderer.js";
import { createInteractiveTurnStream, createSingleTurnInput, readPipedInput } from "../ui/readline-input.js";
import { renderRuntimeEvents } from "../ui/terminal-renderer.js";
import { detectTTY } from "../ui/tty-detect.js";
import type { ProviderSettings, MCPServersConfig } from "../config/settings-types.js";

type ChatOptions = {
  debug?: boolean;
  debugFormat?: DebugFormat;
  message?: string;
  provider?: string;
  role?: string;
  permissionMode?: string;
  /** 多 Agent 模式提示 */
  multi?: boolean;
};

function resolvePermissionMode(value: string | undefined) {
  const mode = value ?? "default";

  if (mode === "default" || mode === "accept_edits" || mode === "bypass_permissions") {
    return mode;
  }

  throw new Error(`当前不支持 permission mode: ${mode}`);
}

function resolveDebugFormat(value: string | undefined): DebugFormat {
  if (value === "jsonl") {
    return "jsonl";
  }

  return "pretty";
}

async function runChatSession(params: {
  input$: Observable<ChatInputTurn>;
  provider: AgentProvider;
  sessionManager: SessionManager;
  cwd: string;
  mode: RuntimeMode;
  debug: boolean;
  debugFormat: DebugFormat;
  projectConfigDir: string | null;
  permissionMode: ReturnType<typeof resolvePermissionMode>;
  maxStepsPerTurn: number;
  prompt?: string;
  /** Provider 注册表，用于子 Agent 模型选择 */
  providerRegistry: ProviderRegistry;
  /** Provider 配置，用于子 Agent 模型选择 */
  providerSettings: ProviderSettings;
  /** MCP 服务器配置 */
  mcpServers?: MCPServersConfig;
  render?: {
    onTurnComplete?: () => void;
    style?: "classic" | "interactive";
  };
}): Promise<void> {
  // 创建工具注册表（包含 MCP）
  const { toolRegistry, startMCP, stopMCP } = createDefaultToolRegistry(params.mcpServers);

  // 启动 MCP 服务器（如果配置了）
  try {
    await startMCP();
  } catch (error) {
    console.warn("MCP servers startup failed:", error instanceof Error ? error.message : String(error));
  }

  try {
    const run = runAgentLoop({
      input$: params.input$,
      provider: params.provider,
      sessionManager: params.sessionManager,
      toolRegistry,
      permissionGate: createPermissionGate({
        mode: params.permissionMode,
      }),
      cwd: params.cwd,
      mode: params.mode,
      maxStepsPerTurn: params.maxStepsPerTurn,
      prompt: params.prompt,
      providerRegistry: params.providerRegistry,
      providerSettings: params.providerSettings,
    });

    const work: Promise<void>[] = [
      renderRuntimeEvents(run.events$, params.render),
    ];

    if (params.debug) {
      const traceDir = params.debugFormat === "jsonl"
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
        }),
      );
    }

    await Promise.all(work);
  } finally {
    // 停止 MCP 服务器
    await stopMCP();
  }
}

export function createChatCommand(): Command {
  const providerRegistry = createDefaultProviderRegistry();

  return new Command("chat")
    .description("通过 runtime/provider/ui 边界按 RxJS 流式处理用户输入并生成回复。")
    .option("-m, --message <text>", "单次输入，适合脚本或测试")
    .option(
      "-p, --provider <name>",
      `provider 名称，当前已注册: ${providerRegistry.list().join(", ")}`,
    )
    .option("-r, --role <name>", "按指定 role 解析模型与默认权限")
    .option("--debug", "输出调试追踪到 stderr")
    .option(
      "--debug-format <format>",
      "调试输出格式：pretty（默认）或 jsonl",
    )
    .option(
      "--permission-mode <mode>",
      "权限模式：default | accept_edits | bypass_permissions",
    )
    .option(
      "--multi",
      "提示系统使用多 Agent 模式（实际由 Agent 决定是否 spawn 子 Agent）",
    )
    .action(async (options: ChatOptions) => {
      const cwd = process.cwd();
      const loadedSettings = await loadRxcSettings({
        cwd,
        env: process.env,
      });
      const resolvedRuntime = resolveChatRuntime({
        settings: loadedSettings.settings,
        roleName: options.role,
        providerName: options.provider,
        cwd,
      });
      const provider = providerRegistry.resolve(
        resolvedRuntime.providerName,
        resolvedRuntime.providerConfig,
      );
      const sessionManager = new SessionManager(
        resolveDefaultSessionDir({
          cwd,
          projectConfigDir: loadedSettings.projectConfigDir,
          env: process.env,
        }),
      );
      const permissionMode = resolvePermissionMode(
        options.permissionMode ?? resolvedRuntime.permissionMode,
      );
      const debug = options.debug === true || loadedSettings.settings.runtime.debug;
      const debugFormat = resolveDebugFormat(options.debugFormat);
      const maxStepsPerTurn = loadedSettings.settings.runtime.maxStepsPerTurn;
      const mcpServers = loadedSettings.settings.mcpServers;

      // TTY 检测：根据环境决定输出样式
      const tty = detectTTY();
      const renderStyle = tty.stdoutIsTTY ? "interactive" : "classic";

      if (options.message?.trim()) {
        await runChatSession({
          input$: createSingleTurnInput(options.message, "message"),
          provider,
          sessionManager,
          cwd,
          mode: "single",
          debug,
          debugFormat,
          projectConfigDir: loadedSettings.projectConfigDir,
          permissionMode,
          maxStepsPerTurn,
          prompt: resolvedRuntime.prompt,
          providerRegistry,
          providerSettings: resolvedRuntime.providerConfig,
          mcpServers,
          render: { style: renderStyle },
        });
        return;
      }

      const pipedInput = await readPipedInput(process.stdin);

      if (pipedInput) {
        await runChatSession({
          input$: createSingleTurnInput(pipedInput, "stdin"),
          provider,
          sessionManager,
          cwd,
          mode: "single",
          debug,
          debugFormat,
          projectConfigDir: loadedSettings.projectConfigDir,
          permissionMode,
          maxStepsPerTurn,
          prompt: resolvedRuntime.prompt,
          providerRegistry,
          providerSettings: resolvedRuntime.providerConfig,
          mcpServers,
          render: { style: "classic" }, // 管道输入使用经典样式
        });
        return;
      }

      if (!process.stdin.isTTY) {
        throw new Error("stdin 输入为空，无法启动会话。");
      }

      const interactive = createInteractiveTurnStream();

      interactive.prompt();

      try {
        await runChatSession({
          input$: interactive.turns$,
          provider,
          sessionManager,
          cwd,
          mode: "interactive",
          debug,
          debugFormat,
          projectConfigDir: loadedSettings.projectConfigDir,
          permissionMode,
          maxStepsPerTurn,
          prompt: resolvedRuntime.prompt,
          providerRegistry,
          providerSettings: resolvedRuntime.providerConfig,
          mcpServers,
          render: {
            onTurnComplete: interactive.prompt,
            style: renderStyle,
          },
        });
      } catch (error) {
        interactive.close();
        await interactive.done;
        throw error;
      }

      await interactive.done;
    });
}
