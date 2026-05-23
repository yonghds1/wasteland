import { appendFile, mkdir } from "node:fs/promises";
import type { Writable } from "node:stream";

import type { Observable } from "rxjs";

import type { DebugTraceEvent } from "../runtime/debug-events.js";
import { ANSI, formatStatusLabel, paint } from "./terminal-theme.js";

function supportsAnsi(output: Writable): boolean {
  return "isTTY" in output && output.isTTY === true;
}

function maybePaint(output: Writable, text: string, ...styles: string[]): string {
  if (!supportsAnsi(output) || styles.length === 0) {
    return text;
  }

  return paint(text, ...styles);
}

function formatDebugValue(value: unknown): string {
  if (typeof value === "string") {
    return /\s/.test(value) ? JSON.stringify(value) : value;
  }

  if (
    typeof value === "number"
    || typeof value === "boolean"
    || value === null
    || value === undefined
  ) {
    return String(value);
  }

  return JSON.stringify(value);
}

function formatDebugData(data?: Record<string, unknown>): string[] {
  if (!data) {
    return [];
  }

  return Object.entries(data)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatDebugValue(value)}`);
}

function renderPrettyEvent(output: Writable, event: DebugTraceEvent): void {
  const parts = [`turn=${event.turn}`];

  if (event.turn === undefined) {
    parts.length = 0;
  }

  if (event.step !== undefined) {
    parts.push(`step=${event.step}`);
  }

  parts.push(event.phase);
  parts.push(...formatDebugData(event.data));

  output.write(
    `${maybePaint(output, formatStatusLabel("trace"), ANSI.dim, ANSI.gray)} ${maybePaint(output, parts.join(" "), ANSI.dim, ANSI.brightWhite)}\n`,
  );
}

function renderJsonlLine(event: DebugTraceEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export type DebugFormat = "pretty" | "jsonl";

export type DebugRendererParams = {
  output?: Writable;
  format?: DebugFormat;
  traceDir?: string;
};

export async function renderDebugTrace(
  events$: Observable<DebugTraceEvent>,
  params?: DebugRendererParams,
): Promise<void> {
  const output = params?.output ?? process.stderr;
  const format = params?.format ?? "pretty";
  const traceDir = params?.traceDir;

  // Pre-create trace directory if needed (for jsonl format)
  if (format === "jsonl" && traceDir) {
    try {
      await mkdir(traceDir, { recursive: true });
    } catch {
      // Silently ignore directory creation errors
    }
  }

  await new Promise<void>((resolve, reject) => {
    let traceFilePath: string | null = null;

    events$.subscribe({
      next: (event) => {
        if (format === "jsonl") {
          const line = renderJsonlLine(event);
          // Always write JSONL to stderr for piping
          output.write(line);

          // Initialize trace file path from first event's sessionId
          if (traceDir && !traceFilePath && event.sessionId) {
            traceFilePath = `${traceDir}/${event.sessionId}.jsonl`;
          }

          // Write to trace file if path is set
          if (traceFilePath) {
            appendFile(traceFilePath, line, "utf8").catch(() => {
              // Silently ignore file write errors
            });
          }
        } else {
          renderPrettyEvent(output, event);
        }
      },
      error: reject,
      complete: resolve,
    });
  });
}
