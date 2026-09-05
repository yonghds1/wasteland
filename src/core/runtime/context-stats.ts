/**
 * context-stats.ts - Context 统计收集器
 *
 * 收集和计算 context 使用统计，支持实时监控和历史分析。
 *
 * ## 设计原则
 *
 * - 实时收集：每轮对话后更新统计
 * - 历史记录：保存完整的使用历史
 * - 性能优化：增量更新，减少 I/O
 * - 可扩展：支持自定义统计指标
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ============================================================
// 类型定义
// ============================================================

/**
 * 使用历史条目
 */
export interface UsageHistoryEntry {
  /** 轮次 */
  turn: number;

  /** 时间戳 */
  timestamp: string;

  /** Prompt tokens */
  promptTokens: number;

  /** Completion tokens */
  completionTokens: number;

  /** Total tokens */
  totalTokens: number;

  /** 缓存命中的 tokens（可选） */
  cachedTokens?: number;

  /** 使用率 */
  usageRatio: number;
}

/**
 * 压缩历史条目
 */
export interface CompactionHistoryEntry {
  /** 时间戳 */
  timestamp: string;

  /** 被移除的消息数 */
  removedCount: number;

  /** 节省的 tokens */
  tokensSaved: number;

  /** 压缩原因 */
  reason: 'threshold' | 'summarization' | 'manual';

  /** 压缩前的使用率 */
  usageRatioBefore: number;

  /** 压缩后的使用率 */
  usageRatioAfter: number;
}

/**
 * 消息分布
 */
export interface MessageDistribution {
  /** 用户消息数 */
  userMessages: number;

  /** 助手消息数 */
  assistantMessages: number;

  /** 工具调用数 */
  toolCalls: number;

  /** 工具结果数 */
  toolResults: number;

  /** 摘要数 */
  summaries: number;

  /** 总消息数 */
  totalMessages: number;
}

/**
 * 性能指标
 */
export interface PerformanceMetrics {
  /** 平均 token 使用量 */
  averageTokensPerTurn: number;

  /** 最大 token 使用量 */
  maxTokensPerTurn: number;

  /** 最小 token 使用量 */
  minTokensPerTurn: number;

  /** 压缩频率（每 N 轮压缩一次） */
  compressionFrequency: number;

  /** 平均压缩节省的 tokens */
  averageTokensSavedPerCompression: number;
}

/**
 * Context 统计数据
 */
export interface ContextStats {
  /** 会话 ID */
  sessionId: string;

  /** Context window 大小（token 数） */
  contextWindow: number;

  /** 当前使用量（token 数） */
  currentUsage: number;

  /** 使用率 (0-1) */
  usageRatio: number;

  /** 统计时间 */
  timestamp: string;

  /** Token 使用历史 */
  usageHistory: UsageHistoryEntry[];

  /** 压缩历史 */
  compactionHistory: CompactionHistoryEntry[];

  /** 消息分布 */
  messageDistribution: MessageDistribution;

  /** 性能指标 */
  performanceMetrics: PerformanceMetrics;
}

/**
 * 统计收集器配置
 */
export interface ContextStatsConfig {
  /** 存储目录 */
  storageDir: string;

  /** 是否启用历史记录 */
  enableHistory: boolean;

  /** 历史记录最大条数 */
  maxHistoryEntries: number;

  /** 是否自动保存 */
  autoSave: boolean;

  /** 自动保存间隔（毫秒） */
  autoSaveInterval: number;
}

/**
 * 统计收集器状态
 */
export interface ContextStatsState {
  /** 是否正在收集 */
  isCollecting: boolean;

  /** 当前轮次 */
  currentTurn: number;

  /** 最后保存时间 */
  lastSaveTime?: string;

  /** 未保存的变更数 */
  pendingChanges: number;
}

// ============================================================
// 默认配置
// ============================================================

