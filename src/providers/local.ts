import { of } from "rxjs";

import { buildLocalReplyText } from "../chat/reply-pipeline.js";
import type { TurnToolResult } from "../runtime/turn-state.js";
import { createAssistantTextEvents } from "./assistant-events.js";
import type { AgentProvider, ProviderStreamEvent } from "./provider-types.js";

function createToolCallFromInput(input: string, turn: number): ProviderStreamEvent | null {
  const trimmed = input.trim();

  if (!trimmed.startsWith("/read ")) {
    if (!trimmed.startsWith("/bash ")) {
      return null;
    }

    const command = trimmed.slice("/bash ".length).trim();

    if (command.length === 0) {
      return null;
    }

    return {
      type: "tool_call",
      call: {
        id: `tool-bash-${turn}`,
        toolName: "bash",
        input: {
          command,
        },
      },
    };
  }

  const targetPath = trimmed.slice("/read ".length).trim();

  if (targetPath.length === 0) {
    return null;
  }

  return {
    type: "tool_call",
    call: {
      id: `tool-read-file-${turn}`,
      toolName: "read-file",
      input: {
        path: targetPath,
      },
    },
  };
}

function buildToolResultReply(result: TurnToolResult): string {
  if (result.status === "success") {
    return [
      `工具 ${result.toolName} 已完成。`,
      result.output && result.output.length > 0 ? result.output : "(no output)",
    ].join("\n");
  }

  if (result.status === "blocked") {
    return `工具 ${result.toolName} 未执行：${result.error ?? "权限未通过。"}`;
  }

  return `工具 ${result.toolName} 执行失败：${result.error ?? "未知错误。"}`;
}

export function createLocalProvider(): AgentProvider {
  return {
    id: "local",
    runStep({ context, state }) {
      const latestToolResult = state.toolResults[state.toolResults.length - 1];

      if (latestToolResult) {
        return createAssistantTextEvents(buildToolResultReply(latestToolResult));
      }

      const toolCall = createToolCallFromInput(context.input.content, context.turn);

      if (toolCall) {
        return of(toolCall);
      }

      const text = buildLocalReplyText({
        input: context.input.content,
        turn: context.turn,
        historyLength: context.history.length,
      });

      return createAssistantTextEvents(text);
    },
  };
}
