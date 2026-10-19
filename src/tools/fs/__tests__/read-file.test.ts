/**
 * read-file.test.ts - read-file 工具单元测试
 *
 * 覆盖：
 * - 正常读取文本文件内容及元数据头
 * - 路径安全拦截（跨目录遍历攻击、符号链接越界、外部绝对路径）
 * - 文件不存在时友好错误
 * - 大文件保护与首尾截断机制（>200 行截断提示与隐藏行计数）
 * - 分页读取（offset、limit、offset 超出范围）
 * - 相对路径与 cwd 内绝对路径正确解析
 * - 参数校验异常（空路径、非正整数 offset/limit）
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initI18n } from "@locales/i18n.js";
import { createReadFileTool } from "../read-file.js";
import type { ToolExecutionContext, ToolExecutionResult } from "../../core/tool-types.js";

function assertSuccess(result: ToolExecutionResult): Extract<ToolExecutionResult, { status: "success" }> {
  expect(result.status).toBe("success");
  return result as Extract<ToolExecutionResult, { status: "success" }>;
}

function assertError(result: ToolExecutionResult): Extract<ToolExecutionResult, { status: "error" }> {
  expect(result.status).toBe("error");
  return result as Extract<ToolExecutionResult, { status: "error" }>;
}

describe("read-file 工具", () => {
  const tool = createReadFileTool();
  let cwd: string;
  let outsideFile: string;

  function makeContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
    return {
      sessionId: "test-session",
      turn: 1,
      cwd,
      ...overrides,
    };
  }

  beforeAll(async () => {
    await initI18n("zh");
    cwd = await mkdtemp(join(tmpdir(), "read-file-test-"));
    outsideFile = join(tmpdir(), `read-file-outside-${Date.now()}.txt`);
    await writeFile(outsideFile, "secret password content", "utf8");
  });

  afterAll(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(outsideFile, { force: true });
  });

  describe("基础文本读取", () => {
    it("正常读取小文件完整内容并包含行号与头部信息", async () => {
      const file = join(cwd, "small.txt");
      await writeFile(file, "line 1\nline 2\nline 3", "utf8");

      const result = await tool.execute({ path: "small.txt" }, makeContext());
      const success = assertSuccess(result);

      expect(success.output).toContain("📄 small.txt (3 lines");
      expect(success.output).toContain("1│line 1");
      expect(success.output).toContain("2│line 2");
      expect(success.output).toContain("3│line 3");
      expect(success.data).toMatchObject({
        path: "small.txt",
        totalLines: 3,
        truncated: false,
      });
    });

    it('单行文件头部正确显示 "1 line"', async () => {
      const file = join(cwd, "single.txt");
      await writeFile(file, "hello world", "utf8");

      const result = await tool.execute({ path: "single.txt" }, makeContext());
      const success = assertSuccess(result);

      expect(success.output).toContain("1 line");
      expect(success.output).toContain("1│hello world");
    });
  });

  describe("路径解析与安全沙箱", () => {
    it("跨目录遍历攻击 (../../etc/passwd) 被安全拦截", async () => {
      const result = await tool.execute({ path: "../../etc/passwd" }, makeContext());
      const error = assertError(result);
      expect(error.error).toBeDefined();
    });

    it("指向工作区外部的绝对路径被安全拦截", async () => {
      const result = await tool.execute({ path: outsideFile }, makeContext());
      const error = assertError(result);
      expect(error.error).toBeDefined();
    });

    it("符号链接逃逸至工作区外部被安全拦截", async () => {
      const symlinkPath = join(cwd, "link-outside.txt");
      await symlink(outsideFile, symlinkPath);

      const result = await tool.execute({ path: "link-outside.txt" }, makeContext());
      const error = assertError(result);
      expect(error.error).toBeDefined();
    });

    it("工作目录内的子目录相对路径正常解析", async () => {
      await mkdir(join(cwd, "sub", "dir"), { recursive: true });
      await writeFile(join(cwd, "sub", "dir", "nested.txt"), "nested content", "utf8");

      const result = await tool.execute({ path: "sub/dir/nested.txt" }, makeContext());
      const success = assertSuccess(result);
      expect(success.output).toContain("nested content");
    });

    it("工作目录内的绝对路径正常解析", async () => {
      const absPath = join(cwd, "sub", "dir", "nested.txt");
      const result = await tool.execute({ path: absPath }, makeContext());
      const success = assertSuccess(result);
      expect(success.output).toContain("nested content");
    });
  });

  describe("文件不存在处理", () => {
    it("文件不存在时返回包含 ENOENT 提示的友好错误", async () => {
      const result = await tool.execute({ path: "not-found.txt" }, makeContext());
      const error = assertError(result);
      expect(error.error).toMatch(/ENOENT|no such file/i);
    });
  });

  describe("大文件保护与截断机制", () => {
    it("超过 200 行的大文件自动截断首尾各 50 行并提示隐藏行数", async () => {
      const file = join(cwd, "large.txt");
      const lines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`);
      await writeFile(file, lines.join("\n"), "utf8");

      const result = await tool.execute({ path: "large.txt" }, makeContext());
      const success = assertSuccess(result);

      expect(success.output).toContain("truncated, use offset/limit to read more");
      expect(success.output).toContain("150 lines hidden");
      expect(success.output).toContain("1│line 1");
      expect(success.output).toContain("50│line 50");
      expect(success.output).toContain("201│line 201");
      expect(success.output).toContain("250│line 250");
      expect(success.output).not.toContain("100│line 100");

      expect(success.data).toMatchObject({
        path: "large.txt",
        totalLines: 250,
        truncated: true,
        hiddenLines: 150,
      });
    });
  });

  describe("分页读取 (offset & limit)", () => {
    beforeAll(async () => {
      const file = join(cwd, "page-test.txt");
      const lines = Array.from({ length: 100 }, (_, i) => `content line ${i + 1}`);
      await writeFile(file, lines.join("\n"), "utf8");
    });

    it("支持指定 offset 和 limit 读取局部行范围", async () => {
      const result = await tool.execute(
        { path: "page-test.txt", offset: 10, limit: 5 },
        makeContext()
      );
      const success = assertSuccess(result);

      expect(success.output).toContain("lines 10-14");
      expect(success.output).toContain("10│content line 10");
      expect(success.output).toContain("14│content line 14");
      expect(success.output).not.toContain("9│content line 9");
      expect(success.output).not.toContain("15│content line 15");

      expect(success.data).toMatchObject({
        path: "page-test.txt",
        totalLines: 100,
        shownLines: 5,
        offset: 10,
      });
    });

    it("只传 limit 时从第 1 行开始读取", async () => {
      const result = await tool.execute(
        { path: "page-test.txt", limit: 3 },
        makeContext()
      );
      const success = assertSuccess(result);

      expect(success.output).toContain("lines 1-3");
      expect(success.output).toContain("1│content line 1");
      expect(success.output).toContain("3│content line 3");
      expect(success.output).not.toContain("4│content line 4");
    });

    it("只传 offset 时从 offset 读取至文件末尾", async () => {
      const result = await tool.execute(
        { path: "page-test.txt", offset: 95 },
        makeContext()
      );
      const success = assertSuccess(result);

      expect(success.output).toContain("lines 95-100");
      expect(success.output).toContain("95│content line 95");
      expect(success.output).toContain("100│content line 100");
    });

    it("offset 超过文件总行数时返回错误", async () => {
      const result = await tool.execute(
        { path: "page-test.txt", offset: 500, limit: 10 },
        makeContext()
      );
      const error = assertError(result);
      expect(error.error).toBeDefined();
    });
  });

  describe("输入 Schema 校验", () => {
    it("缺少 path 参数时报错", async () => {
      const result = await tool.execute({}, makeContext());
      assertError(result);
    });

    it("path 为空字符串时报错", async () => {
      const result = await tool.execute({ path: "" }, makeContext());
      assertError(result);
    });

    it("offset 或 limit 为非正整数时报错", async () => {
      const result1 = await tool.execute({ path: "small.txt", offset: 0 }, makeContext());
      assertError(result1);

      const result2 = await tool.execute({ path: "small.txt", limit: -1 }, makeContext());
      assertError(result2);
    });
  });
});
