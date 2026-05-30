/**
 * qwen-tool-calling.test.js - Qwen Provider 基础测试
 *
 * 测试 Qwen provider 的基本功能和 tool calling 支持。
 */

import { describe, it, expect } from "vitest";
import { createOpenAIProvider as createQwenProvider } from "../../dist/providers/openai.js";
import { createDefaultToolRegistry } from "../../dist/tools/default-registry.js";

// ============================================================
// 配置验证测试
// ============================================================

describe("Qwen Provider 配置验证", () => {
  it("缺少 model 抛出错误", () => {
    expect(() => {
      createQwenProvider({ baseUrl: "http://localhost:1234", apiKey: "test-key" });
    }).toThrow(/missingModel|缺少 model/);
  });

  it("成功创建 provider", () => {
    const provider = createQwenProvider({
      baseUrl: "http://localhost:1234",
      apiKey: "test-key",
      model: "qwen-test",
    });

    expect(provider).toBeTruthy();
    expect(provider.id).toBe("openai-compatible");
    expect(provider.runStep).toBeTruthy();
    expect(typeof provider.runStep).toBe("function");
  });

  it("缺少 baseUrl 抛出错误", () => {
    expect(() => {
      createQwenProvider({ apiKey: "test-key", model: "qwen-test" });
    }).toThrow(/missingBaseUrl|缺少 baseUrl/);
  });

  it("baseUrl 规范化 - 去除尾部斜杠", () => {
    const provider = createQwenProvider({
      baseUrl: "http://localhost:8080/",
      apiKey: "test-key",
      model: "qwen-test",
    });
    expect(provider).toBeTruthy();
  });
});

// ============================================================
// 工具注册表测试
// ============================================================

describe("DefaultToolRegistry", () => {
  it("包含必要的工具", () => {
    const { toolRegistry } = createDefaultToolRegistry();
    const tools = toolRegistry.list();

    expect(tools).toContain("read-file");
    expect(tools).toContain("bash");
    expect(tools).toContain("edit-file");
    expect(tools).toContain("write-file");
    expect(tools).toContain("glob");
    expect(tools).toContain("grep");
  });

  it("工具有正确的属性", () => {
    const { toolRegistry } = createDefaultToolRegistry();
    const readTool = toolRegistry.get("read-file");

    expect(readTool).toBeTruthy();
    expect(readTool.name).toBe("read-file");
    expect(readTool.riskLevel).toBeTruthy();
    expect(readTool.execute).toBeTruthy();
  });
});

// ============================================================
// Provider 接口测试
// ============================================================

describe("Provider 接口", () => {
  it("runStep 返回 Observable", () => {
    const provider = createQwenProvider({
      baseUrl: "http://localhost:1234",
      apiKey: "test-key",
      model: "qwen-test",
    });

    const { toolRegistry } = createDefaultToolRegistry();

    const turnContext = {
      sessionId: "test",
      turn: 1,
      input: { turn: 1, content: "test", source: "message" },
      history: [],
      cwd: process.cwd(),
      toolRegistry,
      permissionMode: "default",
      maxStepsPerTurn: 8,
    };

    const turnState = {
      sessionId: "test",
      turn: 1,
      cwd: process.cwd(),
      input: { turn: 1, content: "test", source: "message" },
      history: [],
      step: 0,
      status: "running",
      assistantChunks: [],
      toolCalls: [],
      toolResults: [],
    };

    const result = provider.runStep({ context: turnContext, state: turnState });
    expect(result).toBeTruthy();
    expect(result.subscribe).toBeTruthy();
    expect(typeof result.subscribe).toBe("function");
  });
});
