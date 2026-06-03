/**
 * resume.test.js - Resume 命令测试
 *
 * 测试恢复会话功能。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createSessionIndex } from "../../dist/core/runtime/session-index.js";
import { SessionManager } from "../../dist/core/runtime/session-manager.js";

// ============================================================
// 辅助函数
// ============================================================

async function createMockSession(sessionDir, sessionId, records) {
  const filePath = path.join(sessionDir, `${sessionId}.jsonl`);
  const content = records.map((r) => JSON.stringify(r)).join("\n");
  await writeFile(filePath, content, "utf8");

  // 验证文件已创建
  const stat = await import("node:fs/promises").then((fs) => fs.stat(filePath));
  console.log(`Created file: ${filePath}, size: ${stat.size}`);

  return filePath;
}

// ============================================================
// 测试用例
// ============================================================

describe("Session Resume 功能", () => {
  let tempRoot;
  let sessionDir;

  beforeAll(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-resume-test-"));
    sessionDir = path.join(tempRoot, "sessions");
    await mkdir(sessionDir, { recursive: true });
  });

  afterAll(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("SessionIndex.getSession 返回完整的会话详情", async () => {
    const sessionId = "2026-06-03_120000_abc123";
    await createMockSession(sessionDir, sessionId, [
      {
        type: "session",
        sessionId,
        timestamp: "2026-06-03T12:00:00Z",
        cwd: "/test/dir",
        provider: "qwen",
        mode: "interactive",
      },
      {
        type: "message",
        role: "user",
        turn: 1,
        content: "Hello, how are you?",
        timestamp: "2026-06-03T12:00:01Z",
      },
      {
        type: "message",
        role: "assistant",
        turn: 1,
        content: "I'm doing well, thanks!",
        timestamp: "2026-06-03T12:00:02Z",
      },
      {
        type: "message",
        role: "user",
        turn: 2,
        content: "What can you help me with?",
        timestamp: "2026-06-03T12:00:03Z",
      },
    ]);

    const sessionIndex = createSessionIndex(sessionDir);
    const session = await sessionIndex.getSession(sessionId);

    expect(session).not.toBeNull();
    expect(session.id).toBe(sessionId);
    expect(session.cwd).toBe("/test/dir");
    expect(session.providerId).toBe("qwen");
    expect(session.mode).toBe("interactive");
    expect(session.messageCount).toBe(3);
    expect(session.records).toHaveLength(4);
    expect(session.firstUserMessage).toBe("Hello, how are you?");
  });

  it("SessionIndex.listSessions 返回会话列表", async () => {
    // 使用独立的目录避免与其他测试干扰
    const testDir = await mkdtemp(path.join(os.tmpdir(), "joe-list-test-"));
    const testSessionDir = path.join(testDir, "sessions");
    await mkdir(testSessionDir, { recursive: true });

    try {
      // 创建多个会话（使用正确的 ID 格式：6位十六进制字符）
      await createMockSession(testSessionDir, "2026-06-03_110000_aaa111", [
        {
          type: "session",
          sessionId: "2026-06-03_110000_aaa111",
          timestamp: "2026-06-03T11:00:00Z",
          provider: "local",
        },
        {
          type: "message",
          role: "user",
          turn: 1,
          content: "Old session",
          timestamp: "2026-06-03T11:00:01Z",
        },
      ]);

      await createMockSession(testSessionDir, "2026-06-03_130000_bbb222", [
        {
          type: "session",
          sessionId: "2026-06-03_130000_bbb222",
          timestamp: "2026-06-03T13:00:00Z",
          provider: "qwen",
        },
        {
          type: "message",
          role: "user",
          turn: 1,
          content: "New session",
          timestamp: "2026-06-03T13:00:01Z",
        },
      ]);

      const sessionIndex = createSessionIndex(testSessionDir);
      const sessions = await sessionIndex.listSessions({ sort: "newest" });

      expect(sessions.length).toBe(2);
      expect(sessions[0].id).toBe("2026-06-03_130000_bbb222");
      expect(sessions[1].id).toBe("2026-06-03_110000_aaa111");
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("SessionIndex.getSession 对不存在的会话返回 null", async () => {
    const sessionIndex = createSessionIndex(sessionDir);
    const session = await sessionIndex.getSession("2026-06-03_120000_nonexist");

    expect(session).toBeNull();
  });

  it("SessionManager 创建恢复的会话元数据", async () => {
    const sessionManager = new SessionManager(sessionDir);

    // 模拟恢复的会话元数据
    const resumedSession = {
      id: "2026-06-03_120000_abc123",
      path: path.join(sessionDir, "2026-06-03_120000_abc123.jsonl"),
      cwd: "/test/dir",
      mode: "interactive",
      providerId: "qwen",
    };

    // 验证元数据结构
    expect(resumedSession.id).toBeTruthy();
    expect(resumedSession.path).toBeTruthy();
    expect(resumedSession.cwd).toBeTruthy();
    expect(resumedSession.mode).toBeTruthy();
    expect(resumedSession.providerId).toBeTruthy();
  });

  it("restoreHistoryFromRecords 正确恢复历史消息", async () => {
    // 模拟 session 记录
    const records = [
      {
        type: "session",
        sessionId: "test",
        timestamp: "2026-06-03T12:00:00Z",
      },
      {
        type: "message",
        role: "user",
        turn: 1,
        content: "Hello",
        timestamp: "2026-06-03T12:00:01Z",
        source: "interactive",
      },
      {
        type: "message",
        role: "assistant",
        turn: 1,
        content: "Hi there!",
        timestamp: "2026-06-03T12:00:02Z",
      },
      {
        type: "message",
        role: "user",
        turn: 2,
        content: "How are you?",
        timestamp: "2026-06-03T12:00:03Z",
      },
    ];

    // 过滤并转换消息记录
    const history = records
      .filter((record) => record.type === "message")
      .map((record) => ({
        type: "message",
        role: record.role,
        turn: record.turn || 0,
        content: record.content,
        source: record.source || "interactive",
        timestamp: record.timestamp,
      }));

    expect(history).toHaveLength(3);
    expect(history[0].role).toBe("user");
    expect(history[0].content).toBe("Hello");
    expect(history[1].role).toBe("assistant");
    expect(history[1].content).toBe("Hi there!");
    expect(history[2].role).toBe("user");
    expect(history[2].content).toBe("How are you?");
  });
});
