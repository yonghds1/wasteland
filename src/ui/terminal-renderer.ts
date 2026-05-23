import type { Writable } from "node:stream";

import type { Observable } from "rxjs";

import type { RuntimeEvent } from "../runtime/event-types.js";
import type { PermissionDecisionKind } from "../runtime/permission-gate.js";
import { ANSI, PANEL_GUTTER, formatStatusLabel, indentBlock, paint, resolvePanelWidth, wrapText } from "./terminal-theme.js";

function writeInteractiveLabel(stdout: Writable, label: string, ...styles: string[]): void {
  stdout.write(`${paint(label, ...styles)}\n`);
}

function writeInteractiveBlock(
  stdout: Writable,
  params: {
    label: string;
    content: string;
    styles: string[];
    width: number;
  },
): void {
  writeInteractiveLabel(stdout, params.label, ...params.styles);
  stdout.write(`${indentBlock(wrapText(params.content, params.width), PANEL_GUTTER)}\n`);
}

function writeInteractiveStatusLine(
  stdout: Writable,
  params: {
    label: string;
    labelStyles: string[];
    segments: Array<{
      text: string;
      styles?: string[];
    }>;
  },
): void {
  const content = params.segments
    .map((segment) => paint(segment.text, ...(segment.styles ?? [])))
    .join("");

  stdout.write(`${paint(formatStatusLabel(params.label), ...params.labelStyles)} ${content}\n`);
}

function createChunkWriter(stdout: Writable, width: number): {
  write: (turn: number, chunk: string) => void;
  close: (turn: number) => void;
} {
  const lineLengths = new Map<number, number>();

  function write(turn: number, chunk: string): void {
    let lineLength = lineLengths.get(turn) ?? 0;

    for (const character of Array.from(chunk)) {
      if (character === "\n") {
        stdout.write(`\n${PANEL_GUTTER}`);
        lineLength = 0;
        continue;
      }

      if (lineLength >= width) {
        stdout.write(`\n${PANEL_GUTTER}`);
        lineLength = 0;
      }

      stdout.write(character);
      lineLength += 1;
    }

    lineLengths.set(turn, lineLength);
  }

  function close(turn: number): void {
    lineLengths.delete(turn);
  }

  return {
    write,
    close,
  };
}

function resolveDecisionStyles(decision: PermissionDecisionKind): string[] {
  if (decision === "allow") {
    return [ANSI.green];
  }

  if (decision === "ask") {
    return [ANSI.yellow];
  }

  return [ANSI.red];
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
  const panelWidth = resolvePanelWidth("columns" in stdout ? stdout.columns : undefined);
  const chunkedTurns = new Set<number>();
  const pendingTurnSpacing = new Set<number>();
  const chunkWriter = createChunkWriter(stdout, panelWidth);

  function flushTurnSpacing(turn: number): void {
    if (!pendingTurnSpacing.has(turn)) {
      return;
    }

    stdout.write("\n");
    pendingTurnSpacing.delete(turn);
  }

  function completeInteractiveTurn(): void {
    stdout.write("\n");
    params?.onTurnComplete?.();
  }

  await new Promise<void>((resolve, reject) => {
    events$.subscribe({
      next: (event) => {
        switch (event.type) {
          case "assistant_chunk": {
            if (style === "interactive") {
              flushTurnSpacing(event.turn);

              if (!chunkedTurns.has(event.turn)) {
                writeInteractiveLabel(stdout, "rxc", ANSI.bold, ANSI.cyan);
                stdout.write(PANEL_GUTTER);
                chunkedTurns.add(event.turn);
              }

              chunkWriter.write(event.turn, event.chunk);
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
              flushTurnSpacing(event.turn);

              if (chunkedTurns.has(event.turn)) {
                stdout.write("\n");
                chunkedTurns.delete(event.turn);
                chunkWriter.close(event.turn);
              } else {
                writeInteractiveBlock(stdout, {
                  label: "rxc",
                  content: event.content,
                  styles: [ANSI.bold, ANSI.cyan],
                  width: panelWidth,
                });
              }

              completeInteractiveTurn();
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
              flushTurnSpacing(event.turn);
              writeInteractiveStatusLine(stdout, {
                label: "tool",
                labelStyles: [ANSI.dim, ANSI.yellow],
                segments: [
                  {
                    text: `request ${event.toolName}`,
                    styles: [ANSI.brightWhite],
                  },
                ],
              });
              break;
            }

            stdout.write(`tool[${event.turn}]> request ${event.toolName}\n`);
            break;
          }
          case "permission_decision": {
            if (style === "interactive") {
              flushTurnSpacing(event.turn);
              writeInteractiveStatusLine(stdout, {
                label: "perm",
                labelStyles: [ANSI.dim, ANSI.gray],
                segments: [
                  {
                    text: `${event.toolName} -> `,
                    styles: [ANSI.brightWhite],
                  },
                  {
                    text: event.decision,
                    styles: [ANSI.bold, ...resolveDecisionStyles(event.decision)],
                  },
                  {
                    text: ` (${event.mode})`,
                    styles: [ANSI.brightWhite],
                  },
                ],
              });
              break;
            }

            stdout.write(
              `permission[${event.turn}]> ${event.toolName}: ${event.decision} (${event.mode})\n`,
            );
            break;
          }
          case "tool_started": {
            if (style === "interactive") {
              flushTurnSpacing(event.turn);
              writeInteractiveStatusLine(stdout, {
                label: "tool",
                labelStyles: [ANSI.dim, ANSI.yellow],
                segments: [
                  {
                    text: `start ${event.toolName}`,
                    styles: [ANSI.brightWhite],
                  },
                ],
              });
              break;
            }

            stdout.write(`tool[${event.turn}]> start ${event.toolName}\n`);
            break;
          }
          case "tool_result": {
            if (style === "interactive") {
              flushTurnSpacing(event.turn);
              writeInteractiveBlock(stdout, {
                label: "tool",
                content: [`result ${event.toolName}`, event.output.length > 0 ? event.output : "(no output)"].join("\n"),
                styles: [ANSI.dim, ANSI.green],
                width: panelWidth,
              });
              break;
            }

            stdout.write(`tool[${event.turn}]> result ${event.toolName}: ${event.output}\n`);
            break;
          }
          case "tool_failed": {
            if (style === "interactive") {
              flushTurnSpacing(event.turn);
              writeInteractiveBlock(stdout, {
                label: "tool",
                content: `failed ${event.toolName}\n${event.error}`,
                styles: [ANSI.dim, ANSI.red],
                width: panelWidth,
              });
              break;
            }

            stdout.write(`tool[${event.turn}]> failed ${event.toolName}: ${event.error}\n`);
            break;
          }
          case "session_ended": {
            break;
          }
          case "session_started":
            break;
          case "user_turn": {
            if (style === "interactive") {
              stdout.write(ANSI.reset);
              pendingTurnSpacing.add(event.turn);
            }

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
