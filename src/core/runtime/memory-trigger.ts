/**
 * memory-trigger.ts - Memory 自动提取触发器
 *
 * 在对话结束或达到一定轮次时自动触发 Memory 提取。
 *
 * ## 设计原则
 *
 * - 异步执行：不阻塞主对话流程
 * - 状态跟踪：记录提取状态和历史
 * - 错误恢复：提取失败时降级处理
 * - 资源控制：避免频繁提取消耗资源
 */

import type { AgentProvider } from '@providers/provider-types.js';
import type { HistoryRecord } from './event-types.js';
import { MemoryExtractor, type ExtractionConfig, type ExtractionResult } from '@config/memory/extractor.js';
import { MemoryUpdater, type MemoryUpdaterConfig, type UpdateResult } from '@config/memory/updater.js';

// ============================================================
// 类型定义
// ============================================================

/**
 * 触发器配置
 */
export interface MemoryTriggerConfig {
  /** 提取配置 */
  extractionConfig?: Partial<ExtractionConfig>;
  /** 更新配置 */
  updaterConfig?: Partial<MemoryUpdaterConfig>;
  /** 是否启用自动提取 */
  enabled: boolean;
  /** 触发模式 */
  triggerMode: 'turn_based' | 'end_based' | 'both';
  /** 轮次触发间隔 */
  turnInterval: number;
  /** 是否在对话结束时触发 */
  triggerOnEnd: boolean;
  /** 是否异步执行 */
  asyncExecution: boolean;
}

/**
 * 触发器状态
 */
export interface MemoryTriggerState {
  /** 是否正在提取 */
  isExtracting: boolean;
  /** 当前轮次 */
  currentTurn: number;
  /** 上次提取轮次 */
  lastExtractionTurn: number;
  /** 提取次数 */
  extractionCount: number;
  /** 最后提取时间 */
  lastExtractionTime?: string;
  /** 错误计数 */
  errorCount: number;
}

/**
 * 触发器事件
 */
export type MemoryTriggerEvent =
  | { type: 'extraction_started'; turn: number }
  | { type: 'extraction_completed'; turn: number; result: ExtractionResult }
  | { type: 'extraction_failed'; turn: number; error: string }
  | { type: 'update_completed'; turn: number; result: UpdateResult }
  | { type: 'update_failed'; turn: number; error: string };

/**
 * 触发器回调
 */
export interface MemoryTriggerCallbacks {
  /** 提取开始回调 */
  onExtractionStart?: (turn: number) => void;
  /** 提取完成回调 */
  onExtractionComplete?: (turn: number, result: ExtractionResult) => void;
  /** 提取失败回调 */
  onExtractionFailed?: (turn: number, error: string) => void;
  /** 更新完成回调 */
  onUpdateComplete?: (turn: number, result: UpdateResult) => void;
  /** 更新失败回调 */
  onUpdateFailed?: (turn: number, error: string) => void;
}

// ============================================================
// 默认配置
// ============================================================

const DEFAULT_CONFIG: MemoryTriggerConfig = {
  enabled: true,
  triggerMode: 'both',
  turnInterval: 10,
  triggerOnEnd: true,
  asyncExecution: true,
};

// ============================================================
// MemoryTrigger 类
// ============================================================

/**
 * Memory 自动提取触发器
 *
 * 在对话过程中自动触发 Memory 提取。
 *
 * @example
 * const trigger = new MemoryTrigger(provider, {
 *   enabled: true,
 *   triggerMode: 'both',
 *   turnInterval: 10,
 * });
 *
 * // 监听事件
 * trigger.onEvent((event) => {
 *   console.log('Memory event:', event.type);
 * });
 *
 * // 在对话轮次中调用
 * await trigger.onTurnComplete(sessionId, history, currentTurn);
 *
 * // 对话结束时调用
 * await trigger.onConversationEnd(sessionId, history, currentTurn);
 */
export class MemoryTrigger {
  private provider: AgentProvider;
  private config: MemoryTriggerConfig;
  private extractor: MemoryExtractor;
  private updater: MemoryUpdater;
  private state: MemoryTriggerState;
  private callbacks: MemoryTriggerCallbacks;
  private eventListeners: Array<(event: MemoryTriggerEvent) => void> = [];