const DEFAULT_CONFIG: ContextStatsConfig = {
  storageDir: join(homedir(), '.wasteland', 'sessions'),
  enableHistory: true,
  maxHistoryEntries: 1000,
  autoSave: true,
  autoSaveInterval: 30000, // 30秒
};

// ============================================================
// ContextStatsCollector 类
// ============================================================

/**
 * Context 统计收集器
 *
 * 收集和计算 context 使用统计。
 *
 * @example
 * const collector = new ContextStatsCollector('session-id', 128000);
 *
 * // 报告使用量
 * collector.reportUsage({
 *   promptTokens: 5000,
 *   completionTokens: 1000,
 *   totalTokens: 6000,
 * });
 *
 * // 报告压缩事件
 * collector.reportCompaction({
 *   removedCount: 10,
 *   tokensSaved: 45000,
 *   reason: 'threshold',
 * });
 *
 * // 获取统计
 * const stats = collector.getStats();
 */
export class ContextStatsCollector {
  private config: ContextStatsConfig;
  private stats: ContextStats;
  private state: ContextStatsState;
  private autoSaveTimer: NodeJS.Timeout | null = null;

  constructor(sessionId: string, contextWindow: number, config?: Partial<ContextStatsConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.stats = {
      sessionId,
      contextWindow,
      currentUsage: 0,
      usageRatio: 0,
      timestamp: new Date().toISOString(),
      usageHistory: [],
      compactionHistory: [],
      messageDistribution: {
        userMessages: 0,
        assistantMessages: 0,
        toolCalls: 0,
        toolResults: 0,
        summaries: 0,
        totalMessages: 0,
      },
      performanceMetrics: {
        averageTokensPerTurn: 0,
        maxTokensPerTurn: 0,
        minTokensPerTurn: Infinity,
        compressionFrequency: 0,
        averageTokensSavedPerCompression: 0,
      },
    };

    this.state = {
      isCollecting: false,
      currentTurn: 0,
      pendingChanges: 0,
    };

    // 启动自动保存
    if (this.config.autoSave) {
      this.startAutoSave();
    }
  }

