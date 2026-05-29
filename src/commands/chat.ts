import type { Observable } from "rxjs";
import { Command } from "commander";

import { loadWastelandSettings } from "../config/load-settings.js";
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
import { createSkillRegistry } from "../skills/skill-discovery.js";
import { SkillExecutor } from "../skills/skill-executor.js";
import { homedir } from "node:os";
import { t } from "../locales/index.js";

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

  throw new Error(`${t("commands.chat.errors.permissionMode")} ${mode}`);
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
  /** 子 Agent 执行超时（毫秒） */
  childAgentTimeout?: number;
  render?: {
    onTurnComplete?: () => void;
    style?: "classic" | "interactive";
  };
}): Promise<void> {
  // 创建工具注册表（包含 MCP）
  const { toolRegistry, startMCP, stopMCP } = createDefaultToolRegistry(params.mcpServers);

  // 创建技能注册表（包含内置技能和用户自定义技能）
  const skillRegistry = await createSkillRegistry({
    projectSkillsDir: params.projectConfigDir ? `${params.projectConfigDir}/skills` : undefined,
    userSkillsDir: `${homedir()}/.wasteland/skills`,
  });

  // 创建技能执行器
  const skillExecutor = new SkillExecutor(skillRegistry);

  // 启动 MCP 服务器（如果配置了）
  try {
    await startMCP();
  } catch (error) {
    console.warn(t("mcp.startupFailed"), error instanceof Error ? error.message : String(error));
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
      skillExecutor,
      childAgentTimeout: params.childAgentTimeout,
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
    .description(t("commands.chat.description"))
    .option("-m, --message <text>", t("commands.chat.options.once"))
    .option(
      "-p, --provider <name>",
      `${t("commands.chat.options.provider")} ${providerRegistry.list().join(", ")}`,
    )
    .option("-r, --role <name>", t("commands.chat.options.role"))
    .option("--debug", t("commands.chat.options.debug"))
    .option(
      "--debug-format <format>",
      t("commands.chat.options.debugFormat"),
    )
    .option(
      "--permission-mode <mode>",
      t("commands.chat.options.permissionMode"),
    )
    .option(
      "--multi",
      t("commands.chat.options.multiAgent"),
    )
    .action(async (options: ChatOptions) => {
      const cwd = process.cwd();
      const loadedSettings = await loadWastelandSettings({
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
          childAgentTimeout: loadedSettings.settings.runtime.childAgentTimeout,
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
          childAgentTimeout: loadedSettings.settings.runtime.childAgentTimeout,
          render: { style: "classic" }, // 管道输入使用经典样式
        });
        return;
      }

      if (!process.stdin.isTTY) {
        throw new Error(t("commands.chat.errors.emptyStdin"));
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
          childAgentTimeout: loadedSettings.settings.runtime.childAgentTimeout,
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
