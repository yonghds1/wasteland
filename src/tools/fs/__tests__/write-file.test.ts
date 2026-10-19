/**
 * write-file.test.ts - write-file 工具单元测试
 *
 * 覆盖：
 * - 正常创建写入新文件（验证内容与字符数）
 * - 递归自动创建多层不存在的父目录
 * - 覆写已有文件（验证覆盖后内容与覆写提示）
 * - 安全沙箱越界拦截（跨目录遍历攻击、工作区外部绝对路径、符号链接越界）
 * - 参数校验（缺少参数、空路径）
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createWriteFileTool } from "../write-file.js";
import type { ToolExecutionContext, ToolExecutionResult } from "../../core/tool-types.js";

function assertSuccess(result: ToolExecutionResult): Extract<ToolExecutionResult, { status: "success" }> {
  expect(result.status).toBe("success");
  return result as Extract<ToolExecutionResult, { status: "success" }>;
}

function assertError(result: ToolExecutionResult): Extract<ToolExecutionResult, { status: "error" }> {
  expect(result.status).toBe("error");
  return result as Extract<ToolExecutionResult, { status: "error" }>;
}

describe("write-file 工具", () => {
  const tool = createWriteFileTool();
  let cwd: string;
  let outsideDir: string;
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
    cwd = await mkdtemp(join(tmpdir(), "write-file-test-"));
    outsideDir = await mkdtemp(join(tmpdir(), "write-file-outside-dir-"));
    outsideFile = join(outsideDir, "external.txt");
    await writeFile(outsideFile, "initial external content", "utf8");
  });

  afterAll(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  describe("基础文件写入", () => {
    it("正常创建写入新文件并输出字符统计", async () => {
      const content = "Hello, Wasteland!\nLine 2";
      const result = await tool.execute({ path: "new-file.txt", content }, makeContext());
      const success = assertSuccess(result);

      expect(success.output).toContain("成功创建文件");
      expect(success.output).toContain(`${content.length} 字符`);

      const written = await readFile(join(cwd, "new-file.txt"), "utf8");
      expect(written).toBe(content);
    });

    it("支持写入空内容文件", async () => {
      const result = await tool.execute({ path: "empty.txt", content: "" }, makeContext());
      const success = assertSuccess(result);

      expect(success.output).toContain("成功创建文件");
      expect(success.output).toContain("0 字符");

      const written = await readFile(join(cwd, "empty.txt"), "utf8");
      expect(written).toBe("");
    });

    it("支持包含中文字符与特殊字符的内容写入", async () => {
      const content = "你好，世界！这是一段包含 emoji 🚀 与特殊符号 <html> 的内容。";
      const result = await tool.execute({ path: "unicode.txt", content }, makeContext());
      const success = assertSuccess(result);

      expect(success.output).toContain("成功创建文件");
      expect(success.output).toContain(`${content.length} 字符`);

      const written = await readFile(join(cwd, "unicode.txt"), "utf8");
      expect(written).toBe(content);
    });
  });

  describe("多层父目录递归创建", () => {
    it("自动创建多层不存在的父目录并成功写入文件", async () => {
      const content = "export const deep = true;";
      const deepPath = "deeply/nested/sub/folder/config.ts";

      const result = await tool.execute({ path: deepPath, content }, makeContext());
      const success = assertSuccess(result);

      expect(success.output).toContain("成功创建文件");

      const written = await readFile(join(cwd, deepPath), "utf8");
      expect(written).toBe(content);
    });
  });

  describe("覆写已有文件", () => {
    it("成功覆盖已有文件并提示覆写", async () => {
      const initialPath = join(cwd, "overwrite-me.txt");
      await writeFile(initialPath, "version 1", "utf8");

      const newContent = "version 2 updated content";
      const result = await tool.execute(
        { path: "overwrite-me.txt", content: newContent },
        makeContext()
      );
      const success = assertSuccess(result);

      expect(success.output).toContain("成功覆写文件");
      expect(success.output).toContain(`${newContent.length} 字符`);

      const written = await readFile(initialPath, "utf8");
      expect(written).toBe(newContent);
    });
  });

  describe("安全沙箱与越界拦截", () => {
    it("跨目录遍历攻击 (../../evil.txt) 被安全阻断", async () => {
      const result = await tool.execute(
        { path: "../../evil.txt", content: "malicious" },
        makeContext()
      );
      const error = assertError(result);
      expect(error.error).toContain("当前工作目录内的相对路径");
    });

    it("尝试向工作区外部的绝对路径写入被安全阻断", async () => {
      const target = join(outsideDir, "hack.txt");
      const result = await tool.execute(
        { path: target, content: "malicious" },
        makeContext()
      );
      const error = assertError(result);
      expect(error.error).toContain("当前工作目录内的相对路径");
    });

    it("符号链接指向外部时写入被拦截且外部原文件不被篡改", async () => {
      const linkPath = join(cwd, "link-to-outside.txt");
      await symlink(outsideFile, linkPath);

      const result = await tool.execute(
        { path: "link-to-outside.txt", content: "tampered" },
        makeContext()
      );
      const error = assertError(result);
      expect(error.error).toContain("当前工作目录内的相对路径");

      // 验证外部文件未被篡改
      const content = await readFile(outsideFile, "utf8");
      expect(content).toBe("initial external content");
    });
  });

  describe("输入 Schema 校验", () => {
    it("缺少 path 参数时报错", async () => {
      const result = await tool.execute({ content: "test" }, makeContext());
      assertError(result);
    });

    it("缺少 content 参数时报错", async () => {
      const result = await tool.execute({ path: "test.txt" }, makeContext());
      assertError(result);
    });

    it("path 为空字符串时报错", async () => {
      const result = await tool.execute({ path: "", content: "test" }, makeContext());
      assertError(result);
    });
  });
});
