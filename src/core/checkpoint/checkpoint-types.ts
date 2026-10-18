/**
 * checkpoint-types.ts - Git Checkpoint 与 /undo 底层契约及元数据类型定义
 */

export interface CheckpointMetadata {
  /** 快照唯一标识，例如 chk-<sessionId>-t<turnId> */
  id: string;
  /** 快照对应的轮次编号 */
  turnId: number;
  /** 所属会话 ID */
  sessionId: string;
  /** Git Commit SHA-1 */
  commitHash: string;
  /** Git Tree SHA-1 */
  treeHash: string;
  /** 快照生成时间（ISO 8601） */
  createdAt: string;
  /** 关联轮次的 Prompt 摘要 */
  promptSummary?: string;
  /** 快照关联或变动的文件列表 */
  affectedFiles: string[];
  /** 是否为安全救援快照（用于 redo） */
  isRescue?: boolean;
}

export interface RollbackOptions {
  /** 目标回滚轮次编号 */
  targetTurnId?: number;
  /** 目标快照 ID */
  checkpointId?: string;
  /** 仅回滚指定文件（未提供则全量回滚） */
  files?: string[];
  /** 强制回滚，忽略并发冲突检测 */
  force?: boolean;
}

export interface ConflictDetail {
  /** 发生外部冲突的文件相对路径 */
  path: string;
  /** 冲突原因说明 */
  reason: string;
}

export interface RollbackResult {
  /** 回滚是否成功 */
  success: boolean;
  /** 被回滚的轮次编号 */
  rolledBackTurn: number;
  /** 回滚到达的目标轮次编号 */
  targetTurn: number;
  /** 实际恢复的文件相对路径列表 */
  restoredFiles: string[];
  /** 外部并发冲突列表（若被阻断） */
  conflicts?: ConflictDetail[];
  /** 自动创建的救援快照 ID（供 /redo 恢复） */
  rescueCheckpointId?: string;
  /** 目标轮次的原始用户 Prompt（供 TUI 回填） */
  originalPrompt?: string;
  /** 失败原因说明 */
  error?: string;
}

export interface CheckpointDiffSummary {
  /** 发生变更的文件总数 */
  filesChanged: number;
  /** 新增行数统计 */
  additions: number;
  /** 删除行数统计 */
  deletions: number;
  /** 原始 Unified Diff 文本 */
  rawDiff: string;
}
