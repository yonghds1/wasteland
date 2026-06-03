/**
 * ask-user-integration.test.js - ask-user 工具端到端集成测试
 *
 * 测试 UserInputBridge 与 UI 层的集成。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { lastValueFrom, toArray, Subject } from "rxjs";

import { UserInputBridge } from "../../dist/core/runtime/user-input-bridge.js";
import { createPermissionGate } from "../../dist/core/runtime/permission-gate.js";
import { SessionManager } from "../../dist/core/runtime/session-manager.js";
import { dispatchToolCall } from "../../dist/core/runtime/tool-dispatch.js";
import { ToolRegistry } from "../../dist/tools/tool-registry.js";
import { createDefaultToolRegistry } from "../../dist/tools/default-registry.js";

// ============================================================
// 辅助函数
// ============================================================

async function createTestRuntime() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-ask-user-"));
  const sessionDir = path.join(tempRoot, "sessions");
  const sessionManager = new SessionManager(sessionDir);
  const session = await sessionManager.startSession({
    cwd: tempRoot,
    mode: "single",
    providerId: "local",
  });

  const { toolRegistry: registry } = createDefaultToolRegistry();
  const permissionGate = createPermissionGate({ mode: "bypass_permissions" });
  const userInputBridge = new UserInputBridge();

  return {
    tempRoot,
    session,
    sessionManager,
    registry,
    permissionGate,
    userInputBridge,
  };
}

// ============================================================
// 测试用例
// ============================================================

describe("ask-user 工具与 UserInputBridge 集成", () => {
  let tempRoot;

  afterAll(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("ask-user 工具通过 UserInputBridge 等待用户输入", async () => {
    const {
      tempRoot: root,
      session,
      sessionManager,
      registry,
      permissionGate,
      userInputBridge,
    } = await createTestRuntime();
    tempRoot = root;

    // 模拟用户输入
    const userAnswer = "我选择选项 A";
    setTimeout(() => {
      userInputBridge.provideInput(userAnswer);
    }, 100);

    // 执行 ask-user 工具
    const events = await lastValueFrom(
      dispatchToolCall({
        session,
        sessionManager,
        turn: 1,
        call: {
          id: "ask-user-1",
          toolName: "ask-user",
          input: {
            question: "你想做什么？",
            options: ["选项 A", "选项 B"],
          },
        },
        registry,
        permissionGate,
        cwd: tempRoot,
        userInputBridge,
      }).pipe(toArray())
    );

    // 验证事件序列
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("user_input_requested");
    expect(eventTypes).toContain("user_input_received");
    expect(eventTypes).toContain("tool_result");

    // 验证 user_input_requested 事件
    const requestedEvent = events.find((e) => e.type === "user_input_requested");
    expect(requestedEvent.question).toBe("你想做什么？");
    expect(requestedEvent.options).toEqual(["选项 A", "选项 B"]);

    // 验证 user_input_received 事件
    const receivedEvent = events.find((e) => e.type === "user_input_received");
    expect(receivedEvent.answer).toBe(userAnswer);

    // 验证 tool_result 事件
    const toolResultEvent = events.find((e) => e.type === "tool_result");
    expect(toolResultEvent.status).toBe("success");
    expect(toolResultEvent.output).toBe(userAnswer);

    // 清理
    await sessionManager.closeAll();
  });

  it("UserInputBridge 正确管理待处理状态", async () => {
    const bridge = new UserInputBridge();

    // 初始状态
    expect(bridge.isPending()).toBe(false);

    // 开始请求输入
    const inputPromise = bridge.requestInput();
    expect(bridge.isPending()).toBe(true);

    // 提供输入
    bridge.provideInput("test answer");
    const answer = await inputPromise;

    expect(answer).toBe("test answer");
    expect(bridge.isPending()).toBe(false);

    // 清理
    bridge.destroy();
  });

  it("ask-user 工具在没有 UserInputBridge 时返回 null", async () => {
    const {
      tempRoot: root,
      session,
      sessionManager,
      registry,
      permissionGate,
    } = await createTestRuntime();
    tempRoot = root;

    // 不提供 userInputBridge
    const result = dispatchToolCall({
      session,
      sessionManager,
      turn: 1,
      call: {
        id: "ask-user-no-bridge",
        toolName: "ask-user",
        input: {
          question: "测试",
        },
      },
      registry,
      permissionGate,
      cwd: tempRoot,
      // 不提供 userInputBridge
    });

    // 应该回退到普通工具执行
    const events = await lastValueFrom(result.pipe(toArray()));
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("tool_result");

    // 清理
    await sessionManager.closeAll();
  });
});
