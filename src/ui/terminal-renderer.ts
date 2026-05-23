import type { Writable } from "node:stream";

import type { Observable } from "rxjs";

import type { RuntimeEvent } from "../runtime/event-types.js";
import { ANSI, indentBlock, paint } from "./terminal-theme.js";

function writeInteractiveAssistantLabel(stdout: Writable): void {
  stdout.write(`${paint("rxc", ANSI.bold, ANSI.cyan)}\n`);
}

function formatInteractiveChunk(chunk: string): string {
  return chunk.replace(/\n/g, "\n  ");
}

export async function renderRuntimeEvents(
  events$: Observable<RuntimeEvent>,
  params?: {
    stdout?: Writable;
    stderr?: Writable;
    onTurnComplete?: () => void;
    style?: "classic" | "interactive";
  },
): Promise<void> {
  const stdout = params?.stdout ?? process.stdout;
  const stderr = params?.stderr ?? process.stderr;
  const style = params?.style ?? "classic";
  const chunkedTurns = new Set<number>();

  await new Promise<void>((resolve, reject) => {
    events$.subscribe({
      next: (event) => {
        switch (event.type) {
          case "assistant_chunk": {
            if (style === "interactive") {
              if (!chunkedTurns.has(event.turn)) {
                writeInteractiveAssistantLabel(stdout);
                stdout.write("  ");
                chunkedTurns.add(event.turn);
              }

              stdout.write(formatInteractiveChunk(event.chunk));
              break;
            }

            if (!chunkedTurns.has(event.turn)) {
              stdout.write(`assistant[${event.turn}]> `);
              chunkedTurns.add(event.turn);
            }

            stdout.write(event.chunk);
            break;
          }
          case "assistant_message": {
            if (style === "interactive") {
              if (chunkedTurns.has(event.turn)) {
                stdout.write("\n");
                chunkedTurns.delete(event.turn);
              } else {
                writeInteractiveAssistantLabel(stdout);
                stdout.write(`${indentBlock(event.content)}\n`);
              }

              params?.onTurnComplete?.();
              break;
            }

            if (chunkedTurns.has(event.turn)) {
              stdout.write("\n");
              chunkedTurns.delete(event.turn);
            } else {
              stdout.write(`assistant[${event.turn}]> ${event.content}\n`);
            }

            params?.onTurnComplete?.();
            break;
          }
          case "tool_call_requested": {
            if (style === "interactive") {
              stdout.write(`${paint("tool", ANSI.dim, ANSI.yellow)} request ${event.toolName}\n`);
              break;
            }

            stdout.write(`tool[${event.turn}]> request ${event.toolName}\n`);
            break;
          }
          case "permission_decision": {
            if (style === "interactive") {
              stdout.write(
                `${paint("perm", ANSI.dim, ANSI.gray)} ${event.toolName} -> ${event.decision} (${event.mode})\n`,
              );
              break;
            }

            stdout.write(
              `permission[${event.turn}]> ${event.toolName}: ${event.decision} (${event.mode})\n`,
            );
            break;
          }
          case "tool_started": {
            if (style === "interactive") {
              stdout.write(`${paint("tool", ANSI.dim, ANSI.yellow)} start ${event.toolName}\n`);
              break;
            }

            stdout.write(`tool[${event.turn}]> start ${event.toolName}\n`);
            break;
          }
          case "tool_result": {
            if (style === "interactive") {
              stdout.write(
                `${paint("tool", ANSI.dim, ANSI.green)} result ${event.toolName}\n${indentBlock(
                  event.output.length > 0 ? event.output : "(no output)",
                )}\n`,
              );
              params?.onTurnComplete?.();
              break;
            }

            stdout.write(`tool[${event.turn}]> result ${event.toolName}: ${event.output}\n`);
            params?.onTurnComplete?.();
            break;
          }
          case "tool_failed": {
            if (style === "interactive") {
              stdout.write(
                `${paint("tool", ANSI.dim, ANSI.red)} failed ${event.toolName}\n${indentBlock(
                  event.error,
                )}\n`,
              );
              params?.onTurnComplete?.();
              break;
            }

            stdout.write(`tool[${event.turn}]> failed ${event.toolName}: ${event.error}\n`);
            params?.onTurnComplete?.();
            break;
          }
          case "session_ended": {
            break;
          }
          case "session_started":
          case "user_turn": {
            break;
          }
          default: {
            stderr.write(`未处理的运行时事件：${JSON.stringify(event)}\n`);
          }
        }
      },
      error: reject,
      complete: resolve,
    });
  });
}
