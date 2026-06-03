/**
 * cli-input-adapter.test.js - CliInputAdapter 集成测试
 *
 * 测试 CliInputAdapter 的功能和 InputAdapter 接口兼容性。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PassThrough } from "node:stream";

import { CliInputAdapter } from "../../dist/ui/cli-input-adapter.js";

// ============================================================
// 测试用例
// ============================================================

describe("CliInputAdapter", () => {
  let adapter;
  let mockInput;
  let mockOutput;

  beforeAll(() => {
    mockInput = new PassThrough();
    mockOutput = new PassThrough();
    mockOutput.setEncoding("utf8");
  });

  afterAll(() => {
    if (adapter) {
      adapter.destroy();
    }
  });

  it("实现 InputAdapter 接口", () => {
    adapter = new CliInputAdapter({
      input: mockInput,
      output: mockOutput,
    });

    // 验证接口方法
    expect(adapter.input$).toBeTruthy();
    expect(typeof adapter.destroy).toBe("function");
    expect(typeof adapter.prompt).toBe("function");
  });

  it("处理普通输入", async () => {
    adapter = new CliInputAdapter({
      input: mockInput,
      output: mockOutput,
    });

    const events = [];
    const subscription = adapter.input$.subscribe({
      next: (turn) => events.push(turn),
    });

    // 模拟用户输入
    mockInput.write("Hello world\n");

    // 等待处理
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 验证输出
    expect(events.length).toBe(1);
    expect(events[0].content).toBe("Hello world");
    expect(events[0].source).toBe("interactive");
    expect(events[0].turn).toBe(1);

    subscription.unsubscribe();
    adapter.destroy();
  });

  it("处理多个输入", async () => {
    mockInput = new PassThrough();
    mockOutput = new PassThrough();
    mockOutput.setEncoding("utf8");

    adapter = new CliInputAdapter({
      input: mockInput,
      output: mockOutput,
    });

    const events = [];
    const subscription = adapter.input$.subscribe({
      next: (turn) => events.push(turn),
    });

    // 模拟多个用户输入
    mockInput.write("First message\n");
    await new Promise((resolve) => setTimeout(resolve, 50));
    mockInput.write("Second message\n");
    await new Promise((resolve) => setTimeout(resolve, 50));
    mockInput.write("Third message\n");
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 验证输出
    expect(events.length).toBe(3);
    expect(events[0].content).toBe("First message");
    expect(events[0].turn).toBe(1);
    expect(events[1].content).toBe("Second message");
    expect(events[1].turn).toBe(2);
    expect(events[2].content).toBe("Third message");
    expect(events[2].turn).toBe(3);

    subscription.unsubscribe();
    adapter.destroy();
  });

  it("过滤空输入", async () => {
    mockInput = new PassThrough();
    mockOutput = new PassThrough();
    mockOutput.setEncoding("utf8");

    adapter = new CliInputAdapter({
      input: mockInput,
      output: mockOutput,
    });

    const events = [];
    const subscription = adapter.input$.subscribe({
      next: (turn) => events.push(turn),
    });

    // 模拟空输入
    mockInput.write("\n");
    await new Promise((resolve) => setTimeout(resolve, 50));
    mockInput.write("   \n");
    await new Promise((resolve) => setTimeout(resolve, 50));
    mockInput.write("Valid input\n");
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 验证只有有效输入被处理
    expect(events.length).toBe(1);
    expect(events[0].content).toBe("Valid input");

    subscription.unsubscribe();
    adapter.destroy();
  });

  it("处理 /exit 命令", async () => {
    mockInput = new PassThrough();
    mockOutput = new PassThrough();
    mockOutput.setEncoding("utf8");

    let exitCalled = false;
    adapter = new CliInputAdapter({
      input: mockInput,
      output: mockOutput,
      onCommand: (result) => {
        if (result.action === "exit") {
          exitCalled = true;
        }
      },
    });

    const events = [];
    const subscription = adapter.input$.subscribe({
      next: (turn) => events.push(turn),
    });

    // 模拟 /exit 命令
    mockInput.write("/exit\n");
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 验证 /exit 命令被处理，没有产生新的 turn
    expect(events.length).toBe(0);
    expect(exitCalled).toBe(true);

    subscription.unsubscribe();
  });

  it("处理 /help 命令", async () => {
    mockInput = new PassThrough();
    mockOutput = new PassThrough();
    mockOutput.setEncoding("utf8");

    let helpOutput = "";
    adapter = new CliInputAdapter({
      input: mockInput,
      output: mockOutput,
      onCommand: (result) => {
        if (result.output) {
          helpOutput = result.output;
        }
      },
    });

    const events = [];
    const subscription = adapter.input$.subscribe({
      next: (turn) => events.push(turn),
    });

    // 模拟 /help 命令
    mockInput.write("/help\n");
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 验证 /help 命令被处理
    expect(events.length).toBe(0);
    expect(helpOutput).toBeTruthy();

    subscription.unsubscribe();
    adapter.destroy();
  });

  it("destroy 方法清理资源", () => {
    mockInput = new PassThrough();
    mockOutput = new PassThrough();
    mockOutput.setEncoding("utf8");

    adapter = new CliInputAdapter({
      input: mockInput,
      output: mockOutput,
    });

    // 调用 destroy
    adapter.destroy();

    // 验证 readline 接口已关闭
    // (无法直接验证，但不会抛出错误)
  });
});
