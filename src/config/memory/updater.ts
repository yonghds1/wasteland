/**
 * updater.ts - Memory 更新器
 *
 * 将提取的信息合并到 memory.md，支持去重、冲突解决和增量更新。
 *
 * ## 设计原则
 *
 * - 去重：相同类型、相同内容的信息不重复存储
 * - 冲突解决：新旧信息冲突时的处理策略
 * - 增量更新：只更新变更的部分
 * - 可追溯：记录更新历史
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { MemoryExtract, ExtractType } from './extractor.js';

// ============================================================
// 类型定义
// ============================================================

/**
 * Memory 更新配置
 */
export interface MemoryUpdaterConfig {
  /** 用户级 memory 目录 */
  userMemoryDir: string;
  /** 项目级 memory 目录 */
  projectMemoryDir?: string;
  /** 是否启用去重 */
  enableDeduplication: boolean;
  /** 相似度阈值 */
  similarityThreshold: number;
  /** 是否保留更新历史 */
  keepUpdateHistory: boolean;
}

/**
 * Memory 条目
 */
export interface MemoryEntry {
  /** 提取类型 */
  type: ExtractType;
  /** 内容 */
  content: string;
  /** 置信度 */
  confidence: number;
  /** 添加时间 */
  addedAt: string;
  /** 来源轮次 */
  sourceTurn?: number;
  /** 上下文 */
  context?: string;
}

/**
 * Memory 数据
 */
export interface MemoryData {
  /** 用户偏好 */
  user_preferences: MemoryEntry[];
  /** 项目知识 */
  project_knowledge: MemoryEntry[];
  /** 决策记录 */
  decisions: MemoryEntry[];
  /** 代码规范 */
  code_conventions: MemoryEntry[];
  /** 错误模式 */
  error_patterns: MemoryEntry[];
}

/**
 * 更新结果
 */
export interface UpdateResult {
  /** 是否成功 */
  success: boolean;
  /** 添加的条目数 */
  addedCount: number;
  /** 更新的条目数 */
  updatedCount: number;
  /** 跳过的条目数 */
  skippedCount: number;
  /** 冲突解决数 */
  conflictResolvedCount: number;
  /** 错误信息 */
  error?: string;
  /** 更新耗时（毫秒） */
  duration?: number;
}

/**
 * 更新历史记录
 */
export interface UpdateHistoryRecord {
  /** 更新时间 */
  timestamp: string;
  /** 提取的信息 */
  extracts: MemoryExtract[];
  /** 更新结果 */
  result: UpdateResult;
}

// ============================================================
// 默认配置
// ============================================================

const DEFAULT_CONFIG: MemoryUpdaterConfig = {
  userMemoryDir: join(homedir(), '.wasteland', 'memory'),
  enableDeduplication: true,
  similarityThreshold: 0.8,
  keepUpdateHistory: true,
};

// ============================================================
// MemoryUpdater 类
// ============================================================

/**
 * Memory 更新器
 *
 * 将提取的信息合并到 memory.md。
 *
 * @example
 * const updater = new MemoryUpdater();
 *
 * // 更新 memory
 * const result = await updater.mergeMemory(extracts);
 *
 * console.log(`Added ${result.addedCount} items`);
 */
export class MemoryUpdater {
  private config: MemoryUpdaterConfig;
  private memoryData: MemoryData | null = null;

