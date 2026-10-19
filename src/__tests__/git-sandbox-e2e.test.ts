/**
 * git-sandbox-e2e.test.ts - 真实 Git 沙箱端到端生命周期测试
 *
 * 覆盖：
 * - withGitSandbox 纯净 Git 仓库脚手架
 * - 场景 1：Pre-Turn 快照 -> 文件修改与新增 -> rollback 原样还原（修改复原，新增清除）
 * - 场景 2：/redo 恢复现场能力
 * - 场景 3：refs/wasteland/checkpoints/ 专用命名空间完全隔离，不污染 git log 与 git branch
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GitCheckpointManager, resetCheckpointManager } from '../core/checkpoint/checkpoint-manager.js';

const pExecFile = promisify(execFile);

interface SandboxContext {
  dir: string;
  manager: GitCheckpointManager;
}

/** 在隔离沙箱中执行 Git 命令 */
async function execGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await pExecFile('git', args, { cwd });
  return stdout.trim();
}

/** 辅助脚手架：在 OS 临时目录创建独立的纯净 Git 仓库 */
async function withGitSandbox<T>(fn: (ctx: SandboxContext) => Promise<T>): Promise<T> {
  const sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wasteland-git-sandbox-e2e-'));
  resetCheckpointManager();
  const manager = new GitCheckpointManager();

  try {
    await execGit(sandboxDir, ['init']);
    await execGit(sandboxDir, ['config', 'user.name', 'Sandbox Tester']);
    await execGit(sandboxDir, ['config', 'user.email', 'sandbox@wasteland.local']);
    // 创建初始化 commit，建立合法的 Git HEAD 基线
    await fs.writeFile(path.join(sandboxDir, 'README.md'), '# Sandbox Test Repo\n');
    await execGit(sandboxDir, ['add', '.']);
    await execGit(sandboxDir, ['commit', '-m', 'Initial commit']);

    return await fn({ dir: sandboxDir, manager });
  } finally {
    resetCheckpointManager();
    try {
      await fs.rm(sandboxDir, { recursive: true, force: true });
    } catch {
      // 忽略清理异常
    }
  }
}

