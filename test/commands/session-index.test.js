/**
 * session-index.test.js - Session 索引测试
 *
 * 测试 SessionIndex 类的列出、搜索、详情、删除等功能。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let SessionIndex;

beforeAll(async () => {
  const mod = await import("../../dist/core/runtime/session-index.js");
  SessionIndex = mod.SessionIndex;
});

/**
 * 在指定目录创建 mock session 文件
 */
async function createMockSessionInDir(dir, id, records, filename) {
  const fileName = filename || `${id}.jsonl`;
  const filePath = join(dir, fileName);
  const content = records.map(r => JSON.stringify(r)).join("\n");
  await writeFile(filePath, content, "utf8");
  return filePath;
}

describe("SessionIndex", () => {
  describe("listSessions", () => {
    it("空目录返回空数组", async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), "joe-empty-"));
      try {
        const index = new SessionIndex(emptyDir);
        const sessions = await index.listSessions();
        expect(sessions).toEqual([]);
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    });

    it("列出单个 session", async () => {
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

        expect(sessions.length).toBe(1);
        expect(sessions[0].id).toBe(id);
        expect(sessions[0].providerId).toBe("local");
        expect(sessions[0].mode).toBe("single");
        expect(sessions[0].firstUserMessage).toBe("Hello world");
        expect(sessions[0].hasChildren).toBe(false);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it("列出多个 session 并按时间排序", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "joe-multi-"));
      try {
        const id1 = "2026-05-27T08-00-00_aaa111";
        const id2 = "2026-05-27T10-00-00_bbb222";
        const id3 = "2026-05-27T09-00-00_ccc333";

        await createMockSessionInDir(testDir, id1, [{ type: "session", timestamp: "2026-05-27T08:00:00Z" }, { type: "message", role: "user", content: "First session" }]);
        await createMockSessionInDir(testDir, id2, [{ type: "session", timestamp: "2026-05-27T10:00:00Z" }, { type: "message", role: "user", content: "Second session" }]);
        await createMockSessionInDir(testDir, id3, [{ type: "session", timestamp: "2026-05-27T09:00:00Z" }, { type: "message", role: "user", content: "Third session" }]);

        const baseTime = new Date("2026-05-27T10:00:00Z");
        await utimes(join(testDir, `${id1}.jsonl`), baseTime, new Date(baseTime.getTime() - 3600000 * 3));
        await utimes(join(testDir, `${id2}.jsonl`), baseTime, baseTime);
        await utimes(join(testDir, `${id3}.jsonl`), baseTime, new Date(baseTime.getTime() - 3600000));

        const index = new SessionIndex(testDir);
        const sessions = await index.listSessions({ sort: "newest" });

        expect(sessions.length).toBe(3);
        expect(sessions[0].id).toBe(id2);
        expect(sessions[1].id).toBe(id3);
        expect(sessions[2].id).toBe(id1);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it("忽略子 Agent session 文件", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "joe-child-"));
      try {
        const parentId = "2026-05-27T10-00-00_abc123";
        const childId = "2026-05-27T10-00-00_abc123-child-agent1";

        await createMockSessionInDir(testDir, parentId, [{ type: "session", timestamp: "2026-05-27T10:00:00Z" }, { type: "message", role: "user", content: "Parent session" }]);
        await createMockSessionInDir(testDir, childId, [{ type: "session", timestamp: "2026-05-27T10:00:01Z" }, { type: "message", role: "user", content: "Child session" }], `${childId}.jsonl`);

        const index = new SessionIndex(testDir);
        const sessions = await index.listSessions();

        expect(sessions.length).toBe(1);
        expect(sessions[0].id).toBe(parentId);
        expect(sessions[0].hasChildren).toBe(true);
        expect(sessions[0].childNames).toEqual(["agent1"]);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it("按 provider 过滤", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "joe-filter-"));
      try {
        await createMockSessionInDir(testDir, "2026-05-27T10-00-00_aaa111", [{ type: "session", timestamp: "2026-05-27T10:00:00Z", provider: "local" }, { type: "message", role: "user", content: "Local session" }]);
        await createMockSessionInDir(testDir, "2026-05-27T10-00-01_bbb222", [{ type: "session", timestamp: "2026-05-27T10:00:01Z", provider: "ollama" }, { type: "message", role: "user", content: "Ollama session" }]);

        const index = new SessionIndex(testDir);
        const sessions = await index.listSessions({ provider: "local" });

        expect(sessions.length).toBe(1);
        expect(sessions[0].providerId).toBe("local");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it("搜索消息内容", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "joe-search-"));
      try {
        await createMockSessionInDir(testDir, "2026-05-27T10-00-00_aaa111", [{ type: "session", timestamp: "2026-05-27T10:00:00Z" }, { type: "message", role: "user", content: "How to use RxJS?" }]);
        await createMockSessionInDir(testDir, "2026-05-27T10-00-01_bbb222", [{ type: "session", timestamp: "2026-05-27T10:00:01Z" }, { type: "message", role: "user", content: "TypeScript generics" }]);

        const index = new SessionIndex(testDir);
        const sessions = await index.listSessions({ search: "RxJS" });

        expect(sessions.length).toBe(1);
        expect(sessions[0].firstUserMessage).toContain("RxJS");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it("分页功能", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "joe-page-"));
      try {
        for (let i = 1; i <= 5; i++) {
          const id = `2026-05-27T${String(10 + i).padStart(2, "0")}-00-00_${String(i).padStart(6, "0")}`;
          await createMockSessionInDir(testDir, id, [
            { type: "session", timestamp: `2026-05-27T${String(10 + i).padStart(2, "0")}:00:00Z` },
            { type: "message", role: "user", content: `Session ${i}` },
          ]);
        }

        const index = new SessionIndex(testDir);
        const page1 = await index.listSessions({ limit: 2, sort: "newest" });
        expect(page1.length).toBe(2);

        const page2 = await index.listSessions({ limit: 2, offset: 2, sort: "newest" });
        expect(page2.length).toBe(2);

        const page1Ids = page1.map(s => s.id);
        const page2Ids = page2.map(s => s.id);
        expect(page1Ids.filter(id => page2Ids.includes(id))).toEqual([]);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("getSession", () => {
    it("获取 session 详情", async () => {
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

        expect(session).toBeTruthy();
        expect(session.id).toBe(id);
        expect(session.messageCount).toBe(3);
        expect(session.records.length).toBe(4);
        expect(session.cwd).toBe("/test");
        expect(session.providerId).toBe("local");
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it("不存在的 session 返回 null", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "joe-notfound-"));
      try {
        const index = new SessionIndex(testDir);
        const session = await index.getSession("2026-05-27T10-00-00_nonexist");
        expect(session).toBeNull();
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("getLatestSession", () => {
    it("获取最新 session", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "joe-latest-"));
      try {
        const id1 = "2026-05-27T08-00-00_aaa111";
        const id2 = "2026-05-27T10-00-00_bbb222";

        await createMockSessionInDir(testDir, id1, [{ type: "session", timestamp: "2026-05-27T08:00:00Z" }, { type: "message", role: "user", content: "Old session" }]);
        await createMockSessionInDir(testDir, id2, [{ type: "session", timestamp: "2026-05-27T10:00:00Z" }, { type: "message", role: "user", content: "New session" }]);

        const baseTime = new Date("2026-05-27T10:00:00Z");
        await utimes(join(testDir, `${id1}.jsonl`), baseTime, new Date(baseTime.getTime() - 3600000));
        await utimes(join(testDir, `${id2}.jsonl`), baseTime, baseTime);

        const index = new SessionIndex(testDir);
        const session = await index.getLatestSession();

        expect(session).toBeTruthy();
        expect(session.id).toBe(id2);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it("空目录返回 null", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "joe-latest-empty-"));
      try {
        const index = new SessionIndex(testDir);
        const session = await index.getLatestSession();
        expect(session).toBeNull();
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("deleteSession", () => {
    it("删除 session 及其子 Agent", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "joe-delete-"));
      try {
        const parentId = "2026-05-27T10-00-00_abc123";
        const childId = "2026-05-27T10-00-00_abc123-child-agent1";

        await createMockSessionInDir(testDir, parentId, [{ type: "session", timestamp: "2026-05-27T10:00:00Z" }, { type: "message", role: "user", content: "Parent" }]);
        await createMockSessionInDir(testDir, childId, [{ type: "session", timestamp: "2026-05-27T10:00:01Z" }, { type: "message", role: "user", content: "Child" }], `${childId}.jsonl`);

        const index = new SessionIndex(testDir);
        const success = await index.deleteSession(parentId);

        expect(success).toBe(true);
        const session = await index.getSession(parentId);
        expect(session).toBeNull();
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it("删除不存在的 session 返回 false", async () => {
      const testDir = await mkdtemp(join(tmpdir(), "joe-delete-notfound-"));
      try {
        const index = new SessionIndex(testDir);
        const success = await index.deleteSession("2026-05-27T10-00-00_nonexist");
        expect(success).toBe(false);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("getStats", () => {
    it("统计信息正确", async () => {
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

        expect(stats.totalSessions).toBe(2);
        expect(stats.oldestSession).toBeTruthy();
        expect(stats.newestSession).toBeTruthy();
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });
});
