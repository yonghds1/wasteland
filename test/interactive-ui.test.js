import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";

import { of } from "rxjs";

import { createInteractiveTurnStream } from "../dist/ui/readline-input.js";
import { renderRuntimeEvents } from "../dist/ui/terminal-renderer.js";

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

  assert.equal(turns.length, 1);
  assert.equal(turns[0].content, "/read README.md");
  assert.match(getOutput(), /Session commands/);
  assert.match(getOutput(), /Current local tool syntax/);
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

  const rendered = getStdout();

  assert.match(rendered, /tool/);
  assert.match(rendered, /result read-file/);
  assert.match(rendered, /rxc/);
  assert.doesNotMatch(rendered, /assistant\[1\]/);
});
