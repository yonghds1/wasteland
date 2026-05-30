import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { lastValueFrom, toArray } from "rxjs";

import { createPermissionGate } from "../dist/core/runtime/permission-gate.js";
import { SessionManager } from "../dist/core/runtime/session-manager.js";
import { dispatchToolCall } from "../dist/core/runtime/tool-dispatch.js";
import { ToolRegistry } from "../dist/tools/tool-registry.js";

describe("tool-runtime", () => {
  it("permission gate applies default and bypass permission modes", () => {
    const defaultGate = createPermissionGate();
    const bypassGate = createPermissionGate({ mode: "bypass_permissions" });

    const defaultRead = defaultGate.evaluate({ id: "call-read", toolName: "read-file", input: {} }, "read");
    const defaultExecute = defaultGate.evaluate({ id: "call-exec", toolName: "bash", input: {} }, "execute");
    const bypassExecute = bypassGate.evaluate({ id: "call-bypass", toolName: "bash", input: {} }, "execute");

    expect(defaultRead.decision).toBe("allow");
    expect(defaultRead.mode).toBe("default");
    expect(defaultExecute.decision).toBe("ask");
    expect(defaultExecute.mode).toBe("default");
    expect(bypassExecute.decision).toBe("allow");
    expect(bypassExecute.mode).toBe("bypass_permissions");
  });

  it("dispatchToolCall persists an allowed tool lifecycle", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-tool-runtime-"));
    const sessionDir = path.join(tempRoot, "sessions");
    const sessionManager = new SessionManager(sessionDir);
    const session = await sessionManager.startSession({ cwd: tempRoot, mode: "single", providerId: "local" });

    const registry = new ToolRegistry([{
      name: "read-project",
      riskLevel: "read",
      async execute(_input, context) {
        return { status: "success", output: `cwd=${context.cwd}` };
      },
    }]);

    const events = await lastValueFrom(
      dispatchToolCall({
        session, sessionManager, turn: 1,
        call: { id: "tool-call-1", toolName: "read-project", input: {} },
        registry, permissionGate: createPermissionGate(), cwd: tempRoot,
      }).pipe(toArray()),
    );

    await sessionManager.closeSession(session.id);

    expect(events.map((e) => e.type)).toEqual([
      "tool_call_requested", "permission_decision", "tool_started", "tool_result",
    ]);

    const files = await readdir(sessionDir);
    expect(files.length).toBe(1);

    const transcript = await readFile(path.join(sessionDir, files[0]), "utf8");
    expect(transcript).toMatch(/"type":"tool_call"/);
    expect(transcript).toMatch(/"type":"permission"/);
    expect(transcript).toMatch(/"type":"tool_result"/);
    expect(transcript).toMatch(/"status":"success"/);
  });

  it("dispatchToolCall blocks execution when permission is not granted", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-tool-runtime-blocked-"));
    const sessionDir = path.join(tempRoot, "sessions");
    const sessionManager = new SessionManager(sessionDir);
    const session = await sessionManager.startSession({ cwd: tempRoot, mode: "single", providerId: "local" });

    const registry = new ToolRegistry([{
      name: "bash",
      riskLevel: "execute",
      async execute() { return { status: "success", output: "should-not-run" }; },
    }]);

    const events = await lastValueFrom(
      dispatchToolCall({
        session, sessionManager, turn: 1,
        call: { id: "tool-call-2", toolName: "bash", input: { command: "pwd" } },
        registry, permissionGate: createPermissionGate(), cwd: tempRoot,
      }).pipe(toArray()),
    );

    expect(events.map((e) => e.type)).toEqual([
      "tool_call_requested", "permission_decision", "tool_failed",
    ]);
    expect(events[1].decision).toBe("ask");
    expect(events[2].status).toBe("blocked");

    await sessionManager.closeSession(session.id);
  });

  it("spawn_agent creates child agent with independent session", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-spawn-agent-"));
    const sessionDir = path.join(tempRoot, "sessions");
    const sessionManager = new SessionManager(sessionDir);
    const session = await sessionManager.startSession({ cwd: tempRoot, mode: "single", providerId: "local" });

    const { createLocalProvider } = await import("../dist/providers/local.js");
    const childProvider = createLocalProvider();
    const registry = new ToolRegistry([]);

    const events = await lastValueFrom(
      dispatchToolCall({
        session, sessionManager, turn: 1,
        call: { id: "tool-spawn-1", toolName: "spawn_agent", input: { name: "analyzer", task: "你好" } },
        registry, permissionGate: createPermissionGate({ mode: "bypass_permissions" }),
        cwd: tempRoot, provider: childProvider, history: [],
      }).pipe(toArray()),
    );

    expect(events.map((e) => e.type)).toEqual([
      "tool_call_requested", "permission_decision", "tool_started",
      "agent_spawned", "agent_completed", "tool_result",
    ]);

    const spawnedEvent = events.find((e) => e.type === "agent_spawned");
    expect(spawnedEvent.name).toBe("analyzer");
    expect(spawnedEvent.task).toBe("你好");
    expect(spawnedEvent.childId).toBeTruthy();
    expect(spawnedEvent.childSessionPath).toBeTruthy();

    const completedEvent = events.find((e) => e.type === "agent_completed");
    expect(completedEvent.status).toBe("success");

    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult.output).toBeTruthy();

    await sessionManager.closeAll();

    const files = await readdir(sessionDir);
    const childSessionFile = files.find((f) => f.includes("-child-analyzer"));
    expect(childSessionFile).toBeTruthy();
  });

  it("spawn_agent fails when required parameters are missing", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-spawn-agent-missing-"));
    const sessionDir = path.join(tempRoot, "sessions");
    const sessionManager = new SessionManager(sessionDir);
    const session = await sessionManager.startSession({ cwd: tempRoot, mode: "single", providerId: "local" });

    const childProvider = {
      id: "local",
      runStep: async function* () { yield { type: "assistant_message", text: "ok" }; },
    };

    const registry = new ToolRegistry([]);

    const events = await lastValueFrom(
      dispatchToolCall({
        session, sessionManager, turn: 1,
        call: { id: "tool-spawn-2", toolName: "spawn_agent", input: { name: "analyzer" } },
        registry, permissionGate: createPermissionGate({ mode: "bypass_permissions" }),
        cwd: tempRoot, provider: childProvider, history: [],
      }).pipe(toArray()),
    );

    expect(events[events.length - 1].type).toBe("tool_failed");
    expect(events[events.length - 1].error).toMatch(/requires.*name.*task/i);
  });

  it("spawn_agent respects tools parameter to limit child agent tools", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-spawn-agent-tools-"));
    const sessionDir = path.join(tempRoot, "sessions");
    const sessionManager = new SessionManager(sessionDir);
    const session = await sessionManager.startSession({ cwd: tempRoot, mode: "single", providerId: "local" });

    const { createLocalProvider } = await import("../dist/providers/local.js");
    const childProvider = createLocalProvider();

    const registry = new ToolRegistry([
      { name: "read-file", riskLevel: "read", async execute() { return { status: "success", output: "file content" }; } },
      { name: "bash", riskLevel: "execute", async execute() { return { status: "success", output: "command output" }; } },
      { name: "write-file", riskLevel: "write", async execute() { return { status: "success", output: "file written" }; } },
    ]);

    const events = await lastValueFrom(
      dispatchToolCall({
        session, sessionManager, turn: 1,
        call: { id: "tool-spawn-tools", toolName: "spawn_agent", input: { name: "limited-agent", task: "测试任务", tools: ["read-file"] } },
        registry, permissionGate: createPermissionGate({ mode: "bypass_permissions" }),
        cwd: tempRoot, provider: childProvider, history: [],
      }).pipe(toArray()),
    );

    expect(events.map((e) => e.type)).toEqual([
      "tool_call_requested", "permission_decision", "tool_started",
      "agent_spawned", "agent_completed", "tool_result",
    ]);

    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult.status).toBe("success");

    await sessionManager.closeAll();
  });
});
