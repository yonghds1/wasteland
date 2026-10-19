/**
 * glob.test.ts - glob 工具单元测试
 *
 * 覆盖：
 * - 基础模式匹配（单层通配符 *.ts、多层通配符等）
 * - 匹配数量限制与截断保护（limit 参数截断提示与数量统计）
 * - 默认忽略目录机制（自动忽略 node_modules, .git, dist 等）
 * - 显式指定特殊目录时的忽略绕过（如模式包含 node_modules）
 * - 自定义搜索目录（cwd 参数位于工作区内部正常匹配，位于工作区外部被安全拦截）
 * - 无匹配结果处理（no matches found）
 * - 参数校验异常（空 pattern、非正整数 limit）
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createGlobTool } from "../glob.js";
import type { ToolExecutionContext, ToolExecutionResult } from "../../core/tool-types.js";

function assertSuccess(result: ToolExecutionResult): Extract<ToolExecutionResult, { status: "success" }> {
  expect(result.status).toBe("success");
  return result as Extract<ToolExecutionResult, { status: "success" }>;
}

function assertError(result: ToolExecutionResult): Extract<ToolExecutionResult, { status: "error" }> {
  expect(result.status).toBe("error");
  return result as Extract<ToolExecutionResult, { status: "error" }>;
}

describe("glob 工具", () => {
  const tool = createGlobTool();
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
    cwd = await mkdtemp(join(tmpdir(), "glob-test-"));
    outsideDir = await mkdtemp(join(tmpdir(), "glob-outside-"));

    // 创建测试目录结构
    // 根目录文件
    await writeFile(join(cwd, "root.ts"), "export const root = true;", "utf8");
    await writeFile(join(cwd, "root.js"), "const root = true;", "utf8");
    await writeFile(join(cwd, "package.json"), "{}", "utf8");

    // 子目录文件
    await mkdir(join(cwd, "src", "utils"), { recursive: true });
    await writeFile(join(cwd, "src", "index.ts"), "export * from \x27./utils/helper.js\x27;", "utf8");
    await writeFile(join(cwd, "src", "utils", "helper.ts"), "export const helper = 1;", "utf8");
    await writeFile(join(cwd, "src", "config.json"), "{}", "utf8");

    // 默认忽略目录文件
    await mkdir(join(cwd, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(cwd, "node_modules", "pkg", "index.js"), "// nm", "utf8");
    await mkdir(join(cwd, "dist"), { recursive: true });
    await writeFile(join(cwd, "dist", "bundle.js"), "// dist", "utf8");
  });

  afterAll(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  });

  describe("基础模式匹配", () => {
    it("支持单层扩展名通配 (*.ts)", async () => {
      const result = await tool.execute({ pattern: "*.ts" }, makeContext());
      const success = assertSuccess(result);

      expect(success.output).toContain("root.ts");
      // 单层通配不应匹配深层 src/index.ts
      expect(success.output).not.toContain("src/index.ts");
    });

    it("支持跨层通配 (**/*.json)", async () => {
      const result = await tool.execute({ pattern: "**/*.json" }, makeContext());
      const success = assertSuccess(result);

      expect(success.output).toContain("package.json");
      expect(success.output).toContain("src/config.json");
    });

    it("支持跨层匹配全部 ts 文件 (**/*.ts)", async () => {
      const result = await tool.execute({ pattern: "**/*.ts" }, makeContext());
      const success = assertSuccess(result);

      expect(success.output).toContain("root.ts");
      expect(success.output).toContain("src/index.ts");
      expect(success.output).toContain("src/utils/helper.ts");
    });

    it("无任何匹配时友好输出 no matches found", async () => {
      const result = await tool.execute({ pattern: "**/*.nonexistent" }, makeContext());
      const success = assertSuccess(result);

      expect(success.output).toContain("no matches found");
    });
  });

  describe("默认忽略目录机制 (ignore)", () => {
    it("默认自动过滤 node_modules 与 dist 中的文件", async () => {
      const result = await tool.execute({ pattern: "**/*.js" }, makeContext());
      const success = assertSuccess(result);

      expect(success.output).toContain("root.js");
      expect(success.output).not.toContain("node_modules/pkg/index.js");
      expect(success.output).not.toContain("dist/bundle.js");
    });

    it("当模式中显式包含被忽略目录名时允许匹配该目录", async () => {
      const result = await tool.execute({ pattern: "node_modules/**/*.js" }, makeContext());
      const success = assertSuccess(result);

      expect(success.output).toContain("node_modules/pkg/index.js");
    });
  });

  describe("匹配数量限制 (limit) 与截断保护", () => {
    beforeAll(async () => {
      // 创建批量文件用于测试截断
      await mkdir(join(cwd, "batch"), { recursive: true });
      for (let i = 1; i <= 15; i++) {
        await writeFile(join(cwd, "batch", `file-${String(i).padStart(2, "0")}.txt`), `test ${i}`, "utf8");
      }
    });

    it("当匹配数超过 limit 时截断并提示剩余数量", async () => {
      const result = await tool.execute(
        { pattern: "batch/*.txt", limit: 5 },
        makeContext()
      );
      const success = assertSuccess(result);

      expect(success.output).toContain("5 of 15 matches");
      expect(success.output).toContain("10 more matches truncated");
    });

    it("未超过 limit 时正常显示总数且不提示截断", async () => {
      const result = await tool.execute(
        { pattern: "batch/*.txt", limit: 20 },
        makeContext()
      );
      const success = assertSuccess(result);

      expect(success.output).toContain("15 matches");
      expect(success.output).not.toContain("truncated");
    });
  });

  describe("自定义搜索根目录与安全沙箱", () => {
    it("在工作区内部的子目录中执行搜索", async () => {
      const result = await tool.execute(
        { pattern: "*.ts", cwd: "src" },
        makeContext()
      );
      const success = assertSuccess(result);

      expect(success.output).toContain("index.ts");
      expect(success.output).not.toContain("root.ts");
    });

    it("尝试搜索工作区外部的跨目录遍历路径被安全拦截", async () => {
      const result = await tool.execute(
        { pattern: "*.txt", cwd: "../../" },
        makeContext()
      );
      const error = assertError(result);
      expect(error.error).toContain("工作目录之外");
    });

    it("尝试搜索工作区外部的绝对路径被安全拦截", async () => {
      const result = await tool.execute(
        { pattern: "*.txt", cwd: outsideDir },
        makeContext()
      );
      const error = assertError(result);
      expect(error.error).toContain("工作目录之外");
    });
  });

  describe("输入 Schema 校验", () => {
    it("缺少 pattern 时报错", async () => {
      const result = await tool.execute({}, makeContext());
      assertError(result);
    });

    it("pattern 为空字符串时报错", async () => {
      const result = await tool.execute({ pattern: "" }, makeContext());
      assertError(result);
    });

    it("limit 为非正整数时报错", async () => {
      const result1 = await tool.execute({ pattern: "*.ts", limit: 0 }, makeContext());
      assertError(result1);

      const result2 = await tool.execute({ pattern: "*.ts", limit: -5 }, makeContext());
      assertError(result2);
    });
  });
});
