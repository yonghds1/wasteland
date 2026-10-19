
/**
 * git-checkpoint.test.ts - Git Checkpoint 与 /undo 底层机制单元测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  isIgnoredOrSensitive,
  computeGitBlobHash,
  checkExternalConflict,
} from '../safety-guard.js';
import { GitPlumbingDriver } from '../git-plumbing-driver.js';
import { GitCheckpointManager } from '../checkpoint-manager.js';

const pExecFile = promisify(execFile);

describe('Git Checkpoint & Undo Infrastructure', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wasteland-chk-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // 忽略清理异常
    }
  });

  describe('safety-guard', () => {
    it('正确识别忽略目录与敏感文件', () => {
      expect(isIgnoredOrSensitive('.git/HEAD')).toBe(true);
      expect(isIgnoredOrSensitive('.wasteland/tmp/idx_123')).toBe(true);
      expect(isIgnoredOrSensitive('node_modules/package/index.js')).toBe(true);
      expect(isIgnoredOrSensitive('dist/bundle.js')).toBe(true);
      expect(isIgnoredOrSensitive('.venv/bin/python')).toBe(true);
      expect(isIgnoredOrSensitive('target/debug/app')).toBe(true);

      expect(isIgnoredOrSensitive('.env')).toBe(true);
      expect(isIgnoredOrSensitive('.env.local')).toBe(true);
      expect(isIgnoredOrSensitive('.env.production')).toBe(true);
      expect(isIgnoredOrSensitive('certs/server.pem')).toBe(true);
      expect(isIgnoredOrSensitive('keys/id_rsa')).toBe(true);
      expect(isIgnoredOrSensitive('keys/id_rsa.pub')).toBe(true);
      expect(isIgnoredOrSensitive('secret.key')).toBe(true);

      expect(isIgnoredOrSensitive('src/index.ts')).toBe(false);
      expect(isIgnoredOrSensitive('package.json')).toBe(false);
      expect(isIgnoredOrSensitive('README.md')).toBe(false);
    });

    it('计算与 Git 一致的标准 Blob SHA-1 Hash', async () => {
      const content = Buffer.from('hello wasteland checkpoint\n', 'utf-8');
      const hash = computeGitBlobHash(content);

      const filePath = path.join(tempDir, 'hash-test.txt');
      await fs.writeFile(filePath, content);
      const { stdout } = await pExecFile('git', ['hash-object', filePath]);
      expect(hash).toBe(stdout.trim());
    });
  });

  describe('git-plumbing-driver', () => {
    it('在正常 Git 仓库中创建快照且不污染 git log 与 git branch', async () => {
      await pExecFile('git', ['init'], { cwd: tempDir });
      await pExecFile('git', ['config', 'user.name', 'Tester'], { cwd: tempDir });
      await pExecFile('git', ['config', 'user.email', 'tester@test.local'], { cwd: tempDir });
      await fs.writeFile(path.join(tempDir, 'base.txt'), 'initial content\n');
      await pExecFile('git', ['add', '.'], { cwd: tempDir });
      await pExecFile('git', ['commit', '-m', 'initial commit'], { cwd: tempDir });

      const driver = new GitPlumbingDriver();
      await fs.writeFile(path.join(tempDir, 'app.ts'), 'console.log("turn 1");\n');

      const snap1 = await driver.createSnapshotTree(tempDir, 's1', 1);
      expect(snap1.commitHash).toMatch(/^[0-9a-f]{40}$/);
      expect(snap1.treeHash).toMatch(/^[0-9a-f]{40}$/);
      expect(snap1.affectedFiles).toContain('app.ts');

      // 验证 git log 只有初始提交，没有快照 commit
      const { stdout: logOut } = await pExecFile('git', ['log', '--oneline'], { cwd: tempDir });
      expect(logOut.trim()).toContain('initial commit');
      expect(logOut).not.toContain('wasteland checkpoint');

      // 验证 git branch -a 只有 master / main，没有 wasteland ref
      const { stdout: branchOut } = await pExecFile('git', ['branch', '-a'], { cwd: tempDir });
      expect(branchOut).not.toContain('wasteland');

      // 验证临时索引已被清理
      const tmpDir = path.join(tempDir, '.wasteland', 'tmp');
      const tmpFiles = await fs.readdir(tmpDir).catch(() => []);
      expect(tmpFiles.length).toBe(0);
    });

    it('在非 Git 目录中透明初始化裸仓库支持快照与恢复', async () => {
      const gitDirExists = await fs.access(path.join(tempDir, '.git')).then(() => true).catch(() => false);
      expect(gitDirExists).toBe(false);

      const driver = new GitPlumbingDriver();
      await fs.writeFile(path.join(tempDir, 'file.txt'), 'v1 in bare repo\n');

      const snap = await driver.createSnapshotTree(tempDir, 'bare-s1', 1);
      expect(snap.commitHash).toBeTruthy();

      const rootGit = await fs.access(path.join(tempDir, '.git')).then(() => true).catch(() => false);
      expect(rootGit).toBe(false);

      const bareGit = await fs.access(path.join(tempDir, '.wasteland', 'checkpoints.git')).then(() => true).catch(() => false);
      expect(bareGit).toBe(true);

      await fs.writeFile(path.join(tempDir, 'file.txt'), 'modified v2\n');
      await driver.restoreSnapshot(tempDir, snap.commitHash);

      const restored = await fs.readFile(path.join(tempDir, 'file.txt'), 'utf-8');
      expect(restored).toBe('v1 in bare repo\n');
    });

    it('支持传递 Windows 反斜杠路径到 restoreSnapshot 与 getDiff', async () => {
      const driver = new GitPlumbingDriver();
      await fs.mkdir(path.join(tempDir, 'sub'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'sub', 'file.txt'), 'v1\n');

      const snap = await driver.createSnapshotTree(tempDir, 'win-test', 1);
      await fs.writeFile(path.join(tempDir, 'sub', 'file.txt'), 'v2\n');

      // 使用 Windows 反斜杠路径获取 diff
      const diff = await driver.getDiff(tempDir, snap.commitHash, ['sub\\file.txt']);
      expect(diff).toContain('-v1');
      expect(diff).toContain('+v2');

      // 使用 Windows 反斜杠路径恢复单文件
      const restored = await driver.restoreSnapshot(tempDir, snap.commitHash, ['sub\\file.txt']);
      expect(restored).toEqual(['sub/file.txt']);

      const content = await fs.readFile(path.join(tempDir, 'sub', 'file.txt'), 'utf-8');
      expect(content).toBe('v1\n');
    });
  });

  describe('GitCheckpointManager', () => {
    it('完整支持多轮次快照、回滚 (/undo) 与重做 (/redo)', async () => {
      await pExecFile('git', ['init'], { cwd: tempDir });
      await pExecFile('git', ['config', 'user.name', 'Tester'], { cwd: tempDir });
      await pExecFile('git', ['config', 'user.email', 'tester@test.local'], { cwd: tempDir });
      await fs.writeFile(path.join(tempDir, 'app.ts'), 'turn 1 code\n');
      await pExecFile('git', ['add', '.'], { cwd: tempDir });
      await pExecFile('git', ['commit', '-m', 'init'], { cwd: tempDir });

      const manager = new GitCheckpointManager();
      const sessionId = 'session-test-01';

      // Turn 1 开始前的快照
      const chk1 = await manager.capturePreTurnCheckpoint({
        cwd: tempDir,
        sessionId,
        turnId: 1,
        prompt: 'First user prompt',
      });
      expect(chk1.turnId).toBe(1);

      // AI 在 Turn 1 修改 app.ts 并新增 feature.ts
      await fs.writeFile(path.join(tempDir, 'app.ts'), 'turn 1 code + turn 2 edit\n');
      await fs.writeFile(path.join(tempDir, 'feature.ts'), 'new feature code\n');

      // Turn 2 开始前的快照
      const chk2 = await manager.capturePreTurnCheckpoint({
        cwd: tempDir,
        sessionId,
        turnId: 2,
        prompt: 'Second user prompt',
      });
      expect(chk2.turnId).toBe(2);

      // AI 在 Turn 2 修改 app.ts 并添加 third.ts
      await fs.writeFile(path.join(tempDir, 'app.ts'), 'turn 3 broken code\n');
      await fs.writeFile(path.join(tempDir, 'third.ts'), 'third file\n');

      // 用户执行 /undo 回滚最近一轮（Turn 2）变动
      const undoResult = await manager.rollback({
        cwd: tempDir,
        sessionId,
        currentTurn: 2,
      });

      expect(undoResult.success).toBe(true);
      expect(undoResult.rolledBackTurn).toBe(2);
      expect(undoResult.targetTurn).toBe(2);

      // 验证文件 100% 还原至 Turn 2 开始前（Turn 1 结束时）的状态
      const appContent2 = await fs.readFile(path.join(tempDir, 'app.ts'), 'utf-8');
      expect(appContent2).toBe('turn 1 code + turn 2 edit\n');

      const featureExists2 = await fs.access(path.join(tempDir, 'feature.ts')).then(() => true).catch(() => false);
      expect(featureExists2).toBe(true);

      const thirdExists2 = await fs.access(path.join(tempDir, 'third.ts')).then(() => true).catch(() => false);
      expect(thirdExists2).toBe(false);

      // 用户执行 /redo 重做
      const redoResult = await manager.redo({
        cwd: tempDir,
        sessionId,
      });

      expect(redoResult.success).toBe(true);
      const appContentRedo = await fs.readFile(path.join(tempDir, 'app.ts'), 'utf-8');
      expect(appContentRedo).toBe('turn 3 broken code\n');

      const thirdExistsRedo = await fs.access(path.join(tempDir, 'third.ts')).then(() => true).catch(() => false);
      expect(thirdExistsRedo).toBe(true);

      // 用户跨轮次回退到 Turn 1
      const undoTurn1Result = await manager.rollback({
        cwd: tempDir,
        sessionId,
        currentTurn: 2,
        options: { targetTurnId: 1, force: true },
      });
      expect(undoTurn1Result.success).toBe(true);
      expect(undoTurn1Result.targetTurn).toBe(1);

      const appContent1 = await fs.readFile(path.join(tempDir, 'app.ts'), 'utf-8');
      expect(appContent1).toBe('turn 1 code\n');

      const featureExists1 = await fs.access(path.join(tempDir, 'feature.ts')).then(() => true).catch(() => false);
      expect(featureExists1).toBe(false);
    });

    it('敏感文件（如 .env）不被快照污染，回退时不被覆盖丢失', async () => {
      await pExecFile('git', ['init'], { cwd: tempDir });
      await pExecFile('git', ['config', 'user.name', 'Tester'], { cwd: tempDir });
      await pExecFile('git', ['config', 'user.email', 'tester@test.local'], { cwd: tempDir });
      await fs.writeFile(path.join(tempDir, 'index.ts'), 'console.log("init");\n');
      await fs.writeFile(path.join(tempDir, '.env'), 'OPENAI_API_KEY=sk-test-secret\n');

      const manager = new GitCheckpointManager();
      const sessionId = 'session-env-test';

      const chk = await manager.capturePreTurnCheckpoint({
        cwd: tempDir,
        sessionId,
        turnId: 1,
      });

      expect(chk.affectedFiles).not.toContain('.env');

      await fs.writeFile(path.join(tempDir, 'index.ts'), 'console.log("modified");\n');
      await fs.writeFile(path.join(tempDir, 'new.ts'), 'console.log("new");\n');
      await fs.writeFile(path.join(tempDir, '.env'), 'OPENAI_API_KEY=sk-user-updated\n');

      await manager.rollback({
        cwd: tempDir,
        sessionId,
        currentTurn: 1,
        options: { targetTurnId: 1, force: true },
      });

      const envContent = await fs.readFile(path.join(tempDir, '.env'), 'utf-8');
      expect(envContent).toBe('OPENAI_API_KEY=sk-user-updated\n');

      const newExists = await fs.access(path.join(tempDir, 'new.ts')).then(() => true).catch(() => false);
      expect(newExists).toBe(false);
    });

    it('检测 3-Way 外部修改并发冲突并安全阻断', async () => {
      await pExecFile('git', ['init'], { cwd: tempDir });
      await pExecFile('git', ['config', 'user.name', 'Tester'], { cwd: tempDir });
      await pExecFile('git', ['config', 'user.email', 'tester@test.local'], { cwd: tempDir });
      await fs.writeFile(path.join(tempDir, 'main.ts'), 'v1\n');

      const manager = new GitCheckpointManager();
      const sessionId = 'session-conflict-test';

      const chk1 = await manager.capturePreTurnCheckpoint({
        cwd: tempDir,
        sessionId,
        turnId: 1,
      });

      await fs.writeFile(path.join(tempDir, 'main.ts'), 'v2-by-ai\n');
      const chk2 = await manager.capturePreTurnCheckpoint({
        cwd: tempDir,
        sessionId,
        turnId: 2,
      });

      // 用户在外部手写修改了 main.ts（既不是 v1 也不是 v2-by-ai）
      await fs.writeFile(path.join(tempDir, 'main.ts'), 'v3-manual-user-edit\n');

      const conflicts = await checkExternalConflict(
        tempDir,
        chk1.treeHash,
        ['main.ts'],
        chk2.treeHash,
      );

      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0]!.path).toBe('main.ts');

      // 执行回滚，未传 force 时应被安全阻断
      const result = await manager.rollback({
        cwd: tempDir,
        sessionId,
        currentTurn: 2,
        options: { targetTurnId: 1 },
      });

      expect(result.success).toBe(false);
      expect(result.conflicts).toBeDefined();
      expect(result.conflicts!.length).toBeGreaterThan(0);
      const currentContent = await fs.readFile(path.join(tempDir, 'main.ts'), 'utf-8');
      expect(currentContent).toBe('v3-manual-user-edit\n');
    });

    it('正确生成 CheckpointDiffSummary', async () => {
      await pExecFile('git', ['init'], { cwd: tempDir });
      await pExecFile('git', ['config', 'user.name', 'Tester'], { cwd: tempDir });
      await pExecFile('git', ['config', 'user.email', 'tester@test.local'], { cwd: tempDir });
      await fs.writeFile(path.join(tempDir, 'doc.txt'), 'line 1\nline 2\n');

      const manager = new GitCheckpointManager();
      const sessionId = 'diff-test';
      await manager.capturePreTurnCheckpoint({
        cwd: tempDir,
        sessionId,
        turnId: 1,
      });

      await fs.writeFile(path.join(tempDir, 'doc.txt'), 'line 1\nline 2 modified\nline 3\n');
      const summary = await manager.getDiff({
        cwd: tempDir,
        sessionId,
        turnId: 1,
      });

      expect(summary.filesChanged).toBe(1);
      expect(summary.additions).toBeGreaterThan(0);
      expect(summary.rawDiff).toContain('diff --git');
    });
  });
});
