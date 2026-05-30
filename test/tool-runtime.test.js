import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { lastValueFrom, toArray } from "rxjs";

import { createPermissionGate } from "../dist/core/runtime/permission-gate.js";
import { SessionManager } from "../dist/core/runtime/session-manager.js";
import { dispatchToolCall } from "../dist/core/runtime/tool-dispatch.js";
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
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-tool-runtime-"));
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

  // 强制写入缓冲区
  await sessionManager.closeSession(session.id);

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
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-tool-runtime-blocked-"));
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

  // 强制写入缓冲区
  await sessionManager.closeSession(session.id);

  const files = await readdir(sessionDir);
  const transcript = await readFile(path.join(sessionDir, files[0]), "utf8");

  assert.match(transcript, /"type":"permission"/);
  assert.match(transcript, /"status":"blocked"/);
});

test("spawn_agent creates child agent with independent session", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-spawn-agent-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const sessionManager = new SessionManager(sessionDir);
  const session = await sessionManager.startSession({
    cwd: tempRoot,
    mode: "single",
    providerId: "local",
  });

  // 导入 createLocalProvider
  const { createLocalProvider } = await import("../dist/providers/local.js");
  const childProvider = createLocalProvider();

  const registry = new ToolRegistry([]);

  const events = await lastValueFrom(
    dispatchToolCall({
      session,
      sessionManager,
      turn: 1,
      call: {
        id: "tool-spawn-1",
        toolName: "spawn_agent",
        input: {
          name: "analyzer",
          task: "你好",  // 使用简单的问候，让 local provider 直接回复
        },
      },
      registry,
      permissionGate: createPermissionGate({ mode: "bypass_permissions" }),
      cwd: tempRoot,
      provider: childProvider,
      history: [],
    }).pipe(toArray()),
  );

  // 验证事件序列（包含 agent 生命周期事件）
  const eventTypes = events.map((event) => event.type);
  assert.deepEqual(eventTypes, [
    "tool_call_requested",
    "permission_decision",
    "tool_started",
    "agent_spawned",
    "agent_completed",
    "tool_result",
  ]);

  // 验证 agent_spawned 事件内容
  const spawnedEvent = events.find((e) => e.type === "agent_spawned");
  assert.equal(spawnedEvent.name, "analyzer");
  assert.equal(spawnedEvent.task, "你好");
  assert.ok(spawnedEvent.childId, "应该有 childId");
  assert.ok(spawnedEvent.childSessionPath, "应该有 childSessionPath");

  // 验证 agent_completed 事件内容
  const completedEvent = events.find((e) => e.type === "agent_completed");
  assert.equal(completedEvent.status, "success");
  assert.ok(completedEvent.sessionPath, "应该有 sessionPath");

  // 验证 tool_result 返回结果包含内容
  const toolResult = events.find((e) => e.type === "tool_result");
  assert.ok(toolResult.output, "应该有输出");

  // 强制写入缓冲区
  await sessionManager.closeAll();

  // 验证子 session 文件已创建（包含 -child- 格式）
  const files = await readdir(sessionDir);
  const allFiles = files || [];

  // 查找 -child-analyzer.jsonl 文件
  const childSessionFile = allFiles.find((f) => f.includes("-child-analyzer"));
  assert.ok(childSessionFile, `应该创建子 Agent session 文件，实际文件: ${allFiles.join(", ")}`);
});

test("spawn_agent fails when required parameters are missing", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-spawn-agent-missing-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const sessionManager = new SessionManager(sessionDir);
  const session = await sessionManager.startSession({
    cwd: tempRoot,
    mode: "single",
    providerId: "local",
  });

  const childProvider = {
    id: "local",
    runStep: async function* () {
      yield { type: "assistant_message", text: "ok" };
    },
  };

  const registry = new ToolRegistry([]);

  const events = await lastValueFrom(
    dispatchToolCall({
      session,
      sessionManager,
      turn: 1,
      call: {
        id: "tool-spawn-2",
        toolName: "spawn_agent",
        input: {
          name: "analyzer",
          // 缺少 task
        },
      },
      registry,
      permissionGate: createPermissionGate({ mode: "bypass_permissions" }),
      cwd: tempRoot,
      provider: childProvider,
      history: [],
    }).pipe(toArray()),
  );

  // 应该失败
  assert.equal(events[events.length - 1].type, "tool_failed");
  assert.match(events[events.length - 1].error, /requires.*name.*task/i);
});

test("spawn_agent respects tools parameter to limit child agent tools", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-spawn-agent-tools-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const sessionManager = new SessionManager(sessionDir);
  const session = await sessionManager.startSession({
    cwd: tempRoot,
    mode: "single",
    providerId: "local",
  });

  const { createLocalProvider } = await import("../dist/providers/local.js");
  const childProvider = createLocalProvider();

  // 创建包含多个工具的 registry
  const registry = new ToolRegistry([
    {
      name: "read-file",
      riskLevel: "read",
      async execute() {
        return { status: "success", output: "file content" };
      },
    },
    {
      name: "bash",
      riskLevel: "execute",
      async execute() {
        return { status: "success", output: "command output" };
      },
    },
    {
      name: "write-file",
      riskLevel: "write",
      async execute() {
        return { status: "success", output: "file written" };
      },
    },
  ]);

  const events = await lastValueFrom(
    dispatchToolCall({
      session,
      sessionManager,
      turn: 1,
      call: {
        id: "tool-spawn-tools",
        toolName: "spawn_agent",
        input: {
          name: "limited-agent",
          task: "测试任务",
          tools: ["read-file"], // 只允许 read-file 工具
        },
      },
      registry,
      permissionGate: createPermissionGate({ mode: "bypass_permissions" }),
      cwd: tempRoot,
      provider: childProvider,
      history: [],
    }).pipe(toArray()),
  );

  // 验证事件序列（包含 agent 生命周期事件）
  assert.deepEqual(events.map((event) => event.type), [
    "tool_call_requested",
    "permission_decision",
    "tool_started",
    "agent_spawned",
    "agent_completed",
    "tool_result",
  ]);

  // 验证返回成功
  const toolResult = events.find((e) => e.type === "tool_result");
  assert.equal(toolResult.status, "success");

  await sessionManager.closeAll();
});