  /**
   * 报告 token 使用量
   *
   * @param usage - 使用量信息
   */
  reportUsage(usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens?: number;
  }): void {
    this.state.isCollecting = true;

    try {
      // 更新当前使用量
      this.stats.currentUsage = usage.totalTokens;
      this.stats.usageRatio = usage.totalTokens / this.stats.contextWindow;
      this.stats.timestamp = new Date().toISOString();

      // 添加历史记录
      if (this.config.enableHistory) {
        const turn = this.state.currentTurn + 1;
        this.state.currentTurn = turn;

        const historyEntry: UsageHistoryEntry = {
          turn,
          timestamp: new Date().toISOString(),
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          cachedTokens: usage.cachedTokens,
          usageRatio: this.stats.usageRatio,
        };

        this.stats.usageHistory.push(historyEntry);

        // 限制历史记录条数
        if (this.stats.usageHistory.length > this.config.maxHistoryEntries) {
          this.stats.usageHistory.shift();
        }
      }

      // 更新性能指标
      this.updatePerformanceMetrics(usage.totalTokens);

      // 更新消息分布
      this.stats.messageDistribution.totalMessages++;

      // 标记有未保存的变更
      this.state.pendingChanges++;
    } finally {
      this.state.isCollecting = false;
    }
  }

  /**
   * 报告压缩事件
   *
   * @param event - 压缩事件信息
   */
  reportCompaction(event: {
    removedCount: number;
    tokensSaved: number;
    reason: 'threshold' | 'summarization' | 'manual';
  }): void {
    const usageRatioBefore = this.stats.usageRatio;

    // 更新使用量
    this.stats.currentUsage = Math.max(
      0,
      this.stats.currentUsage - event.tokensSaved
    );
    this.stats.usageRatio = this.stats.currentUsage / this.stats.contextWindow;
    this.stats.timestamp = new Date().toISOString();

    // 添加压缩历史
    if (this.config.enableHistory) {
      const compactionEntry: CompactionHistoryEntry = {
        timestamp: new Date().toISOString(),
        removedCount: event.removedCount,
        tokensSaved: event.tokensSaved,
        reason: event.reason,
        usageRatioBefore,
        usageRatioAfter: this.stats.usageRatio,
      };

      this.stats.compactionHistory.push(compactionEntry);

      // 限制历史记录条数
      if (this.stats.compactionHistory.length > this.config.maxHistoryEntries) {
        this.stats.compactionHistory.shift();
      }
    }

    // 更新压缩频率
    this.updateCompressionFrequency();

    // 标记有未保存的变更
    this.state.pendingChanges++;
  }

  /**
   * 报告消息
   *
   * @param messageType - 消息类型
   */
  reportMessage(messageType: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'summary'): void {
    switch (messageType) {
      case 'user':
        this.stats.messageDistribution.userMessages++;
        break;
      case 'assistant':
        this.stats.messageDistribution.assistantMessages++;
        break;
      case 'tool_call':
        this.stats.messageDistribution.toolCalls++;
        break;
      case 'tool_result':
        this.stats.messageDistribution.toolResults++;
        break;
      case 'summary':
        this.stats.messageDistribution.summaries++;
        break;
    }

    this.stats.messageDistribution.totalMessages++;
    this.state.pendingChanges++;
  }

  /**
   * 收集统计信息
   *
   * @returns 统计信息
   */
  collectStats(): ContextStats {
    return { ...this.stats };
  }

  /**
   * 获取当前使用量
   *
   * @returns 当前使用量（token 数）
   */
  getCurrentUsage(): number {
    return this.stats.currentUsage;
  }

  /**
   * 获取使用率
   *
   * @returns 使用率 (0-1)
   */
  getUsageRatio(): number {
    return this.stats.usageRatio;
  }

  /**
   * 获取 Context window 大小
   *
   * @returns Context window 大小（token 数）
   */
  getContextWindow(): number {
    return this.stats.contextWindow;
  }

  /**
   * 设置 Context window 大小
   *
   * @param size - Context window 大小（token 数）
   */
  setContextWindow(size: number): void {
    this.stats.contextWindow = size;
    this.stats.usageRatio = this.stats.currentUsage / size;
    this.state.pendingChanges++;
  }

  /**
   * 获取使用历史
   *
   * @param limit - 返回的最大条数
   * @returns 使用历史
   */
  getUsageHistory(limit?: number): UsageHistoryEntry[] {
    const history = this.stats.usageHistory;
    if (limit) {
      return history.slice(-limit);
    }
    return [...history];
  }

  /**
   * 获取压缩历史
   *
   * @param limit - 返回的最大条数
   * @returns 压缩历史
   */
  getCompactionHistory(limit?: number): CompactionHistoryEntry[] {
    const history = this.stats.compactionHistory;
    if (limit) {
      return history.slice(-limit);
    }
    return [...history];
  }

  /**
   * 获取消息分布
   *
   * @returns 消息分布
   */
  getMessageDistribution(): MessageDistribution {
    return { ...this.stats.messageDistribution };
  }

  /**
   * 获取性能指标
   *
   * @returns 性能指标
   */
  getPerformanceMetrics(): PerformanceMetrics {
    return { ...this.stats.performanceMetrics };
  }

  /**
   * 获取状态
   *
   * @returns 状态
   */
  getState(): ContextStatsState {
    return { ...this.state };
  }

  /**
   * 保存统计到磁盘
   *
   * @returns 是否保存成功
   */
  async save(): Promise<boolean> {
    try {
      const sessionDir = join(this.config.storageDir, this.stats.sessionId);
      await mkdir(sessionDir, { recursive: true });

      const filePath = join(sessionDir, 'context-stats.json');
      await writeFile(filePath, JSON.stringify(this.stats, null, 2));

      this.state.lastSaveTime = new Date().toISOString();
      this.state.pendingChanges = 0;

      return true;
    } catch (error) {
      console.error('Failed to save context stats:', error);
      return false;
    }
  }

  /**
   * 从磁盘加载统计
   *
   * @returns 是否加载成功
   */
  async load(): Promise<boolean> {
    try {
      const filePath = join(
        this.config.storageDir,
        this.stats.sessionId,
        'context-stats.json'
      );

      const content = await readFile(filePath, 'utf-8');
      const loadedStats = JSON.parse(content) as ContextStats;

      // 合并加载的统计
      this.stats = {
        ...this.stats,
        ...loadedStats,
      };

      // 更新状态
      this.state.currentTurn = this.stats.usageHistory.length;
      this.state.pendingChanges = 0;

      return true;
    } catch {
      // 文件不存在，忽略
      return false;
    }
  }

  /**
   * 重置统计
   */
  reset(): void {
    const sessionId = this.stats.sessionId;
    const contextWindow = this.stats.contextWindow;

    this.stats = {
      sessionId,
      contextWindow,
      currentUsage: 0,
      usageRatio: 0,
      timestamp: new Date().toISOString(),
      usageHistory: [],
      compactionHistory: [],
      messageDistribution: {
        userMessages: 0,
        assistantMessages: 0,
        toolCalls: 0,
        toolResults: 0,
        summaries: 0,
        totalMessages: 0,
      },
      performanceMetrics: {
        averageTokensPerTurn: 0,
        maxTokensPerTurn: 0,
        minTokensPerTurn: Infinity,
        compressionFrequency: 0,
        averageTokensSavedPerCompression: 0,
      },
    };

    this.state = {
      isCollecting: false,
      currentTurn: 0,
      pendingChanges: 0,
    };
  }

  /**
   * 启动自动保存
   */
  private startAutoSave(): void {
    this.autoSaveTimer = setInterval(async () => {
      if (this.state.pendingChanges > 0) {
        await this.save();
      }
    }, this.config.autoSaveInterval);
  }

  /**
   * 停止自动保存
   */
  stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * 更新性能指标
   *
   * @param totalTokens - 总 token 数
   */
  private updatePerformanceMetrics(totalTokens: number): void {
    const history = this.stats.usageHistory;
    const count = history.length;

    // 更新最大最小值
    this.stats.performanceMetrics.maxTokensPerTurn = Math.max(
      this.stats.performanceMetrics.maxTokensPerTurn,
      totalTokens
    );

    if (totalTokens > 0) {
      this.stats.performanceMetrics.minTokensPerTurn = Math.min(
        this.stats.performanceMetrics.minTokensPerTurn,
        totalTokens
      );
    }

    // 计算平均值
    if (count > 0) {
      const total = history.reduce((sum, h) => sum + h.totalTokens, 0);
      this.stats.performanceMetrics.averageTokensPerTurn = total / count;
    }
  }

  /**
   * 更新压缩频率
   */
  private updateCompressionFrequency(): void {
    const compactions = this.stats.compactionHistory.length;
    const turns = this.stats.usageHistory.length;

    if (compactions > 0) {
      this.stats.performanceMetrics.compressionFrequency = turns / compactions;

      const totalSaved = this.stats.compactionHistory.reduce(
        (sum, c) => sum + c.tokensSaved,
        0
      );
      this.stats.performanceMetrics.averageTokensSavedPerCompression =
        totalSaved / compactions;
    }
  }

  /**
   * 销毁收集器
   */
  destroy(): void {
    this.stopAutoSave();
  }
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 创建 Context 统计收集器
 *
 * @param sessionId - 会话 ID
 * @param contextWindow - Context window 大小
 * @param config - 配置
 * @returns ContextStatsCollector 实例
 */
export function createContextStatsCollector(
  sessionId: string,
  contextWindow: number,
  config?: Partial<ContextStatsConfig>
): ContextStatsCollector {
  return new ContextStatsCollector(sessionId, contextWindow, config);
}
