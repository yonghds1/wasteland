import type { Writable } from "node:stream";

import type { Observable } from "rxjs";

import type { RuntimeEvent } from "../runtime/event-types.js";
import type { PermissionDecisionKind } from "../runtime/permission-gate.js";
import { ANSI, PANEL_GUTTER, formatStatusLabel, indentBlock, paint, resolvePanelWidth, wrapText } from "./terminal-theme.js";

// ============================================================
// 配置常量
// ============================================================

/** 工具输出在终端显示的最大行数 */
const MAX_TOOL_OUTPUT_LINES = 40;

/** 头部和尾部各显示的行数（用于智能截断） */
const SMART_TRUNCATE_HEAD_LINES = 15;
const SMART_TRUNCATE_TAIL_LINES = 15;

// ============================================================
// 辅助函数
// ============================================================

/**
 * 智能截断文件输出
 *
 * 对于文件输出（以 📄 开头），保留头部和尾部，中间用省略符连接。
 * 这样用户可以看到文件开头和结尾的内容。
 *
 * @param output - 原始输出内容
 * @param maxLines - 最大显示行数
 * @returns 处理后的输出
 */
function smartTruncateFileOutput(output: string, maxLines: number = MAX_TOOL_OUTPUT_LINES): string {
  const lines = output.split("\n");

  if (lines.length <= maxLines) {
    return output;
  }

  // 检查是否是文件输出（以 📄 开头）
  const isFileOutput = output.startsWith("📄");

  // 如果是文件输出且已经有 "... lines hidden"，说明工具层已截断
  // 我们需要保留尾部可见，避免双重截断
  if (isFileOutput && output.includes("lines hidden")) {
    // 找到 "lines hidden" 行的位置
    const hiddenLineIndex = lines.findIndex((line) => line.includes("lines hidden"));

    if (hiddenLineIndex > 0 && hiddenLineIndex < lines.length - 1) {
      // 工具已截断，显示：头部 + 省略 + 尾部
      const headerLines = lines.slice(0, Math.min(SMART_TRUNCATE_HEAD_LINES, hiddenLineIndex + 1));
      const tailLines = lines.slice(-SMART_TRUNCATE_TAIL_LINES);
      const middleHiddenCount = lines.length - headerLines.length - tailLines.length;

      if (middleHiddenCount > 0) {
        return [
          ...headerLines,
          `... ${middleHiddenCount} lines hidden in terminal display`,
          ...tailLines,
        ].join("\n");
      }
    }
  }

  // 普通截断：只显示头部
  const visibleLines = lines.slice(0, maxLines);
  const hiddenCount = lines.length - maxLines;

  if (isFileOutput) {
    return [...visibleLines, `... ${hiddenCount} more lines (output truncated)`].join("\n");
  }

  return [...visibleLines, `... (${hiddenCount} more lines)`].join("\n");
}

/**
 * 截断长输出以适应终端显示
 *
 * @param output - 原始输出内容
 * @param maxLines - 最大显示行数
 * @returns 处理后的输出（可能包含截断提示）
 */
function truncateOutputForDisplay(output: string, maxLines: number = MAX_TOOL_OUTPUT_LINES): string {
  const lines = output.split("\n");

  if (lines.length <= maxLines) {
    return output;
  }

  // 使用智能截断
  return smartTruncateFileOutput(output, maxLines);
}

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
                labelStyles: [ANSI.bold, ANSI.magenta],
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
                labelStyles: [ANSI.bold, ANSI.cyan],
                segments: [
                  {
                    text: `${event.toolName} → `,
                    styles: [ANSI.brightWhite],
                  },
                  {
                    text: event.decision,
                    styles: [ANSI.bold, ...resolveDecisionStyles(event.decision)],
                  },
                  {
                    text: ` (${event.mode})`,
                    styles: [ANSI.dim, ANSI.gray],
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
                labelStyles: [ANSI.bold, ANSI.blue],
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
              // 截断长输出以适应终端显示
              const displayOutput = truncateOutputForDisplay(event.output);
              writeInteractiveBlock(stdout, {
                label: "tool",
                content: [`result ${event.toolName}`, displayOutput.length > 0 ? displayOutput : "(no output)"].join("\n"),
                styles: [ANSI.bold, ANSI.green],
                width: panelWidth,
              });
              break;
            }

            // Classic 模式也截断
            const classicOutput = truncateOutputForDisplay(event.output);
            stdout.write(`tool[${event.turn}]> result ${event.toolName}: ${classicOutput}\n`);
            break;
          }
          case "tool_failed": {
            if (style === "interactive") {
              flushTurnSpacing(event.turn);
              writeInteractiveBlock(stdout, {
                label: "tool",
                content: `failed ${event.toolName}\n${event.error}`,
                styles: [ANSI.bold, ANSI.red],
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
