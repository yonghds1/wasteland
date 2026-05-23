import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { lastValueFrom, toArray } from "rxjs";

import { createPermissionGate } from "../dist/runtime/permission-gate.js";
import { SessionManager } from "../dist/runtime/session-manager.js";
import { dispatchToolCall } from "../dist/runtime/tool-dispatch.js";
import { ToolRegistry } from "../dist/tools/tool-registry.js";

test("permission gate applies default and bypass permission modes", () => {
  const defaultGate = createPermissionGate();
  const bypassGate = createPermissionGate({ mode: "bypass_permissions" });

  const defaultRead = defaultGate.evaluate(
    {
      id: "call-read",
      toolName: "read-file",
      input: {},
    },
    "read",
  );
  const defaultExecute = defaultGate.evaluate(
    {
      id: "call-exec",
      toolName: "bash",
      input: {},
    },
    "execute",
  );
  const bypassExecute = bypassGate.evaluate(
    {
      id: "call-bypass",
      toolName: "bash",
      input: {},
    },
    "execute",
  );

  assert.equal(defaultRead.decision, "allow");
  assert.equal(defaultRead.mode, "default");
  assert.equal(defaultExecute.decision, "ask");
  assert.equal(defaultExecute.mode, "default");
  assert.equal(bypassExecute.decision, "allow");
  assert.equal(bypassExecute.mode, "bypass_permissions");
});

test("dispatchToolCall persists an allowed tool lifecycle", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-tool-runtime-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const sessionManager = new SessionManager(sessionDir);
  const session = await sessionManager.startSession({
    cwd: tempRoot,
    mode: "single",
    providerId: "local",
  });

  const registry = new ToolRegistry([
    {
      name: "read-project",
      riskLevel: "read",
      async execute(_input, context) {
        return {
          status: "success",
          output: `cwd=${context.cwd}`,
        };
      },
    },
  ]);

  const events = await lastValueFrom(
    dispatchToolCall({
      session,
      sessionManager,
      turn: 1,
      call: {
        id: "tool-call-1",
        toolName: "read-project",
        input: {},
      },
      registry,
      permissionGate: createPermissionGate(),
      cwd: tempRoot,
    }).pipe(toArray()),
  );

  assert.deepEqual(events.map((event) => event.type), [
    "tool_call_requested",
    "permission_decision",
    "tool_started",
    "tool_result",
  ]);

  const files = await readdir(sessionDir);

  assert.equal(files.length, 1);

  const transcript = await readFile(path.join(sessionDir, files[0]), "utf8");

  assert.match(transcript, /"type":"tool_call"/);
  assert.match(transcript, /"type":"permission"/);
  assert.match(transcript, /"type":"tool_result"/);
  assert.match(transcript, /"status":"success"/);
});

test("dispatchToolCall blocks execution when permission is not granted", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "rxc-tool-runtime-blocked-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const sessionManager = new SessionManager(sessionDir);
  const session = await sessionManager.startSession({
    cwd: tempRoot,
    mode: "single",
    providerId: "local",
  });

  const registry = new ToolRegistry([
    {
      name: "bash",
      riskLevel: "execute",
      async execute() {
        return {
          status: "success",
          output: "should-not-run",
        };
      },
    },
  ]);

  const events = await lastValueFrom(
    dispatchToolCall({
      session,
      sessionManager,
      turn: 1,
      call: {
        id: "tool-call-2",
        toolName: "bash",
        input: {
          command: "pwd",
        },
      },
      registry,
      permissionGate: createPermissionGate(),
      cwd: tempRoot,
    }).pipe(toArray()),
  );

  assert.deepEqual(events.map((event) => event.type), [
    "tool_call_requested",
    "permission_decision",
    "tool_failed",
  ]);
  assert.equal(events[1].decision, "ask");
  assert.equal(events[2].status, "blocked");
  assert.match(events[2].error, /要求确认/);

  const files = await readdir(sessionDir);
  const transcript = await readFile(path.join(sessionDir, files[0]), "utf8");

  assert.match(transcript, /"type":"permission"/);
  assert.match(transcript, /"status":"blocked"/);
});
