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

export async function renderDebugTrace(
  events$: Observable<DebugTraceEvent>,
  params?: {
    output?: Writable;
  },
): Promise<void> {
  const output = params?.output ?? process.stderr;

  await new Promise<void>((resolve, reject) => {
    events$.subscribe({
      next: (event) => {
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
      },
      error: reject,
      complete: resolve,
    });
  });
}
