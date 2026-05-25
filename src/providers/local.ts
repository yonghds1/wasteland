import { of } from "rxjs";

import { buildLocalReplyText } from "../chat/reply-pipeline.js";
import type { TurnToolResult } from "../runtime/turn-state.js";
import { createAssistantTextEvents } from "./assistant-events.js";
import type { AgentProvider, ProviderStreamEvent } from "./provider-types.js";

function createToolCallFromInput(input: string, turn: number): ProviderStreamEvent | null {
  const trimmed = input.trim();

  // /spawn <name> <task> - 创建子 Agent
  if (trimmed.startsWith("/spawn ")) {
    const rest = trimmed.slice("/spawn ".length).trim();
    const firstSpace = rest.indexOf(" ");

    if (firstSpace === -1 || firstSpace === 0) {
      return null;
    }

    const name = rest.slice(0, firstSpace).trim();
    const task = rest.slice(firstSpace + 1).trim();

    if (name.length === 0 || task.length === 0) {
      return null;
    }

    return {
      type: "tool_call",
      call: {
        id: `tool-spawn-${turn}`,
        toolName: "spawn_agent",
        input: {
          name,
          task,
        },
      },
    };
  }

  // /read <path> - 读取文件
  if (trimmed.startsWith("/read ")) {
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

  // /bash <command> - 执行命令
  if (trimmed.startsWith("/bash ")) {
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

  // /glob <pattern> - 查找文件
  if (trimmed.startsWith("/glob ")) {
    const pattern = trimmed.slice("/glob ".length).trim();

    if (pattern.length === 0) {
      return null;
    }

    return {
      type: "tool_call",
      call: {
        id: `tool-glob-${turn}`,
        toolName: "glob",
        input: {
          pattern,
        },
      },
    };
  }

  // /grep <pattern> - 搜索文本
  if (trimmed.startsWith("/grep ")) {
    const pattern = trimmed.slice("/grep ".length).trim();

    if (pattern.length === 0) {
      return null;
    }

    return {
      type: "tool_call",
      call: {
        id: `tool-grep-${turn}`,
        toolName: "grep",
        input: {
          pattern,
        },
      },
    };
  }

  // /list-directory [path] - 列出目录
  if (trimmed.startsWith("/list-directory")) {
    const rest = trimmed.slice("/list-directory".length).trim();
    const path = rest.length > 0 ? rest : ".";

    return {
      type: "tool_call",
      call: {
        id: `tool-list-directory-${turn}`,
        toolName: "list-directory",
        input: {
          path,
        },
      },
    };
  }

  // /web-fetch <url> [method] [body] - 网络请求
  if (trimmed.startsWith("/web-fetch ")) {
    const rest = trimmed.slice("/web-fetch ".length).trim();
    const parts = rest.split(/\s+/);

    if (parts.length === 0 || parts[0].length === 0) {
      return null;
    }

    const url = parts[0];
    const method = parts.length > 1 ? parts[1].toUpperCase() : "GET";
    const body = parts.length > 2 ? parts.slice(2).join(" ") : undefined;

    const toolInput: Record<string, unknown> = { url, method };
    if (body) {
      try {
        toolInput.body = JSON.parse(body);
      } catch {
        toolInput.body = body;
      }
    }

    return {
      type: "tool_call",
      call: {
        id: `tool-web-fetch-${turn}`,
        toolName: "web-fetch",
        input: toolInput,
      },
    };
  }

  return null;
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
