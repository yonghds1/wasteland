/**
 * list-directory.test.ts - list-directory 工具单元测试
 *
 * 覆盖：
 * - 基础平铺列表（默认当前目录、指定子目录、文件/目录图标与排序）
 * - 空目录处理（empty directory 提示）
 * - 隐藏文件过滤与显式展示（showHidden: false vs true）
 * - 递归列表与最大递归深度限制（MAX_DEPTH = 5 深度截断）
 * - 默认黑名单目录递归忽略（node_modules, .git, dist, build, .next, coverage）
 * - 异常与安全沙箱拦截（非目录文件报错、路径不存在报错、跨目录遍历攻击）
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createListDirectoryTool } from "../list-directory.js";
import type { ToolExecutionContext, ToolExecutionResult } from "../../core/tool-types.js";

function assertSuccess(result: ToolExecutionResult): Extract<ToolExecutionResult, { status: "success" }> {
  expect(result.status).toBe("success");
  return result as Extract<ToolExecutionResult, { status: "success" }>;
}

function assertError(result: ToolExecutionResult): Extract<ToolExecutionResult, { status: "error" }> {
  expect(result.status).toBe("error");
  return result as Extract<ToolExecutionResult, { status: "error" }>;
}

describe("list-directory 工具", () => {
  const tool = createListDirectoryTool();
  let cwd: string;
  let outsideDir: string;

  function makeContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
    return {
      sessionId: "test-session",
      turn: 1,
      cwd,
      ...overrides,
    };
  }

  beforeAll(async () => {
    cwd = await mkdtemp(join(tmpdir(), "list-dir-test-"));
    outsideDir = await mkdtemp(join(tmpdir(), "list-dir-outside-"));
  });

  afterAll(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  describe("基础平铺列表", () => {
    beforeAll(async () => {
      await mkdir(join(cwd, "src"), { recursive: true });
      await writeFile(join(cwd, "index.ts"), "console.log(1);", "utf8");
      await writeFile(join(cwd, "config.json"), "{}", "utf8");
      await writeFile(join(cwd, "README.md"), "# Readme", "utf8");
    });

    it("默认列出当前工作目录内容并按目录优先排序", async () => {
      const result = await tool.execute({}, makeContext());
      const success = assertSuccess(result);

      expect(success.output).toContain("entries (flat)");
      expect(success.output).toContain("📁 src");
      expect(success.output).toContain("📘 index.ts");
      expect(success.output).toContain("📋 config.json");
      expect(success.output).toContain("📝 README.md");

      // 目录排在文件前面
      const dirIndex = success.output.indexOf("📁 src");
      const tsIndex = success.output.indexOf("📘 index.ts");
      expect(dirIndex).toBeLessThan(tsIndex);
    });

    it("列出指定子目录内容", async () => {
      await writeFile(join(cwd, "src", "app.ts"), "export const app = 1;", "utf8");

      const result = await tool.execute({ path: "src" }, makeContext());
      const success = assertSuccess(result);

      expect(success.output).toContain("📘 app.ts");
    });

    it("空目录输出 empty directory 提示", async () => {
      await mkdir(join(cwd, "empty-folder"), { recursive: true });

      const result = await tool.execute({ path: "empty-folder" }, makeContext());
      const success = assertSuccess(result);

      expect(success.output).toContain("empty directory");
    });
  });

  describe("隐藏文件处理", () => {
    beforeAll(async () => {
      await mkdir(join(cwd, "hidden-test"), { recursive: true });
      await writeFile(join(cwd, "hidden-test", ".env"), "SECRET=123", "utf8");
      await writeFile(join(cwd, "hidden-test", "visible.txt"), "hello", "utf8");
    });

    it("默认（showHidden: false）不显示隐藏文件", async () => {
      const result = await tool.execute({ path: "hidden-test" }, makeContext());
      const success = assertSuccess(result);

      expect(success.output).toContain("visible.txt");
      expect(success.output).not.toContain(".env");
    });

    it("showHidden: true 时显示隐藏文件", async () => {
      const result = await tool.execute(
        { path: "hidden-test", showHidden: true },
        makeContext()
      );
      const success = assertSuccess(result);

      expect(success.output).toContain("visible.txt");
      expect(success.output).toContain(".env");
    });
  });

  describe("递归列出与最大深度限制", () => {
    beforeAll(async () => {
      // 构造超过 5 层的深度目录
      // d0 (rec-test) -> d1 -> d2 -> d3 -> d4 -> d5 -> d6
      const d5 = join(cwd, "rec-test", "l1", "l2", "l3", "l4", "l5");
      const d6 = join(d5, "l6");
      await mkdir(d6, { recursive: true });

      await writeFile(join(d5, "file-at-d5.txt"), "at d5", "utf8");
      await writeFile(join(d6, "file-at-d6.txt"), "at d6", "utf8");
    });

    it("递归模式列出子目录中的条目并输出相对路径", async () => {
      const result = await tool.execute(
        { path: "rec-test", recursive: true },
        makeContext()
      );
      const success = assertSuccess(result);

      expect(success.output).toContain("entries (recursive)");
      expect(success.output).toContain("l1");
      expect(success.output).toContain("l1/l2");
    });

    it("受到 MAX_DEPTH (5) 限制，超过 5 层的子目录内容不被递归", async () => {
      const result = await tool.execute(
        { path: "rec-test", recursive: true },
        makeContext()
      );
      const success = assertSuccess(result);

      // depth 5 的文件包含在内
      expect(success.output).toContain("file-at-d5.txt");
      // depth 6 (深于 maxDepth 5) 的文件不应被递归遍历到
      expect(success.output).not.toContain("file-at-d6.txt");
    });
  });

  describe("默认黑名单目录递归忽略", () => {
    beforeAll(async () => {
      await mkdir(join(cwd, "ignore-test", "node_modules", "pkg"), { recursive: true });
      await mkdir(join(cwd, "ignore-test", "dist", "bundle"), { recursive: true });
      await mkdir(join(cwd, "ignore-test", "src"), { recursive: true });

      await writeFile(join(cwd, "ignore-test", "node_modules", "pkg", "index.js"), "module", "utf8");
      await writeFile(join(cwd, "ignore-test", "dist", "bundle", "out.js"), "dist", "utf8");
      await writeFile(join(cwd, "ignore-test", "src", "main.ts"), "code", "utf8");
    });

    it("递归时自动忽略 node_modules 和 dist 等黑名单目录内部的文件", async () => {
      const result = await tool.execute(
        { path: "ignore-test", recursive: true },
        makeContext()
      );
      const success = assertSuccess(result);

      expect(success.output).toContain("src/main.ts");
      // node_modules 内部文件被忽略
      expect(success.output).not.toContain("node_modules/pkg/index.js");
      expect(success.output).not.toContain("pkg/index.js");
      // dist 内部文件被忽略
      expect(success.output).not.toContain("dist/bundle/out.js");
      expect(success.output).not.toContain("bundle/out.js");
    });
  });

  describe("异常处理与安全沙箱", () => {
    it("跨目录遍历攻击 (../../etc) 被安全拦截", async () => {
      const result = await tool.execute({ path: "../../etc" }, makeContext());
      const error = assertError(result);
      expect(error.error).toContain("工作目录之外");
    });

    it("指向工作区外部的绝对路径被安全拦截", async () => {
      const result = await tool.execute({ path: outsideDir }, makeContext());
      const error = assertError(result);
      expect(error.error).toContain("工作目录之外");
    });

    it("目标路径为普通文件而非目录时报错", async () => {
      const filePath = join(cwd, "regular-file.txt");
      await writeFile(filePath, "regular", "utf8");

      const result = await tool.execute({ path: "regular-file.txt" }, makeContext());
      const error = assertError(result);
      expect(error.error).toContain("不是一个目录");
    });

    it("目标目录不存在时报错", async () => {
      const result = await tool.execute({ path: "non-existent-folder" }, makeContext());
      const error = assertError(result);
      expect(error.error).toContain("不存在或无法访问");
    });
  });
});
