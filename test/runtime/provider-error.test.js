/**
 * provider-error.test.js - provider 调用失败时的错误展示测试
 *
 * 验证：当 provider.runStep 抛出错误（如 402 insufficient_balance、网络错误、
 * 模型名无效等），runAgentLoop 不会静默吞错，而是转成一个 assistant_message
 * 事件让用户在 UI 上看到具体错误。
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { lastValueFrom, of, toArray, Observable } from "rxjs";

import { SessionManager } from "../../dist/core/runtime/session-manager.js";
import { runAgentLoop } from "../../dist/core/runtime/agent-loop.js";
import { createPermissionGate } from "../../dist/core/runtime/permission-gate.js";
import { ToolRegistry } from "../../dist/tools/tool-registry.js";

describe("provider 错误显示", () => {
  it("provider 抛错时,events 含 assistant_message 且 content 包含具体错误信息", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-provider-err-"));
    const sessionDir = path.join(tempRoot, "sessions");
    const sessionManager = new SessionManager(sessionDir);
    const session = await sessionManager.startSession({ cwd: tempRoot, mode: "single", providerId: "fake" });

    // Mock provider：runStep 立即发出 error，模拟 minimax 402 insufficient_balance
    const failingProvider = {
      id: "failing-provider",
      runStep() {
        return new Observable((subscriber) => {
          subscriber.error(new Error("insufficient balance (1008)"));
        });
      },
    };

    const events = await lastValueFrom(
      runAgentLoop({
        input$: of({ turn: 1, content: "hi", source: "message" }),
        provider: failingProvider,
        sessionManager,
        toolRegistry: new ToolRegistry([]),
        permissionGate: createPermissionGate({ mode: "bypass_permissions" }),
        cwd: tempRoot,
        mode: "single",
      }).events$.pipe(toArray())
    );

    // 收集所有 assistant_message，过滤出错误提示
    const errorMessages = events
      .filter((e) => e.type === "assistant_message")
      .map((e) => e.content)
      .filter((c) => c.includes("[错误]"));

    expect(errorMessages.length).toBeGreaterThan(0);
    expect(errorMessages[0]).toMatch(/provider 调用失败.*insufficient balance/);

    // session 完整生命周期：start → user_turn → error assistant_message → session_ended
    const types = events.map((e) => e.type);
    expect(types).toContain("session_started");
    expect(types).toContain("session_ended");

    await sessionManager.closeAll();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("provider 抛错时,仍能写入 session 记录(含错误的 assistant_message)", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-provider-err2-"));
    const sessionDir = path.join(tempRoot, "sessions");
    const sessionManager = new SessionManager(sessionDir);

    const failingProvider = {
      id: "failing-provider",
      runStep() {
        return new Observable((subscriber) => {
          subscriber.error(new Error("network timeout"));
        });
      },
    };

    await lastValueFrom(
      runAgentLoop({
        input$: of({ turn: 1, content: "hi", source: "message" }),
        provider: failingProvider,
        sessionManager,
        toolRegistry: new ToolRegistry([]),
        permissionGate: createPermissionGate({ mode: "bypass_permissions" }),
        cwd: tempRoot,
        mode: "single",
      }).events$.pipe(toArray())
    );

    // 读取 session 文件，验证错误被持久化（用于审计和后续 resume）
    await sessionManager.closeAll();
    const { readdir, readFile } = await import("node:fs/promises");
    const files = await readdir(sessionDir);
    const sessionFile = files.find((f) => f.endsWith(".jsonl"));
    expect(sessionFile).toBeTruthy();

    const content = await readFile(path.join(sessionDir, sessionFile), "utf8");
    const lines = content.split("\n").filter(Boolean);
    const records = lines.map((l) => JSON.parse(l));

    const errorRecord = records.find(
      (r) => r.type === "message" && r.role === "assistant" && r.content?.includes("[错误]")
    );
    expect(errorRecord).toBeTruthy();
    expect(errorRecord.content).toMatch(/network timeout/);

    await rm(tempRoot, { recursive: true, force: true });
  });
});