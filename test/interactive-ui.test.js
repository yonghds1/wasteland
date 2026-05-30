import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";

import { of } from "rxjs";

import { createInteractiveTurnStream } from "../dist/ui/readline-input.js";
import { renderRuntimeEvents } from "../dist/ui/terminal-renderer.js";

function stripAnsi(text) {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function streamToString(stream) {
  let output = "";

  stream.on("data", (chunk) => {
    output += chunk.toString();
  });

  return () => output;
}

it("interactive input handles local slash commands without sending them to runtime", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const getOutput = streamToString(output);
  const interactive = createInteractiveTurnStream({ input, output });
  const turns = [];

  interactive.turns$.subscribe((turn) => {
    turns.push(turn);
  });

  interactive.prompt();
  input.write("/help\n");
  input.write("/tools\n");
  input.write("/read README.md\n");
  input.write("/exit\n");

  await interactive.done;

  const rendered = stripAnsi(getOutput());

  expect(turns.length).toBe(1);
  expect(turns[0].content).toBe("/read README.md");
  expect(rendered).toMatch(/Prompt: >\s+Replies: wasteland/);
  expect(rendered).toMatch(/\n> /);
  expect(rendered).toMatch(/local/);
  expect(rendered).toMatch(/│  Session commands/);
  expect(rendered).toMatch(/Current local tool syntax\n│  \/read <relative-path>\n│  \/bash <command>\n\n> /);
  expect(rendered).toMatch(/Session commands/);
  expect(rendered).toMatch(/Current local tool syntax/);
});

it("interactive renderer uses codex-like layout", async () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const getStdout = streamToString(stdout);

  await renderRuntimeEvents(
    of(
      {
        type: "tool_call_requested",
        sessionId: "session-1",
        turn: 1,
        callId: "call-1",
        toolName: "read-file",
        input: {
          path: "README.md",
        },
      },
      {
        type: "tool_result",
        sessionId: "session-1",
        turn: 1,
        callId: "call-1",
        toolName: "read-file",
        output: "hello\nworld",
      },
      {
        type: "assistant_message",
        sessionId: "session-1",
        turn: 1,
        content: "done",
      },
    ),
    {
      stdout,
      stderr,
      style: "interactive",
    },
  );

  const rendered = stripAnsi(getStdout());

  // Hermes 风格: ┊ {emoji} {verb:9} {detail}
  expect(rendered).toMatch(/read/);
  expect(rendered).toMatch(/wasteland/);
  expect(rendered).toMatch(/│  done/);
  expect(rendered).toMatch(/│  done\n\n$/);
  expect(rendered).not.toMatch(/assistant\[1\]/);
});

it("interactive renderer wraps streamed assistant output to panel width", async () => {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const getStdout = streamToString(stdout);

  stdout.columns = 20;

  await renderRuntimeEvents(
    of(
      {
        type: "assistant_chunk",
        sessionId: "session-2",
        turn: 1,
        chunk: "abcdefghijklmnopqrstuvwxyz1234",
      },
      {
        type: "assistant_message",
        sessionId: "session-2",
        turn: 1,
        content: "abcdefghijklmnopqrstuvwxyz1234",
      },
    ),
    {
      stdout,
      stderr,
      style: "interactive",
    },
  );

  const rendered = stripAnsi(getStdout());

  // 新格式包含时间戳: joe HH:MM:SS.mmm
  expect(rendered).toMatch(/wasteland \d{2}:\d{2}:\d{2}\.\d{3}\n│  abcdefghijklmnopqrstuvwx\n│  yz1234\n\n$/);
});
