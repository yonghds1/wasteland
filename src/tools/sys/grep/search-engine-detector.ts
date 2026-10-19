/**
 * search-engine-detector.ts - 搜索探针引擎检测器
 *
 * 按照优先级探测当前环境下最快的搜索工具：
 * 1. ripgrep (rg) - 极速本地二进制搜索
 * 2. git-grep - git 仓库内置索引加速
 * 3. node - 纯 node stream 并发读取保底方案
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type SearchEngineType = 'ripgrep' | 'git-grep' | 'node';

export type CommandRunner = (
  file: string,
  args: string[],
  options?: { cwd?: string; timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

const engineCache = new Map<string, SearchEngineType>();
let testRunner: CommandRunner | null = null;

/**
 * 注入自定义命令执行器（供单元测试 Mock 使用）
 */
export function setCommandRunnerForTesting(runner: CommandRunner | null): void {
  testRunner = runner;
}

/**
 * 清除引擎探测缓存（主要用于单元测试与环境重置）
 */
export function clearSearchEngineCache(): void {
  engineCache.clear();
}

async function runCmd(
  file: string,
  args: string[],
  options?: { cwd?: string; timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
  if (testRunner) {
    return testRunner(file, args, options);
  }
  const result = await execFileAsync(file, args, options);
  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
}

/**
 * 探测当前工作目录下可用的最优搜索引擎
 *
 * @param cwd - 目标工作目录
 * @returns 搜索引擎类型 ('ripgrep' | 'git-grep' | 'node')
 */
export async function detectSearchEngine(cwd: string): Promise<SearchEngineType> {
  const cached = engineCache.get(cwd);
  if (cached) {
    return cached;
  }

  // 1. 检测是否能执行 rg --version
  try {
    await runCmd('rg', ['--version'], { timeout: 2000 });
    engineCache.set(cwd, 'ripgrep');
    return 'ripgrep';
  } catch {
    // rg 不可用或执行失败，降级检测 git
  }

  // 2. 检测 cwd 是否在 git 仓库中 (通过 git rev-parse --is-inside-work-tree)
  try {
    const { stdout } = await runCmd('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      timeout: 2000,
    });
    if (stdout.trim() === 'true') {
      engineCache.set(cwd, 'git-grep');
      return 'git-grep';
    }
  } catch {
    // git 不可用或不是 git 仓库
  }

  // 3. Fallback 到纯 Node
  engineCache.set(cwd, 'node');
  return 'node';
}