/** 辅助函数：判断文件是否存在 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe('Git 沙箱端到端生命周期测试 (Git Sandbox E2E)', () => {
  it('场景 1 & 2：快照捕获、修改新增、rollback 100% 还原以及 /redo 恢复现场', async () => {
    await withGitSandbox(async ({ dir, manager }) => {
      const sessionId = 'session-e2e-01';

      // 准备初始业务代码
      const srcDir = path.join(dir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const mainFile = path.join(srcDir, 'index.ts');
      await fs.writeFile(mainFile, 'console.log("version 1.0");\n');

      // 1. 调用 capturePreTurnCheckpoint 打下第 1 轮交互快照
      const chk1 = await manager.capturePreTurnCheckpoint({
        cwd: dir,
        sessionId,
        turnId: 1,
        prompt: 'Refactor index.ts and create new features',
      });
      expect(chk1.turnId).toBe(1);
      expect(chk1.commitHash).toBeDefined();

      // 2. 模拟 AI 在该轮次中修改既有文件并创建新增文件
      await fs.writeFile(mainFile, 'console.log("version 2.0 - modified by AI");\n');

      const featureFile = path.join(srcDir, 'feature.ts');
      await fs.writeFile(featureFile, 'export const feature = "AI generated feature";\n');

      const docsDir = path.join(dir, 'docs');
      await fs.mkdir(docsDir, { recursive: true });
      const docFile = path.join(docsDir, 'guide.md');
      await fs.writeFile(docFile, '# Guide\nCreated by agent.\n');

      // 验证当前工作区已被 AI 改变
      expect(await fs.readFile(mainFile, 'utf-8')).toBe('console.log("version 2.0 - modified by AI");\n');
      expect(await fileExists(featureFile)).toBe(true);
      expect(await fileExists(docFile)).toBe(true);

      // 3. 执行 rollback 回滚
      const rollbackResult = await manager.rollback({
        cwd: dir,
        sessionId,
        currentTurn: 1,
      });

      expect(rollbackResult.success).toBe(true);
      expect(rollbackResult.rolledBackTurn).toBe(1);
      expect(rollbackResult.targetTurn).toBe(1);

      // 4. 验证文件 100% 原样还原：修改的文件回退，新增的文件被完全删除
      const restoredMainContent = await fs.readFile(mainFile, 'utf-8');
      expect(restoredMainContent).toBe('console.log("version 1.0");\n');
      expect(await fileExists(featureFile)).toBe(false);
      expect(await fileExists(docFile)).toBe(false);

      // 5. 执行 /redo 重做，验证恢复现场能力
      const redoResult = await manager.redo({
        cwd: dir,
        sessionId,
      });

      expect(redoResult.success).toBe(true);
      expect(redoResult.targetTurn).toBe(1);

      // 验证 /redo 后 AI 的修改与新增文件重新完整恢复
      const redoMainContent = await fs.readFile(mainFile, 'utf-8');
      expect(redoMainContent).toBe('console.log("version 2.0 - modified by AI");\n');
      expect(await fileExists(featureFile)).toBe(true);
      expect(await fs.readFile(featureFile, 'utf-8')).toBe('export const feature = "AI generated feature";\n');
      expect(await fileExists(docFile)).toBe(true);
      expect(await fs.readFile(docFile, 'utf-8')).toBe('# Guide\nCreated by agent.\n');
    });
  });

  it('场景 3：验证 refs/wasteland/checkpoints/ 专用命名空间不会出现在常规 git log 和 git branch 中', async () => {
    await withGitSandbox(async ({ dir, manager }) => {
      const sessionId = 'session-e2e-isolation';

      // 建立两轮快照
      await fs.writeFile(path.join(dir, 'app.ts'), 'export const v = 1;\n');
      await manager.capturePreTurnCheckpoint({
        cwd: dir,
        sessionId,
        turnId: 1,
        prompt: 'Turn 1 isolation check',
      });

      await fs.writeFile(path.join(dir, 'app.ts'), 'export const v = 2;\n');
      await manager.capturePreTurnCheckpoint({
        cwd: dir,
        sessionId,
        turnId: 2,
        prompt: 'Turn 2 isolation check',
      });

      // 1. 验证常规 git branch（本地及全部分支）不含任何 wasteland checkpoints
      const branchOutput = await execGit(dir, ['branch', '-a']);
      expect(branchOutput).not.toContain('wasteland');
      expect(branchOutput).not.toContain('checkpoints');
      expect(branchOutput).toMatch(/\*?\s*(master|main)/);

      // 2. 验证常规 git log 不含快照的 commit 信息，仅保留用户真实的 commit
      const logOutput = await execGit(dir, ['log', '--oneline']);
      expect(logOutput).toContain('Initial commit');
      expect(logOutput).not.toContain('wasteland checkpoint');

      // 3. 验证专属命名空间通过底层 show-ref 真实存在且格式规范
      const showRefOutput = await execGit(dir, ['show-ref']);
      expect(showRefOutput).toContain(`refs/wasteland/checkpoints/${sessionId}/t1`);
      expect(showRefOutput).toContain(`refs/wasteland/checkpoints/${sessionId}/t2`);
    });
  });

  it('多轮次跨轮次回滚与无救援快照时的防御处理', async () => {
    await withGitSandbox(async ({ dir, manager }) => {
      const sessionId = 'session-multiturn';
      const fileA = path.join(dir, 'a.txt');
      const fileB = path.join(dir, 'b.txt');

      // Turn 1
      await fs.writeFile(fileA, 'turn 1 state\n');
      await manager.capturePreTurnCheckpoint({ cwd: dir, sessionId, turnId: 1 });

      // Turn 2
      await fs.writeFile(fileA, 'turn 2 state\n');
      await fs.writeFile(fileB, 'b created in turn 2\n');
      await manager.capturePreTurnCheckpoint({ cwd: dir, sessionId, turnId: 2 });

      // Turn 2 内继续修改
      await fs.writeFile(fileA, 'turn 2 mutated\n');

      // 跨轮次回滚至 Turn 1 (force=true)
      const rollbackT1 = await manager.rollback({
        cwd: dir,
        sessionId,
        currentTurn: 2,
        options: { targetTurnId: 1, force: true },
      });
      expect(rollbackT1.success).toBe(true);
      expect(rollbackT1.targetTurn).toBe(1);
      expect(await fs.readFile(fileA, 'utf-8')).toBe('turn 1 state\n');
      expect(await fileExists(fileB)).toBe(false);

      // 再次 redo 消费救援快照
      const redoRes = await manager.redo({ cwd: dir, sessionId });
      expect(redoRes.success).toBe(true);

      // 重复调用 redo 时由于已无 rescue 快照，应当优雅报错而非崩溃
      const secondRedo = await manager.redo({ cwd: dir, sessionId });
      expect(secondRedo.success).toBe(false);
      expect(secondRedo.error).toContain('No rescue checkpoint');
    });
  });
});
