/**
 * edit-file.test.ts - edit-file 工具单元测试
 *
 * 覆盖：
 * - 单处替换（原 path + old_string + new_string + replace_all 参数，行为不变）
 * - 批量多编辑（edits 数组按顺序逐条替换同一文件的多处内容）
 * - replace_all（单处与批量条目各自生效）
 * - 无匹配错误（单处与批量，批量指出是哪条 edits）
 * - 多匹配错误（replace_all 为 false 时，批量指出是哪条 edits）
 * - edits 与单处参数冲突、两者都空、单处缺参
 * - 路径安全（目录穿越 / 绝对路径 / 符号链接穿越）
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initI18n } from '@locales/i18n.js';
import { createEditFileTool } from '../edit-file.js';
import type { ToolExecutionContext, ToolExecutionResult } from '../tool-types.js';

function assertSuccess(result: ToolExecutionResult): Extract<ToolExecutionResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  return result as Extract<ToolExecutionResult, { status: 'success' }>;
}

function assertError(result: ToolExecutionResult): Extract<ToolExecutionResult, { status: 'error' }> {
  expect(result.status).toBe('error');
  return result as Extract<ToolExecutionResult, { status: 'error' }>;
}

describe('edit-file 工具', () => {
  const tool = createEditFileTool();
  let cwd: string;
  let outsideFile: string;

  function makeContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
    return {
      sessionId: 'test-session',
      turn: 1,
      cwd,
      ...overrides,
    };
  }

  beforeAll(async () => {
    await initI18n('zh');
    cwd = await mkdtemp(join(tmpdir(), 'edit-file-test-'));
    outsideFile = join(tmpdir(), `edit-file-outside-${Date.now()}.txt`);
    await writeFile(outsideFile, 'secret', 'utf8');
  });

  afterAll(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(outsideFile, { force: true });
  });

  // ============================================================
  // 单处替换（原参数，行为不变）
  // ============================================================

  describe('单处替换（原参数）', () => {
    it('替换单个匹配', async () => {
      const file = join(cwd, 'single.txt');
      await writeFile(file, 'hello world foo', 'utf8');

      const result = await tool.execute(
        { path: 'single.txt', old_string: 'world', new_string: 'there' },
        makeContext()
      );

      assertSuccess(result);
      expect(await readFile(file, 'utf8')).toBe('hello there foo');
    });

    it('replace_all=true 替换所有匹配', async () => {
      const file = join(cwd, 'replace-all.txt');
      await writeFile(file, 'a-b-a-b-a', 'utf8');

      const result = await tool.execute(
        { path: 'replace-all.txt', old_string: 'a', new_string: 'x', replace_all: true },
        makeContext()
      );

      assertSuccess(result);
      expect(await readFile(file, 'utf8')).toBe('x-b-x-b-x');
    });

    it('replace_all=false 时多匹配报错且文件不变', async () => {
      const file = join(cwd, 'multi.txt');
      await writeFile(file, 'a-a-a', 'utf8');

      const result = await tool.execute(
        { path: 'multi.txt', old_string: 'a', new_string: 'x' },
        makeContext()
      );

      const error = assertError(result);
      expect(error.error).toContain('replace_all');
      expect(await readFile(file, 'utf8')).toBe('a-a-a');
    });

    it('无匹配时报错且文件不变', async () => {
      const file = join(cwd, 'no-match.txt');
      await writeFile(file, 'hello', 'utf8');

      const result = await tool.execute(
        { path: 'no-match.txt', old_string: 'zzz', new_string: 'x' },
        makeContext()
      );

      const error = assertError(result);
      expect(error.error).toContain('未找到');
      expect(await readFile(file, 'utf8')).toBe('hello');
    });

    it('只传 old_string 缺 new_string 时报错', async () => {
      const file = join(cwd, 'missing-new.txt');
      await writeFile(file, 'hello', 'utf8');

      const result = await tool.execute({ path: 'missing-new.txt', old_string: 'hello' }, makeContext());

      assertError(result);
    });

    it('成功返回替换数量', async () => {
      const file = join(cwd, 'success-output.txt');
      await writeFile(file, 'one two', 'utf8');

      const result = await tool.execute(
        { path: 'success-output.txt', old_string: 'one', new_string: '1' },
        makeContext()
      );

      const success = assertSuccess(result);
      expect(success.output).toContain('1');
    });
  });

  // ============================================================
  // 批量编辑（edits 数组）
  // ============================================================

  describe('批量编辑（edits 数组）', () => {
    it('按顺序逐条替换同一文件的多处内容', async () => {
      const file = join(cwd, 'batch.txt');
      await writeFile(file, 'foo bar baz qux', 'utf8');

      const result = await tool.execute(
        {
          path: 'batch.txt',
          edits: [
            { old_string: 'foo', new_string: 'FOO' },
            { old_string: 'bar', new_string: 'BAR' },
            { old_string: 'baz', new_string: 'BAZ' },
          ],
        },
        makeContext()
      );

      assertSuccess(result);
      expect(await readFile(file, 'utf8')).toBe('FOO BAR BAZ qux');
    });

    it('编辑按顺序应用，前一条结果作为后一条输入', async () => {
      const file = join(cwd, 'batch-order.txt');
      await writeFile(file, 'cat', 'utf8');

      const result = await tool.execute(
        {
          path: 'batch-order.txt',
          edits: [
            { old_string: 'cat', new_string: 'dog' },
            { old_string: 'dog', new_string: 'bird' },
          ],
        },
        makeContext()
      );

      assertSuccess(result);
      expect(await readFile(file, 'utf8')).toBe('bird');
    });

    it('支持每条 edit 独立的 replace_all', async () => {
      const file = join(cwd, 'batch-replace-all.txt');
      await writeFile(file, 'a a b', 'utf8');

      const result = await tool.execute(
        {
          path: 'batch-replace-all.txt',
          edits: [
            { old_string: 'a', new_string: 'X', replace_all: true },
            { old_string: 'b', new_string: 'Y' },
          ],
        },
        makeContext()
      );

      assertSuccess(result);
      expect(await readFile(file, 'utf8')).toBe('X X Y');
    });

    it('某条无匹配时报错并指出条目，文件保持原子不变', async () => {
      const file = join(cwd, 'batch-no-match.txt');
      await writeFile(file, 'foo bar', 'utf8');

      const result = await tool.execute(
        {
          path: 'batch-no-match.txt',
          edits: [
            { old_string: 'foo', new_string: 'FOO' },
            { old_string: 'zzz', new_string: 'ZZZ' },
          ],
        },
        makeContext()
      );

      const error = assertError(result);
      expect(error.error).toContain('第 2 条');
      expect(error.error).toContain('edits');
      // 第一条成功但整体不写入
      expect(await readFile(file, 'utf8')).toBe('foo bar');
    });

    it('某条多匹配且 replace_all=false 时报错并指出条目', async () => {
      const file = join(cwd, 'batch-multi.txt');
      await writeFile(file, 'x x y', 'utf8');

      const result = await tool.execute(
        {
          path: 'batch-multi.txt',
          edits: [{ old_string: 'x', new_string: 'X' }],
        },
        makeContext()
      );

      const error = assertError(result);
      expect(error.error).toContain('第 1 条');
      expect(error.error).toContain('replace_all');
      expect(await readFile(file, 'utf8')).toBe('x x y');
    });

    it('edits 数组为空时报错', async () => {
      const file = join(cwd, 'batch-empty.txt');
      await writeFile(file, 'hello', 'utf8');

      const result = await tool.execute({ path: 'batch-empty.txt', edits: [] }, makeContext());

      assertError(result);
    });

    it('批量成功返回总替换数量', async () => {
      const file = join(cwd, 'batch-output.txt');
      await writeFile(file, 'a b a', 'utf8');

      const result = await tool.execute(
        {
          path: 'batch-output.txt',
          edits: [
            { old_string: 'a', new_string: 'X', replace_all: true },
            { old_string: 'b', new_string: 'Y' },
          ],
        },
        makeContext()
      );

      const success = assertSuccess(result);
      // 2 处 a + 1 处 b = 3
      expect(success.output).toContain('3');
      expect(await readFile(file, 'utf8')).toBe('X Y X');
    });
  });

  // ============================================================
  // 模式校验（互斥 / 缺参）
  // ============================================================

  describe('模式校验', () => {
    it('edits 与 old_string/new_string 同时传入时报冲突错误', async () => {
      const file = join(cwd, 'conflict.txt');
      await writeFile(file, 'hello', 'utf8');

      const result = await tool.execute(
        {
          path: 'conflict.txt',
          old_string: 'hello',
          new_string: 'hi',
          edits: [{ old_string: 'hello', new_string: 'bye' }],
        },
        makeContext()
      );

      const error = assertError(result);
      expect(error.error).toContain('edits');
      expect(await readFile(file, 'utf8')).toBe('hello');
    });

    it('两者都空时报错', async () => {
      const file = join(cwd, 'none.txt');
      await writeFile(file, 'hello', 'utf8');

      const result = await tool.execute({ path: 'none.txt' }, makeContext());

      assertError(result);
    });

    it('缺少 path 时报错', async () => {
      const result = await tool.execute({ old_string: 'x', new_string: 'y' }, makeContext());

      assertError(result);
    });
  });

  // ============================================================
  // 路径安全
  // ============================================================

  describe('路径安全', () => {
    it('目录穿越路径被拒绝', async () => {
      const result = await tool.execute(
        { path: '../../etc/passwd', old_string: 'x', new_string: 'y' },
        makeContext()
      );

      const error = assertError(result);
      expect(error.error).toContain('相对路径');
    });

    it('绝对路径被拒绝', async () => {
      const result = await tool.execute(
        { path: outsideFile, old_string: 'x', new_string: 'y' },
        makeContext()
      );

      const error = assertError(result);
      expect(error.error).toContain('相对路径');
    });

    it('符号链接指向 cwd 外文件被拒绝且外部文件不变', async () => {
      const link = join(cwd, 'escape-link.txt');
      await symlink(outsideFile, link);

      const result = await tool.execute(
        { path: 'escape-link.txt', old_string: 'secret', new_string: 'hacked' },
        makeContext()
      );

      const error = assertError(result);
      expect(error.error).toContain('相对路径');
      expect(await readFile(outsideFile, 'utf8')).toBe('secret');
    });
  });
});
