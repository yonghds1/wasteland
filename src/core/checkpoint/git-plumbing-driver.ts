/**
 * git-plumbing-driver.ts - Git Plumbing 纯净快照与工作区恢复底层驱动
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getGitExcludePathspecs, isIgnoredOrSensitive } from './safety-guard.js';

const pExecFile = promisify(execFile);

export interface GitContext {
  cwd: string;
  gitDir: string;
  workTree: string;
  isBare: boolean;
}

const DEFAULT_GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Wasteland Agent',
  GIT_AUTHOR_EMAIL: 'agent@wasteland.local',
  GIT_COMMITTER_NAME: 'Wasteland Agent',
  GIT_COMMITTER_EMAIL: 'agent@wasteland.local',
};

/**
 * 解析当前工作区的 Git 上下文，如果是非 Git 目录则在 .wasteland/checkpoints.git 初始化裸仓库
 */
export async function resolveGitContext(cwd: string): Promise<GitContext> {
  const normCwd = path.resolve(cwd);
  try {
    const { stdout: toplevel } = await pExecFile('git', ['rev-parse', '--show-toplevel'], { cwd: normCwd });
    const { stdout: gitDirOut } = await pExecFile('git', ['rev-parse', '--git-dir'], { cwd: normCwd });
    return {
      cwd: normCwd,
      gitDir: path.resolve(normCwd, gitDirOut.trim()),
      workTree: path.resolve(normCwd, toplevel.trim()),
      isBare: false,
    };
  } catch {
    const bareDir = path.join(normCwd, '.wasteland', 'checkpoints.git');
    if (!fsSync.existsSync(bareDir)) {
      await fs.mkdir(bareDir, { recursive: true });
      await pExecFile('git', ['init', '--bare', bareDir], { cwd: normCwd });
    }
    return {
      cwd: normCwd,
      gitDir: bareDir,
      workTree: normCwd,
      isBare: true,
    };
  }
}

/**
 * 在隔离的环境中执行 Git 命令
 */
export async function execGit(
  ctx: GitContext,
  args: string[],
  extraEnv?: Record<string, string>,
): Promise<string> {
  const baseArgs = ['--git-dir', ctx.gitDir, '--work-tree', ctx.workTree, ...args];
  const env: NodeJS.ProcessEnv = {
    ...DEFAULT_GIT_ENV,
    ...extraEnv,
  };
  const { stdout } = await pExecFile('git', baseArgs, {
    cwd: ctx.workTree,
    env,
    maxBuffer: 30 * 1024 * 1024,
  });
  return stdout;
}

/**
 * 临时索引执行沙箱：创建临时索引文件并在执行结束后保证删除
 */
export async function withTempIndex<T>(
  ctx: GitContext,
  action: (tempIndexPath: string) => Promise<T>,
): Promise<T> {
  const tmpDir = path.join(ctx.workTree, '.wasteland', 'tmp');
  await fs.mkdir(tmpDir, { recursive: true });
  const tempIndexPath = path.join(tmpDir, `idx_${randomUUID()}`);
  try {
    return await action(tempIndexPath);
  } finally {
    try {
      await fs.rm(tempIndexPath, { force: true });
    } catch {
      // 忽略临时文件清理异常
    }
  }
}

export class GitPlumbingDriver {
  /**
   * 创建当前工作区树快照并更新专用命名空间 Ref
   */
  async createSnapshotTree(
    cwd: string,
    sessionId: string,
    turnId: number,
  ): Promise<{ commitHash: string; treeHash: string; affectedFiles: string[] }> {
    const ctx = await resolveGitContext(cwd);
    return withTempIndex(ctx, async (tempIndex) => {
      const env = { GIT_INDEX_FILE: tempIndex };
      // 1. 将当前跟踪与未跟踪有效文件添加到临时索引，严格排除系统与敏感路径
      const addArgs = ['add', '-A', '--', '.', ...getGitExcludePathspecs()];
      await execGit(ctx, addArgs, env);

      // 2. 写入 Tree
      const treeOut = await execGit(ctx, ['write-tree'], env);
      const treeHash = treeOut.trim();

      // 3. 提交 Tree
      const commitMsg = `wasteland checkpoint: s=${sessionId} t=${turnId}`;
      const commitOut = await execGit(ctx, ['commit-tree', treeHash, '-m', commitMsg], env);
      const commitHash = commitOut.trim();

      // 4. 更新专属 Ref
      const refName = `refs/wasteland/checkpoints/${sessionId}/t${turnId}`;
      await execGit(ctx, ['update-ref', refName, commitHash]);

      // 5. 计算受影响的文件列表
      let affectedFiles: string[] = [];
      const prevRef = `refs/wasteland/checkpoints/${sessionId}/t${turnId - 1}`;
      let baseRefOrTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
      try {
        const prevCheck = await execGit(ctx, ['rev-parse', '--verify', '--quiet', prevRef]);
        if (prevCheck.trim()) {
          baseRefOrTree = prevRef;
        }
      } catch {
        // prev ref 不存在
      }

      try {
        const diffOut = await execGit(ctx, [
          'diff-tree',
          '-r',
          '--no-commit-id',
          '--name-only',
          baseRefOrTree,
          commitHash,
        ]);
        affectedFiles = diffOut
          .trim()
          .split('\n')
          .map((f) => f.trim())
          .filter((f) => f.length > 0 && !isIgnoredOrSensitive(f));
      } catch {
        // 忽略 diff 异常
      }

      return { commitHash, treeHash, affectedFiles };
    });
  }

