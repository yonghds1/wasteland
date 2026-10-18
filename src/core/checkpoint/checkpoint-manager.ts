/**
 * checkpoint-manager.ts - Git 快照生命周期管理、回滚 (/undo) 与重做 (/redo) 门面服务
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  CheckpointDiffSummary,
  CheckpointMetadata,
  RollbackOptions,
  RollbackResult,
} from './checkpoint-types.js';
import { checkExternalConflict } from './safety-guard.js';
import { gitPlumbingDriver, GitPlumbingDriver } from './git-plumbing-driver.js';

interface PersistedSessionData {
  sessionId: string;
  checkpoints: CheckpointMetadata[];
  rescueCheckpoint?: CheckpointMetadata;
}

export class GitCheckpointManager {
  private driver: GitPlumbingDriver;
  private cache = new Map<string, PersistedSessionData>();

  constructor(driver: GitPlumbingDriver = gitPlumbingDriver) {
    this.driver = driver;
  }

  private getStoragePath(cwd: string, sessionId: string): string {
    return path.join(cwd, '.wasteland', 'checkpoints', `${sessionId}.json`);
  }

  private async loadSessionData(cwd: string, sessionId: string): Promise<PersistedSessionData> {
    const cached = this.cache.get(sessionId);
    if (cached) return cached;

    const filePath = this.getStoragePath(cwd, sessionId);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as PersistedSessionData;
      this.cache.set(sessionId, data);
      return data;
    } catch {
      const initData: PersistedSessionData = { sessionId, checkpoints: [] };
      this.cache.set(sessionId, initData);
      return initData;
    }
  }

  private async saveSessionData(cwd: string, data: PersistedSessionData): Promise<void> {
    this.cache.set(data.sessionId, data);
    const filePath = this.getStoragePath(cwd, data.sessionId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * 在每个交互轮次开始前截取快照（Pre-Turn Checkpoint）
   */
  async capturePreTurnCheckpoint(params: {
    cwd: string;
    sessionId: string;
    turnId: number;
    prompt?: string;
  }): Promise<CheckpointMetadata> {
    const { cwd, sessionId, turnId, prompt } = params;
    const sessionData = await this.loadSessionData(cwd, sessionId);

    const snapshot = await this.driver.createSnapshotTree(cwd, sessionId, turnId);
    const meta: CheckpointMetadata = {
      id: `chk-${sessionId}-t${turnId}`,
      turnId,
      sessionId,
      commitHash: snapshot.commitHash,
      treeHash: snapshot.treeHash,
      createdAt: new Date().toISOString(),
      promptSummary: prompt ? prompt.slice(0, 150) : undefined,
      affectedFiles: snapshot.affectedFiles,
    };

    sessionData.checkpoints = sessionData.checkpoints.filter((c) => c.turnId !== turnId);
    sessionData.checkpoints.push(meta);
    sessionData.checkpoints.sort((a, b) => a.turnId - b.turnId);

    await this.saveSessionData(cwd, sessionData);
    return meta;
  }

  /**
   * 回滚指定轮次或最新轮次变动，自动保存救援快照供 /redo 使用
   */
  async rollback(params: {
    cwd: string;
    sessionId: string;
    currentTurn: number;
    options?: RollbackOptions;
  }): Promise<RollbackResult> {
    const { cwd, sessionId, currentTurn, options } = params;
    const sessionData = await this.loadSessionData(cwd, sessionId);

    let targetTurn: number;
    if (options?.targetTurnId !== undefined) {
      targetTurn = options.targetTurnId;
    } else if (options?.checkpointId) {
      const found = sessionData.checkpoints.find((c) => c.id === options.checkpointId);
      targetTurn = found ? found.turnId : currentTurn;
    } else {
      // 默认回退当前轮次开始前的基线快照
      const hasCurrent = sessionData.checkpoints.some((c) => c.turnId === currentTurn);
      targetTurn = hasCurrent ? currentTurn : currentTurn - 1;
    }

    const targetChk = sessionData.checkpoints.find((c) => c.turnId === targetTurn);
    if (!targetChk) {
      return {
        success: false,
        rolledBackTurn: currentTurn,
        targetTurn,
        restoredFiles: [],
        error: `Checkpoint for target turn ${targetTurn} not found`,
      };
    }

    // 1. 创建当前状态的救援快照（供 /redo 使用）
    const rescueSnap = await this.driver.createSnapshotTree(cwd, sessionId, 999999);
    const rescueChk: CheckpointMetadata = {
      id: `rescue-${sessionId}-${Date.now()}`,
      turnId: currentTurn,
      sessionId,
      commitHash: rescueSnap.commitHash,
      treeHash: rescueSnap.treeHash,
      createdAt: new Date().toISOString(),
      affectedFiles: rescueSnap.affectedFiles,
      isRescue: true,
    };
    sessionData.rescueCheckpoint = rescueChk;

    // 2. 外部并发修改检测（3-Way Hash 检查）
    if (!options?.force) {
      const currentChk = sessionData.checkpoints.find((c) => c.turnId === currentTurn);
      const agentTreeHash = currentChk && currentChk.turnId !== targetChk.turnId
        ? currentChk.treeHash
        : undefined;
      const filesToCheck = options?.files ?? (
        rescueSnap.affectedFiles.length > 0 ? rescueSnap.affectedFiles : targetChk.affectedFiles
      );
      const conflicts = await checkExternalConflict(
        cwd,
        targetChk.treeHash,
        filesToCheck,
        agentTreeHash,
      );
      if (conflicts.length > 0) {
        await this.saveSessionData(cwd, sessionData);
        return {
          success: false,
          rolledBackTurn: currentTurn,
          targetTurn: targetChk.turnId,
          restoredFiles: [],
          conflicts,
          rescueCheckpointId: rescueChk.id,
          error: 'External modifications detected on disk (3-way conflict)',
        };
      }
    }

    // 3. 执行快照还原
    const restoredFiles = await this.driver.restoreSnapshot(
      cwd,
      targetChk.commitHash,
      options?.files,
      rescueSnap.commitHash,
    );

    await this.saveSessionData(cwd, sessionData);

    return {
      success: true,
      rolledBackTurn: currentTurn,
      targetTurn: targetChk.turnId,
      restoredFiles,
      rescueCheckpointId: rescueChk.id,
      originalPrompt: targetChk.promptSummary,
    };
  }

  /**
   * 重做上次撤销操作 (/redo)
   */
  async redo(params: { cwd: string; sessionId: string }): Promise<RollbackResult> {
    const { cwd, sessionId } = params;
    const sessionData = await this.loadSessionData(cwd, sessionId);
    const rescue = sessionData.rescueCheckpoint;
    if (!rescue) {
      return {
        success: false,
        rolledBackTurn: 0,
        targetTurn: 0,
        restoredFiles: [],
        error: 'No rescue checkpoint available to redo',
      };
    }

    const restoredFiles = await this.driver.restoreSnapshot(cwd, rescue.commitHash);
    sessionData.rescueCheckpoint = undefined;
    await this.saveSessionData(cwd, sessionData);

    return {
      success: true,
      rolledBackTurn: 0,
      targetTurn: rescue.turnId,
      restoredFiles,
      originalPrompt: rescue.promptSummary,
    };
  }

  /**
   * 获取指定轮次快照或当前工作区之间的变更差异
   */
  async getDiff(params: {
    cwd: string;
    sessionId: string;
    turnId?: number;
  }): Promise<CheckpointDiffSummary> {
    const { cwd, sessionId, turnId } = params;
    const sessionData = await this.loadSessionData(cwd, sessionId);
    const targetChk = turnId !== undefined
      ? sessionData.checkpoints.find((c) => c.turnId === turnId)
      : sessionData.checkpoints[sessionData.checkpoints.length - 1];

    if (!targetChk) {
      return { filesChanged: 0, additions: 0, deletions: 0, rawDiff: '' };
    }

    const rawDiff = await this.driver.getDiff(cwd, targetChk.commitHash);
    let filesChanged = 0;
    let additions = 0;
    let deletions = 0;

    const lines = rawDiff.split('\n');
    for (const line of lines) {
      if (line.startsWith('diff --git ')) {
        filesChanged++;
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
      }
    }

    return { filesChanged, additions, deletions, rawDiff };
  }

  /**
   * 获取指定会话的所有快照记录列表（排除救援快照）
   */
  list(sessionId: string): CheckpointMetadata[] {
    const sessionData = this.cache.get(sessionId);
    if (!sessionData) return [];
    return sessionData.checkpoints.filter((c) => !c.isRescue);
  }
}

let instance: GitCheckpointManager | null = null;

export function getCheckpointManager(): GitCheckpointManager {
  if (!instance) {
    instance = new GitCheckpointManager();
  }
  return instance;
}

export function resetCheckpointManager(): void {
  instance = null;
}
