/**
 * a2a-integration.test.ts - ACP / A2A 网络通信与超时防护集成测试
 *
 * 测试目标：
 * 1. 修复网络泄漏与超时问题：定位并消除直连未启动服务器（http://localhost:19999）
 *    触发多次 fetchWithRetry 指数退避导致的 5000ms vitest 超时；
 * 2. 在 beforeEach 中为未运行服务器注入即时拒绝 mock / 短超时防护，确保秒级稳定通过；
 * 3. 验证工具执行失败时返回 { status: "error" } 兜底结果而非未捕获异常；
 * 4. 验证工具注册与主从 agent 工具过滤集成。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithRetry } from "../providers/shared/retry.js";
import { AcpClient } from "./acp-client.js";
import { createAcpAgentTool } from "../tools/agent/acp-agent-tool.js";
import { createDefaultToolRegistry } from "../tools/core/default-registry.js";
import { filterToolRegistry, MAIN_AGENT_TOOL_NAMES } from "../core/engine/agent-loop.js";
import { buildA2AMigrationNotice } from "../config/load-settings.js";
import type { ACPSettings } from "../config/settings-types.js";

// ============================================================
// 测试端点与辅助变量
// ============================================================

const UNREACHABLE_URL = "http://localhost:19999";
const MOCK_SERVER_URL = "http://localhost:19876";

describe("A2A / ACP 集成网络与超时防护", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;

    // 针对未启动服务器（如 UNREACHABLE_URL: 19999）注入即时拒绝 mock，
    // 消除原生网络堆栈 ECONNREFUSED 触发多轮 fetchWithRetry 指数退避（1s + 2s + 4s = 7s）
    // 造成的 5000ms 测试超时与未清理定时器泄漏。
    globalThis.fetch = vi.fn().mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (urlStr.includes("19999")) {
        const error = new TypeError("fetch failed");
        // 赋予网络错误特征
        Object.assign(error, { cause: { code: "ECONNREFUSED" } });
        throw error;
      }

      if (urlStr.includes("19876")) {
        return new Response(JSON.stringify({ ok: true, name: "mock-agent", version: "1.0.0" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return originalFetch(input, init);
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("1. 网络泄漏与超时防护（UNREACHABLE_URL: 19999）", () => {
    it("访问未运行服务器时使用带快速中止的 signal 秒级收敛，消除 5000ms 超时", async () => {
      const start = Date.now();
      const controller = new AbortController();
      // 使用短超时立刻 abort，防止重试退避悬挂
      const timer = setTimeout(() => controller.abort(), 100);

      await expect(
        fetchWithRetry(UNREACHABLE_URL, { signal: controller.signal }, 3)
      ).rejects.toThrow();

      clearTimeout(timer);
      const elapsed = Date.now() - start;
      // 必须在 1500ms 内快速收敛，严禁触发 vitest 5000ms 超时
      expect(elapsed).toBeLessThan(1500);
    });

    it("retries=0 模式下直连失败立即抛出，不发生多次重试与等待", async () => {
      const start = Date.now();

      await expect(
        fetchWithRetry(UNREACHABLE_URL, {}, 0)
      ).rejects.toThrow(/fetch failed/);

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(300);
    });

    it("正常 mock 响应能够在毫秒级内成功返回", async () => {
      const res = await fetchWithRetry(MOCK_SERVER_URL, {}, 1);
      expect(res.status).toBe(200);
      const data = (await res.json()) as { ok: boolean; name: string };
      expect(data.ok).toBe(true);
      expect(data.name).toBe("mock-agent");
    });
  });

  describe("2. 工具执行链路与错误兜底（不抛未捕获异常）", () => {
    it("不可达或异常 agent 工具执行失败时返回 status: error 而非未捕获异常", async () => {
      // 模拟底层客户端网络拒绝或连接不可达
      vi.spyOn(AcpClient, "spawn").mockRejectedValueOnce(
        new Error("connect ECONNREFUSED http://localhost:19999")
      );

      const tool = createAcpAgentTool({
        name: "unreachable-agent",
        command: "acp-agent",
        description: "Unreachable / failing agent",
      });

      const result = await tool.execute(
        { task: "test task with failing agent" },
        { sessionId: "test-session", turn: 1, cwd: "/tmp" }
      );

      // 验证返回结构符合规范：status 为 error，并包含错误详情
      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.error).toBeDefined();
        expect(result.error).toContain("ECONNREFUSED");
      }
    });

    it("空 task 参数直接返回 error 且不发起任何外部调用", async () => {
      const tool = createAcpAgentTool({
        name: "noop-agent",
        command: "echo",
      });

      const result = await tool.execute(
        { task: "   " },
        { sessionId: "test-session", turn: 1, cwd: "/tmp" }
      );

      expect(result.status).toBe("error");
    });
  });

  describe("3. 配置注册与主从 Agent 工具过滤集成", () => {
    it("acp.agents 配置正确注册为 acp_<name> 工具", () => {
      const acpSettings: ACPSettings = {
        agents: [
          {
            name: "echo-agent",
            command: "echo",
            description: "Echo agent for testing",
          },
          {
            name: "helper-agent",
            command: "node",
            description: "Helper agent",
          },
        ],
      };

      const { toolRegistry } = createDefaultToolRegistry({ acp: acpSettings });

      const echoTool = toolRegistry.get("acp_echo-agent");
      expect(echoTool).toBeDefined();
      expect(echoTool?.name).toBe("acp_echo-agent");
      expect(echoTool?.description).toBe("Echo agent for testing");
      expect(echoTool?.riskLevel).toBe("execute");

      const helperTool = toolRegistry.get("acp_helper-agent");
      expect(helperTool).toBeDefined();
      expect(helperTool?.name).toBe("acp_helper-agent");
    });

    it("filterToolRegistry 放行 acp_ 前缀工具并过滤写文件类工具", () => {
      const acpSettings: ACPSettings = {
        agents: [{ name: "filtered-agent", command: "echo" }],
      };

      const { toolRegistry } = createDefaultToolRegistry({ acp: acpSettings });
      const filtered = filterToolRegistry(toolRegistry, MAIN_AGENT_TOOL_NAMES);

      // acp_ 工具被放行
      expect(filtered.list()).toContain("acp_filtered-agent");
      // 主 agent 基础工具保留
      expect(filtered.list()).toContain("spawn_agent");
      expect(filtered.list()).toContain("read-file");
      expect(filtered.list()).toContain("bash");
      // 危险写工具被主 agent 过滤
      expect(filtered.list()).not.toContain("edit-file");
      expect(filtered.list()).not.toContain("write-file");
    });

    it("对旧版 a2a 配置进行检测并提供迁移提示", () => {
      const legacyConfig = {
        a2a: {
          agents: [{ name: "legacy-claude", url: UNREACHABLE_URL }],
          servers: {},
        },
      };

      const notice = buildA2AMigrationNotice(legacyConfig as never, null);
      expect(notice).toBeDefined();
      expect(notice).toContain("a2a");
      expect(notice).toContain("acp.agents");
    });
  });
});
