/**
 * unified-session-manager.test.js - UnifiedSessionManager 集成测试
 *
 * 测试 UnifiedSessionManager 的功能。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { UnifiedSessionManager } from "../../dist/core/runtime/unified-session-manager.js";

// ============================================================
// 测试用例
// ============================================================

describe("UnifiedSessionManager", () => {
  let tempRoot;
  let sessionDir;
  let manager;

  beforeAll(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "joe-unified-session-"));
    sessionDir = path.join(tempRoot, "sessions");
    manager = new UnifiedSessionManager({ sessionDir });
  });

  afterAll(async () => {
    if (manager) {
      await manager.closeAll();
    }
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("创建 UnifiedSessionManager 实例", () => {
    expect(manager).toBeTruthy();
    expect(typeof manager.startSession).toBe("function");
  });

  it("启动新会话", async () => {
    const session = await manager.startSession({
      cwd: tempRoot,
      mode: "single",
      providerId: "local",
    });

    expect(session).toBeTruthy();
    expect(session.id).toBeTruthy();
    expect(session.path).toBeTruthy();
    expect(session.cwd).toBe(tempRoot);
    expect(session.mode).toBe("single");
    expect(session.providerId).toBe("local");

    // 写入 session 记录
    await manager.appendRecord(session, {
      type: "session",
      sessionId: session.id,
      timestamp: new Date().toISOString(),
      cwd: tempRoot,
      provider: "local",
      mode: "single",
    });

    // 写入 session_end 记录以强制刷新缓冲区
    await manager.appendRecord(session, {
      type: "session_end",
      sessionId: session.id,
      timestamp: new Date().toISOString(),
    });
  });

  it("列出会话", async () => {
    // 启动一个会话
    await manager.startSession({
      cwd: tempRoot,
      mode: "single",
      providerId: "local",
    });

    // 列出会话
    const sessions = await manager.listSessions();
    expect(sessions.length).toBeGreaterThan(0);
  });

  it("获取会话详情", async () => {
    // 启动一个会话
    const session = await manager.startSession({
      cwd: tempRoot,
      mode: "single",
      providerId: "local",
    });

    // 写入 session 记录
    await manager.appendRecord(session, {
      type: "session",
      sessionId: session.id,
      timestamp: new Date().toISOString(),
      cwd: tempRoot,
      provider: "local",
      mode: "single",
    });

    // 写入 session_end 记录以强制刷新缓冲区
    await manager.appendRecord(session, {
      type: "session_end",
      sessionId: session.id,
      timestamp: new Date().toISOString(),
    });

    // 获取详情
    const detail = await manager.getSession(session.id);
    expect(detail).toBeTruthy();
    expect(detail.id).toBe(session.id);
  });

  it("获取最新会话", async () => {
    // 启动一个会话
    const session = await manager.startSession({
      cwd: tempRoot,
      mode: "single",
      providerId: "local",
    });

    // 写入 session 记录
    await manager.appendRecord(session, {
      type: "session",
      sessionId: session.id,
      timestamp: new Date().toISOString(),
      cwd: tempRoot,
      provider: "local",
      mode: "single",
    });

    // 写入 session_end 记录以强制刷新缓冲区
    await manager.appendRecord(session, {
      type: "session_end",
      sessionId: session.id,
      timestamp: new Date().toISOString(),
    });

    // 获取最新会话
    const latest = await manager.getLatestSession();
    expect(latest).toBeTruthy();
    expect(latest.id).toBe(session.id);
  });

  it("搜索会话", async () => {
    // 启动一个会话
    const session = await manager.startSession({
      cwd: tempRoot,
      mode: "single",
      providerId: "local",
    });

    // 写入 session 记录
    await manager.appendRecord(session, {
      type: "session",
      sessionId: session.id,
      timestamp: new Date().toISOString(),
      cwd: tempRoot,
      provider: "local",
      mode: "single",
    });

    // 写入 session_end 记录以强制刷新缓冲区
    await manager.appendRecord(session, {
      type: "session_end",
      sessionId: session.id,
      timestamp: new Date().toISOString(),
    });

    // 列出会话
    const sessions = await manager.listSessions();
    expect(sessions.length).toBeGreaterThan(0);

    // 搜索会话（搜索会话 ID）
    const searchResult = await manager.searchSessions(session.id.substring(0, 10));
    expect(searchResult.length).toBeGreaterThan(0);
  });

  it("删除会话", async () => {
    // 启动一个会话
    const session = await manager.startSession({
      cwd: tempRoot,
      mode: "single",
      providerId: "local",
    });

    // 写入 session 记录
    await manager.appendRecord(session, {
      type: "session",
      sessionId: session.id,
      timestamp: new Date().toISOString(),
      cwd: tempRoot,
      provider: "local",
      mode: "single",
    });

    // 写入 session_end 记录以强制刷新缓冲区
    await manager.appendRecord(session, {
      type: "session_end",
      sessionId: session.id,
      timestamp: new Date().toISOString(),
    });

    // 删除会话
    const deleted = await manager.deleteSession(session.id);
    expect(deleted).toBe(true);

    // 验证会话已删除
    const detail = await manager.getSession(session.id);
    expect(detail).toBeNull();
  });

  it("获取统计信息", async () => {
    // 获取统计信息
    const stats = await manager.getStats();
    expect(stats).toBeTruthy();
    expect(typeof stats.totalSessions).toBe("number");
    expect(typeof stats.totalMessages).toBe("number");
  });

  it("创建子 Agent 会话", async () => {
    // 启动父会话
    const parent = await manager.startSession({
      cwd: tempRoot,
      mode: "single",
      providerId: "local",
    });

    // 创建子会话
    const child = await manager.createChildSession(parent, "test-child");
    expect(child).toBeTruthy();
    expect(child.id).toContain("-child-test-child");
    expect(child.parentId).toBe(parent.id);
  });

  it("关闭所有会话", async () => {
    // 启动一个会话
    await manager.startSession({
      cwd: tempRoot,
      mode: "single",
      providerId: "local",
    });

    // 关闭所有会话
    await manager.closeAll();

    // 验证可以创建新会话
    const session = await manager.startSession({
      cwd: tempRoot,
      mode: "single",
      providerId: "local",
    });
    expect(session).toBeTruthy();
  });

  it("获取底层 SessionManager", () => {
    const sessionManager = manager.getSessionManager();
    expect(sessionManager).toBeTruthy();
    expect(typeof sessionManager.startSession).toBe("function");
  });
});
