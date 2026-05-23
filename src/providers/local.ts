import { concat, from, map, of } from "rxjs";

import { buildLocalReplyText, splitReplyText } from "../chat/reply-pipeline.js";
import type { TurnContext } from "../runtime/turn-context.js";
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

export function createLocalProvider(): AgentProvider {
  return {
    id: "local",
    streamReply(context: TurnContext) {
      const toolCall = createToolCallFromInput(context.input.content, context.turn);

      if (toolCall) {
        return of(toolCall);
      }

      const text = buildLocalReplyText({
        input: context.input.content,
        turn: context.turn,
        historyLength: context.history.length,
      });

      return concat(
        from(splitReplyText(text)).pipe(
          map(
            (chunk): ProviderStreamEvent => ({
              type: "assistant_chunk",
              text: chunk,
            }),
          ),
        ),
        of<ProviderStreamEvent>({
          type: "assistant_message",
          text,
        }),
      );
    },
  };
}
