import { once } from "node:events";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import { filter, from, fromEvent, map, scan, takeUntil, tap, type Observable } from "rxjs";

import type { ChatInputTurn } from "../runtime/event-types.js";
import { ANSI, paint } from "./terminal-theme.js";

const EXIT_COMMANDS = new Set(["/exit", "/quit"]);
const LOCAL_COMMANDS = new Set(["/help", "/tools", "/clear"]);

function createInteractiveIntro(): string {
  return [
    paint("rxc interactive", ANSI.bold, ANSI.cyan),
    paint("Commands: /help /tools /clear /exit", ANSI.dim, ANSI.gray),
  ].join("\n");
}

function createHelpText(): string {
  return [
    paint("Session commands", ANSI.bold, ANSI.cyan),
    "  /help   Show interactive help",
    "  /tools  Show current local tool syntax",
    "  /clear  Clear the terminal and redraw the header",
    "  /exit   Exit interactive mode",
  ].join("\n");
}

function createToolsText(): string {
  return [
    paint("Current local tool syntax", ANSI.bold, ANSI.cyan),
    "  /read <relative-path>",
    "  /bash <command>",
  ].join("\n");
}

export type InteractiveTurnStream = {
  turns$: Observable<ChatInputTurn>;
  prompt: () => void;
  close: () => void;
  done: Promise<void>;
};

export function createSingleTurnInput(
  message: string,
  source: "message" | "stdin",
): Observable<ChatInputTurn> {
  return from([
    {
      turn: 1,
      content: message.trim(),
      source,
    } satisfies ChatInputTurn,
  ]);
}

export async function readPipedInput(stdin: Readable = process.stdin): Promise<string | null> {
  if ("isTTY" in stdin && stdin.isTTY) {
    return null;
  }

  let content = "";

  for await (const chunk of stdin) {
    content += chunk.toString();
  }

  const trimmed = content.trim();

  return trimmed.length > 0 ? trimmed : null;
}

export function createInteractiveTurnStream(params?: {
  input?: Readable;
  output?: Writable;
  intro?: string;
  promptText?: string;
}): InteractiveTurnStream {
  const input = params?.input ?? process.stdin;
  const output = params?.output ?? process.stdout;
  const intro = params?.intro ?? createInteractiveIntro();
  const promptText = params?.promptText ?? "> ";

  const rl = createInterface({
    input,
    output,
    prompt: promptText,
  });

  output.write(`${intro}\n`);

  const close$ = fromEvent(rl, "close");

  const turns$ = fromEvent<string>(rl, "line").pipe(
    map((line) => line.trim()),
    tap((line) => {
      if (EXIT_COMMANDS.has(line)) {
        rl.close();
        return;
      }

      if (line === "/help") {
        output.write(`${createHelpText()}\n`);
        rl.prompt();
        return;
      }

      if (line === "/tools") {
        output.write(`${createToolsText()}\n`);
        rl.prompt();
        return;
      }

      if (line === "/clear") {
        output.write("\x1b[2J\x1b[H");
        output.write(`${intro}\n`);
        rl.prompt();
      }
    }),
    takeUntil(close$),
    filter((line) => line.length > 0 && !EXIT_COMMANDS.has(line) && !LOCAL_COMMANDS.has(line)),
    scan<string, ChatInputTurn>(
      (state, line) => ({
        turn: state.turn + 1,
        content: line,
        source: "interactive",
      }),
      {
        turn: 0,
        content: "",
        source: "interactive",
      },
    ),
  );

  return {
    turns$,
    prompt: () => rl.prompt(),
    close: () => rl.close(),
    done: once(rl, "close").then(() => {
      output.write(`${paint("Session ended.", ANSI.dim, ANSI.gray)}\n`);
    }),
  };
}