  constructor(
    provider: AgentProvider,
    config?: Partial<MemoryTriggerConfig>,
    callbacks?: MemoryTriggerCallbacks
  ) {
    this.provider = provider;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.callbacks = callbacks || {};

    this.extractor = new MemoryExtractor(provider, this.config.extractionConfig);
    this.updater = new MemoryUpdater(this.config.updaterConfig);

    this.state = {
      isExtracting: false,
      currentTurn: 0,
      lastExtractionTurn: 0,
      extractionCount: 0,
      errorCount: 0,
    };
  }

  /**
   * 轮次完成时调用
   *
   * @param sessionId - 会话 ID
   * @param history - 对话历史
   * @param currentTurn - 当前轮次
   */
  async onTurnComplete(
    sessionId: string,
    history: readonly HistoryRecord[],
    currentTurn: number
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    this.state.currentTurn = currentTurn;

    // 检查是否需要触发提取
    if (this.shouldTriggerOnTurn(currentTurn)) {
      await this.triggerExtraction(sessionId, history, currentTurn);
    }
  }

  /**
   * 对话结束时调用
   *
   * @param sessionId - 会话 ID
   * @param history - 对话历史
   * @param currentTurn - 当前轮次
   */
  async onConversationEnd(
    sessionId: string,
    history: readonly HistoryRecord[],
    currentTurn: number
  ): Promise<void> {
    if (!this.config.enabled || !this.config.triggerOnEnd) {
      return;
    }

    // 对话结束时强制提取
    await this.triggerExtraction(sessionId, history, currentTurn, true);
  }

  /**
   * 检查是否应该在轮次完成时触发
   *
   * @param currentTurn - 当前轮次
   * @returns 是否应该触发
   */
  private shouldTriggerOnTurn(currentTurn: number): boolean {
    // 检查触发模式
    if (this.config.triggerMode === 'end_based') {
      return false;
    }

    // 检查轮次间隔
    const turnsSinceLastExtraction = currentTurn - this.state.lastExtractionTurn;
    return turnsSinceLastExtraction >= this.config.turnInterval;
  }

  /**
   * 触发提取
   *
   * @param sessionId - 会话 ID
   * @param history - 对话历史
   * @param currentTurn - 当前轮次
   * @param force - 是否强制提取
   */
  private async triggerExtraction(
    sessionId: string,
    history: readonly HistoryRecord[],
    currentTurn: number,
    force: boolean = false
  ): Promise<void> {
    // 防止并发提取
    if (this.state.isExtracting) {
      return;
    }

    this.state.isExtracting = true;

    // 触发开始事件
    this.emitEvent({ type: 'extraction_started', turn: currentTurn });
    this.callbacks.onExtractionStart?.(currentTurn);

    try {
      // 异步或同步执行
      if (this.config.asyncExecution) {
        // 异步执行，不阻塞主流程
        this.extractAsync(sessionId, history, currentTurn, force).catch((error) => {
          console.error('Async extraction failed:', error);
        });
      } else {
        // 同步执行
        await this.extractSync(sessionId, history, currentTurn, force);
      }
    } finally {
      this.state.isExtracting = false;
    }
  }

