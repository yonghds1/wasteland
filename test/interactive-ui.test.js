import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";

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

test("interactive input handles local slash commands without sending them to runtime", async () => {
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

  assert.equal(turns.length, 1);
  assert.equal(turns[0].content, "/read README.md");
  assert.match(rendered, /Prompt: >\s+Replies: rxc/);
  assert.match(rendered, /\n> /);
  assert.match(rendered, /local/);
  assert.match(rendered, /│  Session commands/);
  assert.match(rendered, /Current local tool syntax\n│  \/read <relative-path>\n│  \/bash <command>\n\n> /);
  assert.match(rendered, /Session commands/);
  assert.match(rendered, /Current local tool syntax/);
});

test("interactive renderer uses codex-like layout", async () => {
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

  assert.match(rendered, /tool/);
  assert.match(rendered, /tool request read-file/);
  assert.match(rendered, /tool \d{2}:\d{2}:\d{2}\.\d{3}\n│  result read-file/);
  assert.match(rendered, /rxc/);
  assert.match(rendered, /│  hello/);
  assert.match(rendered, /│  done/);
  assert.match(rendered, /│  done\n\n$/);
  assert.doesNotMatch(rendered, /assistant\[1\]/);
});

test("interactive renderer wraps streamed assistant output to panel width", async () => {
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

  // 新格式包含时间戳: rxc HH:MM:SS.mmm
  assert.match(rendered, /rxc \d{2}:\d{2}:\d{2}\.\d{3}\n│  abcdefghijklmnopqrstuvwx\n│  yz1234\n\n$/);
});
