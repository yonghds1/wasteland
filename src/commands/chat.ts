import { Command } from "commander";

import { createLocalProvider } from "../providers/local.js";
import { runAgentLoop } from "../runtime/agent-loop.js";
import { createPermissionGate } from "../runtime/permission-gate.js";
import { SessionManager } from "../runtime/session-manager.js";
import { createDefaultToolRegistry } from "../tools/default-registry.js";
import { createInteractiveTurnStream, createSingleTurnInput, readPipedInput } from "../ui/readline-input.js";
import { renderRuntimeEvents } from "../ui/terminal-renderer.js";

type ChatOptions = {
  message?: string;
  provider?: string;
  permissionMode?: string;
};

function resolveProvider(providerName: string) {
  if (providerName === "local") {
    return createLocalProvider();
  }

  throw new Error(`当前不支持 provider: ${providerName}`);
}

function resolvePermissionMode(value: string | undefined) {
  const mode = value ?? "default";

  if (mode === "default" || mode === "accept_edits" || mode === "bypass_permissions") {
    return mode;
  }

  throw new Error(`当前不支持 permission mode: ${mode}`);
}

export function createChatCommand(): Command {
  return new Command("chat")
    .description("通过 runtime/provider/ui 边界按 RxJS 流式处理用户输入并生成回复。")
    .option("-m, --message <text>", "单次输入，适合脚本或测试")
    .option("-p, --provider <name>", "provider 名称，当前仅支持 local", "local")
    .option(
      "--permission-mode <mode>",
      "权限模式：default | accept_edits | bypass_permissions",
      "default",
    )
    .action(async (options: ChatOptions) => {
      const provider = resolveProvider(options.provider ?? "local");
      const sessionManager = new SessionManager();
      const toolRegistry = createDefaultToolRegistry();
      const permissionGate = createPermissionGate({
        mode: resolvePermissionMode(options.permissionMode),
      });

      if (options.message?.trim()) {
        await renderRuntimeEvents(
          runAgentLoop({
            input$: createSingleTurnInput(options.message, "message"),
            provider,
            sessionManager,
            toolRegistry,
            permissionGate,
            cwd: process.cwd(),
            mode: "single",
          }),
        );
        return;
      }

      const pipedInput = await readPipedInput(process.stdin);

      if (pipedInput) {
        await renderRuntimeEvents(
          runAgentLoop({
            input$: createSingleTurnInput(pipedInput, "stdin"),
            provider,
            sessionManager,
            toolRegistry,
            permissionGate,
            cwd: process.cwd(),
            mode: "single",
          }),
        );
        return;
      }

      if (!process.stdin.isTTY) {
        throw new Error("stdin 输入为空，无法启动会话。");
      }

      const interactive = createInteractiveTurnStream();

      interactive.prompt();

      try {
        await renderRuntimeEvents(
          runAgentLoop({
            input$: interactive.turns$,
            provider,
            sessionManager,
            toolRegistry,
            permissionGate,
            cwd: process.cwd(),
            mode: "interactive",
          }),
          {
            onTurnComplete: interactive.prompt,
            style: "interactive",
          },
        );
      } catch (error) {
        interactive.close();
        await interactive.done;
        throw error;
      }

      await interactive.done;
    });
}