  /**
   * 异步提取
   *
   * @param sessionId - 会话 ID
   * @param history - 对话历史
   * @param currentTurn - 当前轮次
   * @param force - 是否强制提取
   */
  private async extractAsync(
    sessionId: string,
    history: readonly HistoryRecord[],
    currentTurn: number,
    force: boolean
  ): Promise<void> {
    try {
      // 执行提取
      const extractResult = force
        ? await this.extractor.forceExtraction(sessionId, history, currentTurn)
        : await this.extractor.extractFromConversation(sessionId, history, currentTurn);

      // 触发完成事件
      this.emitEvent({ type: 'extraction_completed', turn: currentTurn, result: extractResult });
      this.callbacks.onExtractionComplete?.(currentTurn, extractResult);

      // 如果提取成功，执行更新
      if (extractResult.success && extractResult.extracts.length > 0) {
        const updateResult = await this.updater.mergeMemory(
          extractResult.extracts,
          sessionId,
          currentTurn
        );

        // 触发更新完成事件
        this.emitEvent({ type: 'update_completed', turn: currentTurn, result: updateResult });
        this.callbacks.onUpdateComplete?.(currentTurn, updateResult);

        // 更新状态
        this.state.lastExtractionTurn = currentTurn;
        this.state.extractionCount++;
        this.state.lastExtractionTime = new Date().toISOString();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // 触发失败事件
      this.emitEvent({ type: 'extraction_failed', turn: currentTurn, error: errorMessage });
      this.callbacks.onExtractionFailed?.(currentTurn, errorMessage);

      // 更新错误计数
      this.state.errorCount++;
    }
  }

  /**
   * 同步提取
   *
   * @param sessionId - 会话 ID
   * @param history - 对话历史
   * @param currentTurn - 当前轮次
   * @param force - 是否强制提取
   */
  private async extractSync(
    sessionId: string,
    history: readonly HistoryRecord[],
    currentTurn: number,
    force: boolean
  ): Promise<void> {
    try {
      // 执行提取
      const extractResult = force
        ? await this.extractor.forceExtraction(sessionId, history, currentTurn)
        : await this.extractor.extractFromConversation(sessionId, history, currentTurn);

      // 触发完成事件
      this.emitEvent({ type: 'extraction_completed', turn: currentTurn, result: extractResult });
      this.callbacks.onExtractionComplete?.(currentTurn, extractResult);

      // 如果提取成功，执行更新
      if (extractResult.success && extractResult.extracts.length > 0) {
        const updateResult = await this.updater.mergeMemory(
          extractResult.extracts,
          sessionId,
          currentTurn
        );

        // 触发更新完成事件
        this.emitEvent({ type: 'update_completed', turn: currentTurn, result: updateResult });
        this.callbacks.onUpdateComplete?.(currentTurn, updateResult);

        // 更新状态
        this.state.lastExtractionTurn = currentTurn;
        this.state.extractionCount++;
        this.state.lastExtractionTime = new Date().toISOString();
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // 触发失败事件
      this.emitEvent({ type: 'extraction_failed', turn: currentTurn, error: errorMessage });
      this.callbacks.onExtractionFailed?.(currentTurn, errorMessage);

      // 更新错误计数
      this.state.errorCount++;
    }
  }

  /**
   * 监听事件
   *
   * @param listener - 事件监听器
   * @returns 取消监听的函数
   */
  onEvent(listener: (event: MemoryTriggerEvent) => void): () => void {
    this.eventListeners.push(listener);

    return () => {
      const index = this.eventListeners.indexOf(listener);
      if (index >= 0) {
        this.eventListeners.splice(index, 1);
      }
    };
  }

  /**
   * 触发事件
   *
   * @param event - 事件
   */
  private emitEvent(event: MemoryTriggerEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Event listener error:', error);
      }
    }
  }

  /**
   * 获取触发器状态
   *
   * @returns 状态
   */
  getState(): MemoryTriggerState {
    return { ...this.state };
  }

  /**
   * 获取提取统计
   *
   * @returns 统计信息
   */
  getExtractionStats() {
    return this.extractor.getStats();
  }

  /**
   * 获取更新统计
   *
   * @returns 统计信息
   */
  async getUpdateStats() {
    return this.updater.getStats();
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.state = {
      isExtracting: false,
      currentTurn: 0,
      lastExtractionTurn: 0,
      extractionCount: 0,
      errorCount: 0,
    };

    this.extractor.resetStats();
  }

  /**
   * 启用/禁用触发器
   *
   * @param enabled - 是否启用
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * 更新配置
   *
   * @param config - 新配置
   */
  updateConfig(config: Partial<MemoryTriggerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 创建 Memory 触发器
 *
 * @param provider - LLM 提供者
 * @param config - 触发器配置
 * @param callbacks - 回调函数
 * @returns MemoryTrigger 实例
 */
export function createMemoryTrigger(
  provider: AgentProvider,
  config?: Partial<MemoryTriggerConfig>,
  callbacks?: MemoryTriggerCallbacks
): MemoryTrigger {
  return new MemoryTrigger(provider, config, callbacks);
}
