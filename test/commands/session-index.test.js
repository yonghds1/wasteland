/**
 * session-index.test.js - Session 索引测试
 *
 * 测试 SessionIndex 类的列出、搜索、详情、删除等功能。
 */

import assert from "node:assert/strict";
import { test, describe, before, after } from "node:test";
import { mkdtemp, writeFile, mkdir, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("SessionIndex", () => {
  let tempDir;
  let SessionIndex;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "joe-test-sessions-"));

    const mod = await import("../../dist/runtime/session-index.js");
    SessionIndex = mod.SessionIndex;
  });

  after(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  /**
   * 创建一个 mock session 文件
   */
  async function createMockSession(id, records, filename) {
    const fileName = filename || `${id}.jsonl`;
    const filePath = join(tempDir, fileName);
    const content = records.map(r => JSON.stringify(r)).join("\n");
    await writeFile(filePath, content, "utf8");
    return filePath;
  }

  describe("listSessions", () => {
    test("空目录返回空数组", async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), "joe-empty-"));
      try {
        const index = new SessionIndex(emptyDir);
        const sessions = await index.listSessions();
        assert.deepEqual(sessions, []);
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    });

    test("列出单个 session", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "joe-single-"));
      try {
        const id = "2026-05-27T10-00-00_abc123";
        await createMockSessionInDir(testDir, id, [
          { type: "session", timestamp: "2026-05-27T10:00:00Z", cwd: "/test", provider: "local", mode: "single" },
          { type: "message", role: "user", content: "Hello world", timestamp: "2026-05-27T10:00:01Z" },
          { type: "message", role: "assistant", content: "Hi there!", timestamp: "2026-05-27T10:00:02Z" },
        ]);

        const index = new SessionIndex(testDir);
        const sessions = await index.listSessions();

        assert.equal(sessions.length, 1);
        assert.equal(sessions[0].id, id);
        assert.equal(sessions[0].providerId, "local");
        assert.equal(sessions[0].mode, "single");
        assert.equal(sessions[0].firstUserMessage, "Hello world");
        assert.equal(sessions[0].hasChildren, false);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    test("列出多个 session 并按时间排序", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "joe-multi-"));
      try {
        // 创建多个 session 并设置不同的 mtime
        const id1 = "2026-05-27T08-00-00_aaa111";
        const id2 = "2026-05-27T10-00-00_bbb222";
        const id3 = "2026-05-27T09-00-00_ccc333";

        await createMockSessionInDir(testDir, id1, [
          { type: "session", timestamp: "2026-05-27T08:00:00Z" },
          { type: "message", role: "user", content: "First session" },
        ]);
        await createMockSessionInDir(testDir, id2, [
          { type: "session", timestamp: "2026-05-27T10:00:00Z" },
          { type: "message", role: "user", content: "Second session" },
        ]);
        await createMockSessionInDir(testDir, id3, [
          { type: "session", timestamp: "2026-05-27T09:00:00Z" },
          { type: "message", role: "user", content: "Third session" },
        ]);

        // 设置不同的 mtime 以确保排序正确
        const baseTime = new Date("2026-05-27T10:00:00Z");
        await utimes(join(testDir, `${id1}.jsonl`), baseTime, new Date(baseTime.getTime() - 3600000 * 3)); // 3 hours earlier
        await utimes(join(testDir, `${id2}.jsonl`), baseTime, baseTime); // latest
        await utimes(join(testDir, `${id3}.jsonl`), baseTime, new Date(baseTime.getTime() - 3600000)); // 1 hour earlier

        const index = new SessionIndex(testDir);
        const sessions = await index.listSessions({ sort: "newest" });

        assert.equal(sessions.length, 3);
        // 最新的应该排在前面
        assert.equal(sessions[0].id, id2);
        assert.equal(sessions[1].id, id3);
        assert.equal(sessions[2].id, id1);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    test("忽略子 Agent session 文件", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "joe-child-"));
      try {
        const parentId = "2026-05-27T10-00-00_abc123";
        const childId = "2026-05-27T10-00-00_abc123-child-agent1";

        await createMockSessionInDir(testDir, parentId, [
          { type: "session", timestamp: "2026-05-27T10:00:00Z" },
          { type: "message", role: "user", content: "Parent session" },
        ]);
        await createMockSessionInDir(testDir, childId, [
          { type: "session", timestamp: "2026-05-27T10:00:01Z" },
          { type: "message", role: "user", content: "Child session" },
        ], `${childId}.jsonl`);

        const index = new SessionIndex(testDir);
        const sessions = await index.listSessions();

        // 只应该列出父 session
        assert.equal(sessions.length, 1);
        assert.equal(sessions[0].id, parentId);
        assert.equal(sessions[0].hasChildren, true);
        assert.deepEqual(sessions[0].childNames, ["agent1"]);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    test("按 provider 过滤", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "joe-filter-"));
      try {
        await createMockSessionInDir(testDir, "2026-05-27T10-00-00_aaa111", [
          { type: "session", timestamp: "2026-05-27T10:00:00Z", provider: "local" },
          { type: "message", role: "user", content: "Local session" },
        ]);
        await createMockSessionInDir(testDir, "2026-05-27T10-00-01_bbb222", [
          { type: "session", timestamp: "2026-05-27T10:00:01Z", provider: "ollama" },
          { type: "message", role: "user", content: "Ollama session" },
        ]);

        const index = new SessionIndex(testDir);
        const sessions = await index.listSessions({ provider: "local" });

        assert.equal(sessions.length, 1);
        assert.equal(sessions[0].providerId, "local");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    test("搜索消息内容", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "joe-search-"));
      try {
        await createMockSessionInDir(testDir, "2026-05-27T10-00-00_aaa111", [
          { type: "session", timestamp: "2026-05-27T10:00:00Z" },
          { type: "message", role: "user", content: "How to use RxJS?" },
        ]);
        await createMockSessionInDir(testDir, "2026-05-27T10-00-01_bbb222", [
          { type: "session", timestamp: "2026-05-27T10:00:01Z" },
          { type: "message", role: "user", content: "TypeScript generics" },
        ]);

        const index = new SessionIndex(testDir);
        const sessions = await index.listSessions({ search: "RxJS" });

        assert.equal(sessions.length, 1);
        assert.ok(sessions[0].firstUserMessage.includes("RxJS"));
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    test("分页功能", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "joe-page-"));
      try {
        // 创建 5 个 session
        for (let i = 1; i <= 5; i++) {
          const id = `2026-05-27T${String(10 + i).padStart(2, "0")}-00-00_${String(i).padStart(6, "0")}`;
          await createMockSessionInDir(testDir, id, [
            { type: "session", timestamp: `2026-05-27T${String(10 + i).padStart(2, "0")}:00:00Z` },
            { type: "message", role: "user", content: `Session ${i}` },
          ]);
        }

        const index = new SessionIndex(testDir);

        // 获取前 2 个
        const page1 = await index.listSessions({ limit: 2, sort: "newest" });
        assert.equal(page1.length, 2);

        // 获取第 2 页
        const page2 = await index.listSessions({ limit: 2, offset: 2, sort: "newest" });
        assert.equal(page2.length, 2);

        // 确保没有重叠
        const page1Ids = page1.map(s => s.id);
        const page2Ids = page2.map(s => s.id);
        assert.deepEqual(page1Ids.filter(id => page2Ids.includes(id)), []);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("getSession", () => {
    test("获取 session 详情", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "joe-detail-"));
      try {
        const id = "2026-05-27T10-00-00_abc123";
        await createMockSessionInDir(testDir, id, [
          { type: "session", timestamp: "2026-05-27T10:00:00Z", cwd: "/test", provider: "local", mode: "single" },
          { type: "message", role: "user", content: "Hello" },
          { type: "message", role: "assistant", content: "Hi there!" },
          { type: "message", role: "user", content: "How are you?" },
        ]);

        const index = new SessionIndex(testDir);
        const session = await index.getSession(id);

        assert.ok(session);
        assert.equal(session.id, id);
        assert.equal(session.messageCount, 3);
        assert.equal(session.records.length, 4);
        assert.equal(session.cwd, "/test");
        assert.equal(session.providerId, "local");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    test("不存在的 session 返回 null", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "joe-notfound-"));
      try {
        const index = new SessionIndex(testDir);
        const session = await index.getSession("2026-05-27T10-00-00_nonexist");
        assert.equal(session, null);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("getLatestSession", () => {
    test("获取最新 session", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "joe-latest-"));
      try {
        const id1 = "2026-05-27T08-00-00_aaa111";
        const id2 = "2026-05-27T10-00-00_bbb222";

        await createMockSessionInDir(testDir, id1, [
          { type: "session", timestamp: "2026-05-27T08:00:00Z" },
          { type: "message", role: "user", content: "Old session" },
        ]);
        await createMockSessionInDir(testDir, id2, [
          { type: "session", timestamp: "2026-05-27T10:00:00Z" },
          { type: "message", role: "user", content: "New session" },
        ]);

        // 设置不同的 mtime 以确保排序正确
        const baseTime = new Date("2026-05-27T10:00:00Z");
        await utimes(join(testDir, `${id1}.jsonl`), baseTime, new Date(baseTime.getTime() - 3600000));
        await utimes(join(testDir, `${id2}.jsonl`), baseTime, baseTime);

        const index = new SessionIndex(testDir);
        const session = await index.getLatestSession();

        assert.ok(session);
        assert.equal(session.id, id2);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    test("空目录返回 null", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "joe-latest-empty-"));
      try {
        const index = new SessionIndex(testDir);
        const session = await index.getLatestSession();
        assert.equal(session, null);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("deleteSession", () => {
    test("删除 session 及其子 Agent", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "joe-delete-"));
      try {
        const parentId = "2026-05-27T10-00-00_abc123";
        const childId = "2026-05-27T10-00-00_abc123-child-agent1";

        await createMockSessionInDir(testDir, parentId, [
          { type: "session", timestamp: "2026-05-27T10:00:00Z" },
          { type: "message", role: "user", content: "Parent" },
        ]);
        await createMockSessionInDir(testDir, childId, [
          { type: "session", timestamp: "2026-05-27T10:00:01Z" },
          { type: "message", role: "user", content: "Child" },
        ], `${childId}.jsonl`);

        const index = new SessionIndex(testDir);
        const success = await index.deleteSession(parentId);

        assert.equal(success, true);

        // 验证文件已删除
        const session = await index.getSession(parentId);
        assert.equal(session, null);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    test("删除不存在的 session 返回 false", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "joe-delete-notfound-"));
      try {
        const index = new SessionIndex(testDir);
        const success = await index.deleteSession("2026-05-27T10-00-00_nonexist");
        assert.equal(success, false);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("getStats", () => {
    test("统计信息正确", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "joe-stats-"));
      try {
        await createMockSessionInDir(testDir, "2026-05-27T08-00-00_aaa111", [
          { type: "session", timestamp: "2026-05-27T08:00:00Z" },
          { type: "message", role: "user", content: "Session 1" },
          { type: "message", role: "assistant", content: "Reply 1" },
        ]);
        await createMockSessionInDir(testDir, "2026-05-27T10-00-00_bbb222", [
          { type: "session", timestamp: "2026-05-27T10:00:00Z" },
          { type: "message", role: "user", content: "Session 2" },
        ]);

        const index = new SessionIndex(testDir);
        const stats = await index.getStats();

        assert.equal(stats.totalSessions, 2);
        assert.ok(stats.oldestSession);
        assert.ok(stats.newestSession);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  /**
   * 在指定目录创建 mock session 文件的辅助函数
   */
  async function createMockSessionInDir(dir, id, records, filename) {
    const fileName = filename || `${id}.jsonl`;
    const filePath = join(dir, fileName);
    const content = records.map(r => JSON.stringify(r)).join("\n");
    await writeFile(filePath, content, "utf8");
    return filePath;
  }
});
