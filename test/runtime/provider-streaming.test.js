/**
 * provider-streaming.test.js - provider 流式打字效果测试
 *
 * 验证 agent-loop.ts 重构后，assistant_chunk 事件**立即** emit（恢复打字效果），
 * 而不是被 toArray 缓冲到流结束才一次性发出。
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { lastValueFrom, of, toArray, Observable, tap } from "rxjs";

import { SessionManager } from "../../dist/core/runtime/session-manager.js";
import { runAgentLoop } from "../../dist/core/runtime/agent-loop.js";
import { createPermissionGate } from "../../dist/core/runtime/permission-gate.js";
import { ToolRegistry } from "../../dist/tools/tool-registry.js";

describe("provider 流式打字效果", () => {
  it("assistant_chunk 应按 provider 节奏立即 emit（不等流结束）", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-streaming-"));
    const sessionDir = path.join(tempRoot, "sessions");
    const sessionManager = new SessionManager(sessionDir);

    // Mock provider：每 50ms emit 一个 chunk（模拟真实 SSE 流式节奏）
    const chunkCount = 5;
    const chunkIntervalMs = 50;
    const streamingProvider = {
      id: "streaming",
      runStep() {
        return new Observable((subscriber) => {
          let i = 0;
          const interval = setInterval(() => {
            i++;
            if (i <= chunkCount) {
              subscriber.next({ type: "assistant_chunk", text: `chunk${i} ` });
            } else {
              subscriber.next({ type: "assistant_message", text: "final" });
              subscriber.complete();
              clearInterval(interval);
            }
          }, chunkIntervalMs);
          return () => clearInterval(interval);
        });
      },
    };

    // 记录每个 chunk 事件的到达时间
    const chunkTimes = [];
    const startTime = Date.now();

    await lastValueFrom(
      runAgentLoop({
        input$: of({ turn: 1, content: "hi", source: "message" }),
        provider: streamingProvider,
        sessionManager,
        toolRegistry: new ToolRegistry([]),
        permissionGate: createPermissionGate({ mode: "bypass_permissions" }),
        cwd: tempRoot,
        mode: "single",
      }).events$.pipe(
        tap((e) => {
          if (e.type === "assistant_chunk") {
            chunkTimes.push(Date.now() - startTime);
          }
        }),
        toArray()
      )
    );

    // 验证 chunks 数量正确
    expect(chunkTimes.length).toBe(chunkCount);

    // 验证流式：第一个到最后一个 chunk 的时间跨度应远大于 0（按 ~50ms 间隔发出）
    // 如果不是流式（toArray 缓冲），所有 chunks 会在 ~0ms 内全部到达
    if (chunkTimes.length >= 2) {
      const span = chunkTimes[chunkTimes.length - 1] - chunkTimes[0];
      // 至少 4 个间隔 × 50ms × 0.5（容许）= 100ms
      expect(span).toBeGreaterThan(chunkIntervalMs * (chunkCount - 1) * 0.5);
    }

    await sessionManager.closeAll();
    await rm(tempRoot, { recursive: true, force: true });
  });
});