import { once } from "node:events";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import { filter, from, fromEvent, map, scan, takeUntil, tap, type Observable } from "rxjs";

import type { ChatInputTurn } from "../runtime/event-types.js";
import {
  ANSI,
  PANEL_GUTTER,
  indentBlock,
  paint,
  resolvePanelWidth,
  wrapText,
} from "./terminal-theme.js";

const EXIT_COMMANDS = new Set(["/exit", "/quit"]);
const LOCAL_COMMANDS = new Set(["/help", "/tools", "/clear"]);

function createInteractiveIntro(): string {
  return [
    paint("rxc interactive", ANSI.bold, ANSI.cyan),
    paint("Prompt: >    Replies: rxc", ANSI.bold, ANSI.brightWhite),
    paint("Commands: /help /tools /clear /exit", ANSI.brightWhite),
  ].join("\n");
}

function createLocalOutput(title: string, lines: string[], columns?: number): string {
  return [
    paint("local", ANSI.bold, ANSI.gray),
    indentBlock(wrapText([title, ...lines].join("\n"), resolvePanelWidth(columns)), PANEL_GUTTER),
  ].join("\n");
}

function createHelpText(columns?: number): string {
  return createLocalOutput("Session commands", [
    "/help   Show interactive help",
    "/tools  Show current local tool syntax",
    "/clear  Clear the terminal and redraw the header",
    "/exit   Exit interactive mode",
  ], columns);
}

function createToolsText(columns?: number): string {
  return createLocalOutput("Current local tool syntax", ["/read <relative-path>", "/bash <command>"], columns);
}

function resolveOutputColumns(output: Writable): number | undefined {
  return "columns" in output && typeof output.columns === "number" ? output.columns : undefined;
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

  function renderPrompt(): void {
    output.write(ANSI.reset);
    rl.setPrompt(promptText);
    rl.prompt();
  }

  const close$ = fromEvent(rl, "close");

  const turns$ = fromEvent<string>(rl, "line").pipe(
    map((line) => line.trim()),
    tap((line) => {
      if (EXIT_COMMANDS.has(line)) {
        rl.close();
        return;
      }

      if (line === "/help") {
        output.write(`${ANSI.reset}\n${createHelpText("columns" in output ? output.columns : undefined)}\n\n`);
        renderPrompt();
        return;
      }

      if (line === "/tools") {
        output.write(`${ANSI.reset}\n${createToolsText("columns" in output ? output.columns : undefined)}\n\n`);
        renderPrompt();
        return;
      }

      if (line === "/clear") {
        output.write(`${ANSI.reset}\x1b[2J\x1b[H`);
        output.write(`${intro}\n`);
        renderPrompt();
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
    prompt: renderPrompt,
    close: () => rl.close(),
    done: once(rl, "close").then(() => {
      output.write(`${ANSI.reset}${paint("Session ended.", ANSI.dim, ANSI.gray)}\n`);
    }),
  };
}