  constructor(config?: Partial<MemoryUpdaterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 合并提取的信息到 memory
   *
   * @param extracts - 提取的信息
   * @param sessionId - 会话 ID（可选）
   * @param turn - 当前轮次（可选）
   * @returns 更新结果
   */
  async mergeMemory(
    extracts: MemoryExtract[],
    sessionId?: string,
    turn?: number
  ): Promise<UpdateResult> {
    const startTime = Date.now();

    try {
      // 加载现有 memory
      const existingMemory = await this.loadMemory();

      // 初始化统计
      let addedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      let conflictResolvedCount = 0;

      // 处理每条提取信息
      for (const extract of extracts) {
        const result = await this.processExtract(
          extract,
          existingMemory,
          sessionId,
          turn
        );

        switch (result.action) {
          case 'added':
            addedCount++;
            break;
          case 'updated':
            updatedCount++;
            break;
          case 'skipped':
            skippedCount++;
            break;
          case 'conflict_resolved':
            conflictResolvedCount++;
            break;
        }
      }

      // 保存更新后的 memory
      await this.saveMemory(existingMemory);

      // 保存更新历史
      if (this.config.keepUpdateHistory) {
        await this.saveUpdateHistory(extracts, {
          success: true,
          addedCount,
          updatedCount,
          skippedCount,
          conflictResolvedCount,
          duration: Date.now() - startTime,
        });
      }

      return {
        success: true,
        addedCount,
        updatedCount,
        skippedCount,
        conflictResolvedCount,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Failed to merge memory:', errorMessage);

      return {
        success: false,
        addedCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        conflictResolvedCount: 0,
        error: errorMessage,
      };
    }
  }

  /**
   * 处理单条提取信息
   *
   * @param extract - 提取信息
   * @param memory - 现有 memory 数据
   * @param sessionId - 会话 ID
   * @param turn - 当前轮次
   * @returns 处理结果
   */
  private async processExtract(
    extract: MemoryExtract,
    memory: MemoryData,
    sessionId?: string,
    turn?: number
  ): Promise<{ action: 'added' | 'updated' | 'skipped' | 'conflict_resolved' }> {
    // 获取对应的条目列表
    const entries = this.getEntriesByType(memory, extract.type);

    // 检查是否重复
    if (this.config.enableDeduplication) {
      const duplicate = this.findDuplicate(entries, extract);
      if (duplicate) {
        // 检查是否需要更新置信度
        if (extract.confidence > duplicate.confidence) {
          duplicate.confidence = extract.confidence;
          return { action: 'updated' };
        }
        return { action: 'skipped' };
      }
    }

    // 检查冲突
    const conflict = this.findConflict(entries, extract);
    if (conflict) {
      const resolved = this.resolveConflict(conflict, extract);
      if (resolved) {
        return { action: 'conflict_resolved' };
      }
    }

    // 添加新条目
    const newEntry: MemoryEntry = {
      type: extract.type,
      content: extract.content,
      confidence: extract.confidence,
      addedAt: new Date().toISOString(),
      sourceTurn: turn,
      context: extract.context,
    };

    entries.push(newEntry);
    return { action: 'added' };
  }

  /**
   * 获取指定类型的条目列表
   *
   * @param memory - memory 数据
   * @param type - 提取类型
   * @returns 条目列表
   */
  private getEntriesByType(memory: MemoryData, type: ExtractType): MemoryEntry[] {
    switch (type) {
      case 'user_preference':
        return memory.user_preferences;
      case 'project_knowledge':
        return memory.project_knowledge;
      case 'decision':
        return memory.decisions;
      case 'code_convention':
        return memory.code_conventions;
      case 'error_pattern':
        return memory.error_patterns;
      default:
        return [];
    }
  }

  /**
   * 查找重复条目
   *
   * @param entries - 现有条目列表
   * @param extract - 新提取信息
   * @returns 重复的条目，如果没有则返回 null
   */
  private findDuplicate(entries: MemoryEntry[], extract: MemoryExtract): MemoryEntry | null {
    for (const entry of entries) {
      const similarity = this.calculateSimilarity(entry.content, extract.content);
      if (similarity >= this.config.similarityThreshold) {
        return entry;
      }
    }
    return null;
  }

  /**
   * 查找冲突条目
   *
   * @param entries - 现有条目列表
   * @param extract - 新提取信息
   * @returns 冲突的条目，如果没有则返回 null
   */
  private findConflict(entries: MemoryEntry[], extract: MemoryExtract): MemoryEntry | null {
    // 只有用户偏好和代码规范可能有冲突
    if (extract.type !== 'user_preference' && extract.type !== 'code_convention') {
      return null;
    }

    // 查找相似但不完全相同的条目
    for (const entry of entries) {
      const similarity = this.calculateSimilarity(entry.content, extract.content);
      if (similarity >= 0.5 && similarity < this.config.similarityThreshold) {
        return entry;
      }
    }

    return null;
  }

  /**
   * 解决冲突
   *
   * @param existing - 现有条目
   * @param newExtract - 新提取信息
   * @returns 是否成功解决
   */
  private resolveConflict(existing: MemoryEntry, newExtract: MemoryExtract): boolean {
    // 用户偏好：新信息覆盖旧信息
    if (newExtract.type === 'user_preference') {
      existing.content = newExtract.content;
      existing.confidence = newExtract.confidence;
      existing.addedAt = new Date().toISOString();
      return true;
    }

    // 代码规范：新信息覆盖旧规范
    if (newExtract.type === 'code_convention') {
      existing.content = newExtract.content;
      existing.confidence = newExtract.confidence;
      existing.addedAt = new Date().toISOString();
      return true;
    }

    return false;
  }

  /**
   * 计算文本相似度
   *
   * @param text1 - 文本 1
   * @param text2 - 文本 2
   * @returns 相似度 (0-1)
   */
  private calculateSimilarity(text1: string, text2: string): number {
    // 简单的相似度计算：基于共同词汇
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set([...words1].filter((w) => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    if (union.size === 0) {
      return 0;
    }

    return intersection.size / union.size;
  }

  /**
   * 加载现有 memory
   *
   * @returns memory 数据
   */
  private async loadMemory(): Promise<MemoryData> {
    if (this.memoryData) {
      return this.memoryData;
    }

    const memoryPath = join(this.config.userMemoryDir, 'memory.json');

    try {
      const content = await readFile(memoryPath, 'utf-8');
      const parsed = JSON.parse(content);
      this.memoryData = parsed;
      return parsed;
    } catch {
      // 文件不存在，返回默认结构
      this.memoryData = {
        user_preferences: [],
        project_knowledge: [],
        decisions: [],
        code_conventions: [],
        error_patterns: [],
      };
      return this.memoryData;
    }
  }

  /**
   * 保存 memory 数据
   *
   * @param memory - memory 数据
   */
  private async saveMemory(memory: MemoryData): Promise<void> {
    const memoryDir = this.config.userMemoryDir;
    await mkdir(memoryDir, { recursive: true });

    const memoryPath = join(memoryDir, 'memory.json');
    await writeFile(memoryPath, JSON.stringify(memory, null, 2));

    // 同时生成 markdown 格式
    const markdownPath = join(memoryDir, 'memory.md');
    const markdown = this.generateMarkdown(memory);
    await writeFile(markdownPath, markdown);
  }

  /**
   * 生成 markdown 格式的 memory
   *
   * @param memory - memory 数据
   * @returns markdown 内容
   */
  private generateMarkdown(memory: MemoryData): string {
    const lines: string[] = ['# 项目记忆\n'];

    // 用户偏好
    if (memory.user_preferences.length > 0) {
      lines.push('## 用户偏好\n');
      for (const entry of memory.user_preferences) {
        lines.push(`- ${entry.content}`);
      }
      lines.push('');
    }

    // 项目知识
    if (memory.project_knowledge.length > 0) {
      lines.push('## 项目知识\n');
      for (const entry of memory.project_knowledge) {
        lines.push(`- ${entry.content}`);
      }
      lines.push('');
    }

    // 决策记录
    if (memory.decisions.length > 0) {
      lines.push('## 决策记录\n');
      for (const entry of memory.decisions) {
        const date = entry.addedAt.split('T')[0];
        lines.push(`- [${date}] ${entry.content}`);
      }
      lines.push('');
    }

    // 代码规范
    if (memory.code_conventions.length > 0) {
      lines.push('## 代码规范\n');
      for (const entry of memory.code_conventions) {
        lines.push(`- ${entry.content}`);
      }
      lines.push('');
    }

    // 错误模式
    if (memory.error_patterns.length > 0) {
      lines.push('## 错误模式\n');
      for (const entry of memory.error_patterns) {
        lines.push(`- ${entry.content}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 保存更新历史
   *
   * @param extracts - 提取的信息
   * @param result - 更新结果
   */
  private async saveUpdateHistory(
    extracts: MemoryExtract[],
    result: UpdateResult
  ): Promise<void> {
    const historyDir = this.config.userMemoryDir;
    await mkdir(historyDir, { recursive: true });

    const historyPath = join(historyDir, 'update-history.json');

    try {
      // 读取现有历史
      let history: UpdateHistoryRecord[] = [];
      try {
        const content = await readFile(historyPath, 'utf-8');
        history = JSON.parse(content);
      } catch {
        // 文件不存在
      }

      // 添加新记录
      history.push({
        timestamp: new Date().toISOString(),
        extracts,
        result,
      });

      // 只保留最近 100 条记录
      if (history.length > 100) {
        history = history.slice(-100);
      }

      // 保存
      await writeFile(historyPath, JSON.stringify(history, null, 2));
    } catch (error) {
      console.error('Failed to save update history:', error);
    }
  }

  /**
   * 获取 memory 统计信息
   *
   * @returns 统计信息
   */
  async getStats(): Promise<{
    totalEntries: number;
    byType: Record<ExtractType, number>;
    lastUpdated?: string;
  }> {
    const memory = await this.loadMemory();

    return {
      totalEntries:
        memory.user_preferences.length +
        memory.project_knowledge.length +
        memory.decisions.length +
        memory.code_conventions.length +
        memory.error_patterns.length,
      byType: {
        user_preference: memory.user_preferences.length,
        project_knowledge: memory.project_knowledge.length,
        decision: memory.decisions.length,
        code_convention: memory.code_conventions.length,
        error_pattern: memory.error_patterns.length,
      },
      lastUpdated: memory.user_preferences[0]?.addedAt,
    };
  }

  /**
   * 清理过期的 memory 条目
   *
   * @param maxAge - 最大年龄（毫秒）
   * @returns 清理的条目数
   */
  async cleanupExpiredEntries(maxAge: number): Promise<number> {
    const memory = await this.loadMemory();
    const now = Date.now();
    let cleanedCount = 0;

    // 清理过期的决策记录
    memory.decisions = memory.decisions.filter((entry) => {
      const addedAt = new Date(entry.addedAt).getTime();
      if (now - addedAt > maxAge) {
        cleanedCount++;
        return false;
      }
      return true;
    });

    // 清理过期的错误模式
    memory.error_patterns = memory.error_patterns.filter((entry) => {
      const addedAt = new Date(entry.addedAt).getTime();
      if (now - addedAt > maxAge) {
        cleanedCount++;
        return false;
      }
      return true;
    });

    // 保存更新后的 memory
    await this.saveMemory(memory);

    return cleanedCount;
  }

  /**
   * 重置 memory 数据
   */
  async resetMemory(): Promise<void> {
    this.memoryData = {
      user_preferences: [],
      project_knowledge: [],
      decisions: [],
      code_conventions: [],
      error_patterns: [],
    };

    await this.saveMemory(this.memoryData);
  }
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 创建 Memory 更新器
 *
 * @param config - 更新配置
 * @returns MemoryUpdater 实例
 */
export function createMemoryUpdater(
  config?: Partial<MemoryUpdaterConfig>
): MemoryUpdater {
  return new MemoryUpdater(config);
}