  /**
   * 从指定快照恢复工作区，自动清理在后续轮次中新产生的文件
   */
  async restoreSnapshot(
    cwd: string,
    commitHash: string,
    files?: string[],
    currentCommitHash?: string,
  ): Promise<string[]> {
    const ctx = await resolveGitContext(cwd);
    return withTempIndex(ctx, async (tempIndex) => {
      const env = { GIT_INDEX_FILE: tempIndex };
      const restoredFiles: string[] = [];

      if (files && files.length > 0) {
        // 单文件 / 指定文件列表恢复
        const targetFilesSet = new Set(await this.listTreeFiles(ctx, commitHash));
        for (const file of files) {
          if (isIgnoredOrSensitive(file)) continue;
          if (targetFilesSet.has(file)) {
            await execGit(ctx, ['restore', `--source=${commitHash}`, '--worktree', '--', file], env);
            restoredFiles.push(file);
          } else {
            // 在目标快照中不存在，清理新增的文件
            const fullPath = path.resolve(ctx.workTree, file);
            await fs.rm(fullPath, { force: true });
            restoredFiles.push(file);
          }
        }
        return restoredFiles;
      }

      // 全量回滚
      let currentCommit = currentCommitHash;
      if (!currentCommit) {
        const addArgs = ['add', '-A', '--', '.', ...getGitExcludePathspecs()];
        await execGit(ctx, addArgs, env);
        currentCommit = (await execGit(ctx, ['write-tree'], env)).trim();
      }

      try {
        const diffStatusOut = await execGit(ctx, [
          'diff-tree',
          '-r',
          '--no-commit-id',
          '--name-status',
          commitHash,
          currentCommit,
        ]);
        const lines = diffStatusOut.trim().split('\n');
        for (const line of lines) {
          if (!line) continue;
          const [status, filePath] = line.split('\t');
          if (filePath && !isIgnoredOrSensitive(filePath)) {
            restoredFiles.push(filePath);
            if (status === 'A') {
              const fullPath = path.resolve(ctx.workTree, filePath);
              await fs.rm(fullPath, { force: true });
            }
          }
        }
      } catch {
        // 忽略比较错误
      }

      // 恢复工作区
      await execGit(ctx, ['restore', `--source=${commitHash}`, '--worktree', '--', '.'], env);

      if (restoredFiles.length === 0) {
        return await this.listTreeFiles(ctx, commitHash);
      }

      return restoredFiles;
    });
  }

  /**
   * 获取指定快照与当前工作区的 Unified Diff
   */
  async getDiff(cwd: string, commitHash: string, files?: string[]): Promise<string> {
    const ctx = await resolveGitContext(cwd);
    return withTempIndex(ctx, async (tempIndex) => {
      const env = { GIT_INDEX_FILE: tempIndex };
      await execGit(ctx, ['read-tree', commitHash], env);
      const targetPaths = files && files.length > 0 ? files : ['.'];
      return await execGit(ctx, ['diff', commitHash, '--', ...targetPaths], env);
    });
  }

  /**
   * 列出指定 Commit / Tree 中的全部有效文件相对路径
   */
  async listTreeFiles(ctxOrCwd: GitContext | string, commitOrTree: string): Promise<string[]> {
    const ctx = typeof ctxOrCwd === 'string' ? await resolveGitContext(ctxOrCwd) : ctxOrCwd;
    try {
      const out = await execGit(ctx, ['ls-tree', '-r', '--name-only', commitOrTree]);
      return out
        .trim()
        .split('\n')
        .map((f) => f.trim())
        .filter((f) => f.length > 0 && !isIgnoredOrSensitive(f));
    } catch {
      return [];
    }
  }
}

export const gitPlumbingDriver = new GitPlumbingDriver();
