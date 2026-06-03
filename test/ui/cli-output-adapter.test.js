/**
 * cli-output-adapter.test.js - CliOutputAdapter 集成测试
 *
 * 测试 CliOutputAdapter 的功能和 OutputAdapter 接口兼容性。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PassThrough } from "node:stream";
import { Subject } from "rxjs";

import { CliOutputAdapter } from "../../dist/ui/cli-output-adapter.js";

// ============================================================
// 测试用例
// ============================================================

describe("CliOutputAdapter", () => {
  let adapter;
  let mockStdout;
  let mockStderr;

  beforeAll(() => {
    mockStdout = new PassThrough();
    mockStdout.setEncoding("utf8");
    mockStderr = new PassThrough();
    mockStderr.setEncoding("utf8");
  });

  afterAll(() => {
    // 清理
  });

  it("实现 OutputAdapter 接口", () => {
    adapter = new CliOutputAdapter({
      stdout: mockStdout,
      stderr: mockStderr,
    });

    // 验证接口方法
    expect(typeof adapter.processEvent).toBe("function");
    expect(typeof adapter.handleEvents).toBe("function");
    expect(typeof adapter.setOnTurnComplete).toBe("function");
    expect(typeof adapter.setStyle).toBe("function");
  });

  it("processEvent 正确转换事件", () => {
    adapter = new CliOutputAdapter({
      stdout: mockStdout,
      stderr: mockStderr,
    });

    // 测试 session_started 事件
    const sessionEvent = {
      type: "session_started",
      sessionId: "test-session",
      sessionPath: "/test/path",
      mode: "interactive",
    };

    const displayEvent = adapter.processEvent(sessionEvent);
    expect(displayEvent.type).toBe("session_started");
    expect(displayEvent.sessionId).toBe("test-session");
  });

  it("processEvent 转换 user_turn 事件", () => {
    adapter = new CliOutputAdapter({
      stdout: mockStdout,
      stderr: mockStderr,
    });

    const userEvent = {
      type: "user_turn",
      sessionId: "test-session",
      turn: 1,
      content: "Hello",
      source: "interactive",
    };

    const displayEvent = adapter.processEvent(userEvent);
    expect(displayEvent.type).toBe("user_turn");
    expect(displayEvent.turn).toBe(1);
    expect(displayEvent.content).toBe("Hello");
  });

  it("processEvent 转换 assistant_message 事件", () => {
    adapter = new CliOutputAdapter({
      stdout: mockStdout,
      stderr: mockStderr,
    });

    const assistantEvent = {
      type: "assistant_message",
      sessionId: "test-session",
      turn: 1,
      content: "Hi there!",
    };

    const displayEvent = adapter.processEvent(assistantEvent);
    expect(displayEvent.type).toBe("assistant_message");
    expect(displayEvent.content).toBe("Hi there!");
  });

  it("handleEvents 处理事件流", async () => {
    adapter = new CliOutputAdapter({
      stdout: mockStdout,
      stderr: mockStderr,
      style: "classic",
    });

    const subject = new Subject();

    // 启动事件处理
    const handlePromise = adapter.handleEvents(subject.asObservable());

    // 发送事件
    subject.next({
      type: "session_started",
      sessionId: "test-session",
      sessionPath: "/test/path",
      mode: "interactive",
    });

    subject.next({
      type: "assistant_message",
      sessionId: "test-session",
      turn: 1,
      content: "Hello!",
    });

    // 完成流
    subject.complete();

    // 等待处理完成
    await handlePromise;

    // 验证输出（检查 stdout 是否有内容）
    const output = mockStdout.read();
    expect(output).toBeTruthy();
  });

  it("setOnTurnComplete 更新回调", () => {
    adapter = new CliOutputAdapter({
      stdout: mockStdout,
      stderr: mockStderr,
    });

    let callbackCalled = false;
    adapter.setOnTurnComplete(() => {
      callbackCalled = true;
    });

    // 验证回调被设置（通过 handleEvents 间接验证）
    expect(typeof adapter.onTurnComplete).toBe("function");
  });

  it("setStyle 更新显示样式", () => {
    adapter = new CliOutputAdapter({
      stdout: mockStdout,
      stderr: mockStderr,
      style: "classic",
    });

    adapter.setStyle("interactive");
    expect(adapter.style).toBe("interactive");
  });
});
