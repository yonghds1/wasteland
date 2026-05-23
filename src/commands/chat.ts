import type { Observable } from "rxjs";
import { Command } from "commander";

import { loadRxcSettings } from "../config/load-settings.js";
import { resolveDefaultSessionDir } from "../config/paths.js";
import { resolveChatRuntime } from "../config/resolve-chat-runtime.js";
import type { AgentProvider } from "../providers/provider-types.js";
import { createDefaultProviderRegistry } from "../providers/provider-registry.js";
import type { ChatInputTurn, RuntimeMode } from "../runtime/event-types.js";
import { runAgentLoop } from "../runtime/agent-loop.js";
import { createPermissionGate } from "../runtime/permission-gate.js";
import { SessionManager } from "../runtime/session-manager.js";
import { createDefaultToolRegistry } from "../tools/default-registry.js";
import { renderDebugTrace } from "../ui/debug-renderer.js";
import { createInteractiveTurnStream, createSingleTurnInput, readPipedInput } from "../ui/readline-input.js";
import { renderRuntimeEvents } from "../ui/terminal-renderer.js";

type ChatOptions = {
  debug?: boolean;
  message?: string;
  provider?: string;
  role?: string;
  permissionMode?: string;
};

function resolvePermissionMode(value: string | undefined) {
  const mode = value ?? "default";

  if (mode === "default" || mode === "accept_edits" || mode === "bypass_permissions") {
    return mode;
  }

  throw new Error(`当前不支持 permission mode: ${mode}`);
}

async function runChatSession(params: {
  input$: Observable<ChatInputTurn>;
  provider: AgentProvider;
  sessionManager: SessionManager;
  cwd: string;
  mode: RuntimeMode;
  debug: boolean;
  permissionMode: ReturnType<typeof resolvePermissionMode>;
  maxStepsPerTurn: number;
  render?: {
    onTurnComplete?: () => void;
    style?: "classic" | "interactive";
  };
}): Promise<void> {
  const run = runAgentLoop({
    input$: params.input$,
    provider: params.provider,
    sessionManager: params.sessionManager,
    toolRegistry: createDefaultToolRegistry(),
    permissionGate: createPermissionGate({
      mode: params.permissionMode,
    }),
    cwd: params.cwd,
    mode: params.mode,
    maxStepsPerTurn: params.maxStepsPerTurn,
  });
  const work = [
    renderRuntimeEvents(run.events$, params.render),
  ];

  if (params.debug) {
    work.unshift(
      renderDebugTrace(run.debug$, {
        output: process.stderr,
      }),
    );
  }

  await Promise.all(work);
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
      "--permission-mode <mode>",
      "权限模式：default | accept_edits | bypass_permissions",
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
      const maxStepsPerTurn = loadedSettings.settings.runtime.maxStepsPerTurn;

      if (options.message?.trim()) {
        await runChatSession({
          input$: createSingleTurnInput(options.message, "message"),
          provider,
          sessionManager,
          cwd,
          mode: "single",
          debug,
          permissionMode,
          maxStepsPerTurn,
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
          permissionMode,
          maxStepsPerTurn,
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
          permissionMode,
          maxStepsPerTurn,
          render: {
            onTurnComplete: interactive.prompt,
            style: "interactive",
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
