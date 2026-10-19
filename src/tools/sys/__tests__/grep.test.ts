/**
 * grep.test.ts - 搜索探针与引擎检测单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ToolExecutionContext } from '../../core/tool-types.js';
import {
  createGrepTool,
  compilePattern,
  runNodeFallback,
} from '../grep.js';
import {
  detectSearchEngine,
  clearSearchEngineCache,
  setCommandRunnerForTesting,
} from '../grep/search-engine-detector.js';
import {
  formatGrepOutput,
  parseRawGrepOutput,
  type FileGrepResult,
} from '../grep/grep-formatter.js';

describe('search-engine-detector', () => {
  beforeEach(() => {
    clearSearchEngineCache();
    setCommandRunnerForTesting(null);
  });

  afterEach(() => {
    clearSearchEngineCache();
    setCommandRunnerForTesting(null);
  });

  it('优先检测到 ripgrep (rg 可用时)', async () => {
    const mockRunner = vi.fn().mockImplementation(async (file: string) => {
      if (file === 'rg') {
        return { stdout: 'ripgrep 14.1.0\n', stderr: '' };
      }
      throw new Error('command not found');
    });
    setCommandRunnerForTesting(mockRunner);

    const engine = await detectSearchEngine('/test/workspace');
    expect(engine).toBe('ripgrep');
    expect(mockRunner).toHaveBeenCalledWith('rg', ['--version'], expect.any(Object));
  });

  it('当 rg 失败且在 git 仓库中时降级到 git-grep', async () => {
    const mockRunner = vi.fn().mockImplementation(async (file: string) => {
      if (file === 'rg') {
        throw new Error('rg: not found');
      }
      if (file === 'git') {
        return { stdout: 'true\n', stderr: '' };
      }
      throw new Error('not found');
    });
    setCommandRunnerForTesting(mockRunner);

    const engine = await detectSearchEngine('/test/workspace');
    expect(engine).toBe('git-grep');
  });

  it('当 rg 与 git 均不可用时降级为 node', async () => {
    const mockRunner = vi.fn().mockImplementation(async () => {
      throw new Error('command not found');
    });
    setCommandRunnerForTesting(mockRunner);

    const engine = await detectSearchEngine('/test/workspace');
    expect(engine).toBe('node');
  });

  it('使用 cwd 缓存避免重复执行外部探测', async () => {
    const mockRunner = vi.fn().mockImplementation(async () => {
      throw new Error('not found');
    });
    setCommandRunnerForTesting(mockRunner);

    const first = await detectSearchEngine('/cached/dir');
    const second = await detectSearchEngine('/cached/dir');
    expect(first).toBe('node');
    expect(second).toBe('node');
    // 第二次直接走缓存，runner 不会被重复调用
    expect(mockRunner).toHaveBeenCalledTimes(2); // 一次 rg, 一次 git
  });
});

describe('grep-formatter', () => {
  it('正确解析带有匹配行与上下文行的 raw 输出', () => {
    const raw = [
      'src/App.tsx-41-import React from "react";',
      'src/App.tsx-42-import { Box } from "ink";',
      'src/App.tsx:43:export function App() {',
      'src/App.tsx-44-  return <Box />;',
      'src/App.tsx-45-}',
    ].join('\n');

    const parsed = parseRawGrepOutput(raw, 100);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].filePath).toBe('src/App.tsx');
    expect(parsed[0].lines).toHaveLength(5);

    const matchLine = parsed[0].lines.find((l) => l.lineNum === 43);
    expect(matchLine?.isMatch).toBe(true);
    expect(matchLine?.content).toBe('export function App() {');

    const ctxLine = parsed[0].lines.find((l) => l.lineNum === 42);
    expect(ctxLine?.isMatch).toBe(false);
  });

  it('包含模式 (includePattern) 正确过滤非匹配后缀文件', () => {
    const raw = [
      'src/test.ts:1:const a = 1;',
      'src/test.js:1:const b = 2;',
      'src/style.css:1:body { color: red; }',
    ].join('\n');

    const parsed = parseRawGrepOutput(raw, 100, '*.ts');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].filePath).toBe('src/test.ts');
  });

  it('超过 maxMatches 时正确截断匹配数', () => {
    const raw = [
      'src/a.ts:10:match one',
      'src/a.ts:20:match two',
      'src/a.ts:30:match three',
    ].join('\n');

    const parsed = parseRawGrepOutput(raw, 2);
    const totalMatches = parsed[0].lines.filter((l) => l.isMatch).length;
    expect(totalMatches).toBe(2);
  });

  it('formatGrepOutput 生成符合规范的美化输出与统计摘要', () => {
    const mockResults: FileGrepResult[] = [
      {
        filePath: 'src/tui/App.tsx',
        lines: [
          { lineNum: 42, isMatch: false, content: "import { Box } from 'ink';" },
          { lineNum: 43, isMatch: true, content: 'export function App() {' },
          { lineNum: 44, isMatch: false, content: '  return <Box />;' },
        ],
      },
    ];

    const output = formatGrepOutput(mockResults, 'ripgrep');
    expect(output).toContain('Found 1 matches in 1 files (using ripgrep engine)');
    expect(output).toContain('src/tui/App.tsx');
    expect(output).toContain("42- import { Box } from 'ink';");
    expect(output).toContain('43: export function App() {');
    expect(output).toContain('44-   return <Box />;');
  });

  it('无匹配时返回 0 匹配摘要', () => {
    const output = formatGrepOutput([], 'node');
    expect(output).toBe('Found 0 matches in 0 files (using node engine)');
  });
});

describe('grep tool integration', () => {
  const tool = createGrepTool();
  const context: ToolExecutionContext = {
    cwd: process.cwd(),
    sessionId: 'test-session',
    turn: 1,
  };

  it('能够正常执行并搜索当前仓库中的符号', async () => {
    const res = await tool.execute(
      {
        pattern: 'export function createGrepTool',
        path: 'src/tools/sys',
        include: '*.ts',
      },
      context,
    );

    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.output).toContain('createGrepTool');
      expect(res.output).toMatch(/Found \d+ matches in \d+ files/);
    }
  });

  it('支持 contextLines 并输出上下文行与匹配行区分标记', async () => {
    const res = await tool.execute(
      {
        pattern: 'createGrepTool',
        path: 'src/tools/sys/grep.ts',
        contextLines: 2,
      },
      context,
    );

    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.output).toMatch(/\d+:/);
      expect(res.output).toMatch(/\d+-/);
    }
  });

  it('支持 ignoreCase 参数', async () => {
    const sensitiveRes = await tool.execute(
      {
        pattern: 'CREATEGREPTOOL',
        path: 'src/tools/sys/grep.ts',
        ignoreCase: false,
      },
      context,
    );
    expect(sensitiveRes.status).toBe('success');
    if (sensitiveRes.status === 'success') {
      expect(sensitiveRes.output).toContain('Found 0 matches');
    }

    const insensitiveRes = await tool.execute(
      {
        pattern: 'CREATEGREPTOOL',
        path: 'src/tools/sys/grep.ts',
        ignoreCase: true,
      },
      context,
    );
    expect(insensitiveRes.status).toBe('success');
    if (insensitiveRes.status === 'success') {
      expect(insensitiveRes.output).toMatch(/Found [1-9]\d* matches/);
    }
  });

  it('限制 maxMatches 截断生效', async () => {
    const res = await tool.execute(
      {
        pattern: 'import',
        path: 'src/tools/sys',
        include: '*.ts',
        maxMatches: 3,
      },
      context,
    );

    expect(res.status).toBe('success');
    if (res.status === 'success') {
      expect(res.output).toMatch(/Found [1-3] matches/);
    }
  });

  it('非法正则表达式返回错误状态', async () => {
    const res = await tool.execute(
      {
        pattern: '[unclosed regex',
      },
      context,
    );

    expect(res.status).toBe('error');
    if (res.status === 'error') {
      expect(res.error).toContain('无效的正则表达式');
    }
  });

  it('路径不存在时返回错误状态', async () => {
    const res = await tool.execute(
      {
        pattern: 'something',
        path: 'non_existent_folder_xyz_123',
      },
      context,
    );

    expect(res.status).toBe('error');
  });

  describe('runNodeFallback', () => {
    it('Node 回退引擎正常支持 contextLines 与 maxMatches', async () => {
      const { regex } = compilePattern('createGrepTool', false) as { regex: RegExp };
      const results = await runNodeFallback(
        regex,
        `${process.cwd()}/src/tools/sys/grep.ts`,
        undefined,
        2,
        10,
        process.cwd(),
      );

      expect(results.length).toBeGreaterThan(0);
      const matchLines = results[0].lines.filter((l) => l.isMatch);
      const ctxLines = results[0].lines.filter((l) => !l.isMatch);

      expect(matchLines.length).toBeGreaterThan(0);
      expect(ctxLines.length).toBeGreaterThan(0);
    });
  });
});
