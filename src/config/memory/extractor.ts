/**
 * extractor.ts - Memory 提取器
 *
 * 从对话中自动提取关键信息，包括用户偏好、项目知识、决策记录等。
 *
 * ## 设计原则
 *
 * - 增量提取：只处理新的对话内容
 * - 置信度评估：量化提取信息的可靠性
 * - 并发控制：避免重复提取
 * - 错误恢复：提取失败时降级处理
 */

import type { AgentProvider } from '@providers/provider-types.js';
import type { HistoryRecord } from '@core/runtime/event-types.js';
import { createTurnContext } from '@core/runtime/turn-context.js';
import { createInitialTurnState } from '@core/runtime/turn-state.js';
import type { ChatInputTurn } from '@core/runtime/event-types.js';
import { lastValueFrom, timeout, toArray } from 'rxjs';

// ============================================================
// 类型定义
// ============================================================

/**
 * 提取类型
 */
export type ExtractType =
  | 'user_preference'
  | 'project_knowledge'
  | 'decision'
  | 'code_convention'
  | 'error_pattern';

/**
 * 提取结果
 */
export interface MemoryExtract {
  /** 提取类型 */
  type: ExtractType;
  /** 提取内容 */
  content: string;
  /** 置信度 (0-1) */
  confidence: number;
  /** 来源轮次 */
  source_turn: number;
  /** 上下文信息 */
  context?: string;
}

/**
 * 提取配置
 */
export interface ExtractionConfig {
  /** 基础轮次间隔 */
  baseInterval: number;
  /** 最小间隔 */
  minInterval: number;
  /** 最大间隔 */
  maxInterval: number;
  /** 是否在对话结束时提取 */
  extractOnEnd: boolean;
  /** 最小置信度阈值 */
  minConfidence: number;
  /** 提取超时时间（毫秒） */
  timeoutMs: number;
}

/**
 * 提取结果
 */
export interface ExtractionResult {
  /** 是否成功 */
  success: boolean;
  /** 提取的信息 */
  extracts: MemoryExtract[];
  /** 错误信息 */
  error?: string;
  /** 提取耗时（毫秒） */
  duration: number;
}

/**
 * 提取统计
 */
export interface ExtractionStats {
  /** 总提取次数 */
  totalExtractions: number;
  /** 成功提取次数 */
  successfulExtractions: number;
  /** 提取的总信息数 */
  totalExtracts: number;
  /** 平均置信度 */
  averageConfidence: number;
  /** 最后提取时间 */
  lastExtractionTime?: string;
}

// ============================================================
// 默认配置
// ============================================================

const DEFAULT_CONFIG: ExtractionConfig = {
  baseInterval: 10,
  minInterval: 5,
  maxInterval: 20,
  extractOnEnd: true,
  minConfidence: 0.5,
  timeoutMs: 30000,
};

// ============================================================
// MemoryExtractor 类
// ============================================================

/**
 * Memory 提取器
 *
 * 从对话中自动提取关键信息。
 *
 * @example
 * const extractor = new MemoryExtractor(provider);
 *
 * // 提取信息
 * const result = await extractor.extractFromConversation(
 *   sessionId,
 *   history,
 *   turnCount
 * );
 *
 * if (result.success) {
 *   console.log(`Extracted ${result.extracts.length} items`);
 * }
 */
export class MemoryExtractor {
  private provider: AgentProvider;
  private config: ExtractionConfig;
  private extractionLock: boolean = false;
  private lastExtractionTurn: number = 0;
  private stats: ExtractionStats = {
    totalExtractions: 0,
    successfulExtractions: 0,
    totalExtracts: 0,
    averageConfidence: 0,
  };

  constructor(provider: AgentProvider, config?: Partial<ExtractionConfig>) {
    this.provider = provider;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 从对话中提取信息
   *
   * @param sessionId - 会话 ID
   * @param history - 对话历史
   * @param currentTurn - 当前轮次
   * @param existingMemory - 已有的记忆（可选，用于增量提取）
   * @returns 提取结果
   */
  async extractFromConversation(
    sessionId: string,
    history: readonly HistoryRecord[],
    currentTurn: number,
    existingMemory?: string
  ): Promise<ExtractionResult> {
    const startTime = Date.now();

    // 防止并发提取
    if (this.extractionLock) {
      return {
        success: false,
        extracts: [],
        error: 'Extraction already in progress',
        duration: 0,
      };
    }

    try {
      this.extractionLock = true;

      // 检查是否需要提取
      if (!this.shouldExtract(currentTurn)) {
        return {
          success: false,
          extracts: [],
          error: 'Not ready for extraction yet',
          duration: Date.now() - startTime,
        };
      }

      // 准备对话内容
      const conversation = this.formatConversationForExtraction(history);

      // 构建提取 prompt
      const prompt = this.buildExtractionPrompt(conversation, existingMemory);

      // 调用 LLM 进行提取
      const extracts = await this.callLLMForExtraction(
        sessionId,
        prompt,
        currentTurn
      );

      // 验证和过滤提取结果
      const validatedExtracts = this.validateExtracts(extracts);

      // 更新统计
      this.updateStats(validatedExtracts);
      this.lastExtractionTurn = currentTurn;

      const duration = Date.now() - startTime;

      return {
        success: true,
        extracts: validatedExtracts,
        duration,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Memory extraction failed:', errorMessage);

      return {
        success: false,
        extracts: [],
        error: errorMessage,
        duration: Date.now() - startTime,
      };
    } finally {
      this.extractionLock = false;
    }
  }

  /**
   * 检查是否应该提取
   *
   * @param currentTurn - 当前轮次
   * @returns 是否应该提取
   */
  private shouldExtract(currentTurn: number): boolean {
    // 计算自上次提取以来的轮次
    const turnsSinceLastExtraction = currentTurn - this.lastExtractionTurn;

    // 动态调整提取间隔
    const interval = this.calculateDynamicInterval(turnsSinceLastExtraction);

    return turnsSinceLastExtraction >= interval;
  }

  /**
   * 计算动态提取间隔
   *
   * @param turnsSinceLastExtraction - 自上次提取以来的轮次
   * @returns 提取间隔
   */
  private calculateDynamicInterval(_turnsSinceLastExtraction: number): number {
    // 基础间隔
    let interval = this.config.baseInterval;

    // 如果最近提取的信息置信度较高，缩短间隔
    if (this.stats.averageConfidence > 0.7) {
      interval = Math.max(this.config.minInterval, interval - 2);
    }

    // 如果最近提取的信息置信度较低，延长间隔
    if (this.stats.averageConfidence < 0.5) {
      interval = Math.min(this.config.maxInterval, interval + 2);
    }

    return interval;
  }

  /**
   * 格式化对话内容用于提取
   *
   * @param history - 对话历史
   * @returns 格式化后的对话内容
   */
  private formatConversationForExtraction(history: readonly HistoryRecord[]): string {
    const lines: string[] = [];

    for (const record of history) {
      if (record.type === 'message') {
        const role = record.role === 'user' ? 'User' : 'Assistant';
        lines.push(`[${role}] ${record.content}`);
      } else if (record.type === 'tool_call') {
        lines.push(`[Tool Call] ${record.toolName}: ${JSON.stringify(record.input ?? {})}`);
      } else if (record.type === 'tool_result') {
        const body = record.status === 'success' ? (record.output ?? '') : (record.error ?? '');
        const short = body.length > 500 ? `${body.slice(0, 500)}...` : body;
        lines.push(`[Tool Result] ${record.toolName}: ${short}`);
      } else if (record.type === 'summary') {
        lines.push(`[Summary] ${record.content}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 构建提取 prompt
   *
   * @param conversation - 对话内容
   * @param existingMemory - 已有的记忆
   * @returns 提取 prompt
   */
  private buildExtractionPrompt(conversation: string, existingMemory?: string): string {
    if (existingMemory) {
      return this.buildIncrementalExtractionPrompt(conversation, existingMemory);
    }

    return this.buildFullExtractionPrompt(conversation);
  }

  /**
   * 构建完整提取 prompt
   *
   * @param conversation - 对话内容
   * @returns 提取 prompt
   */
  private buildFullExtractionPrompt(conversation: string): string {
    return `你是一个信息提取专家。请从以下对话中提取关键信息。

对话内容:
${conversation}

请提取以下类型的信息:
1. 用户偏好 (user_preference): 用户表现出的偏好和习惯
2. 项目知识 (project_knowledge): 关于项目的技术栈、架构等知识
3. 决策记录 (decision): 用户做出的重要决策
4. 代码规范 (code_convention): 用户遵循的代码规范
5. 错误模式 (error_pattern): 用户遇到的错误和解决方案

对于每条提取的信息，请提供:
- type: 提取类型
- content: 提取内容
- confidence: 置信度 (0-1)
- context: 上下文信息 (可选)

请以 JSON 数组格式输出，例如:
[
  {
    "type": "user_preference",
    "content": "用户偏好使用 TypeScript",
    "confidence": 0.9,
    "context": "用户在讨论技术选型时提到"
  }
]

如果没有值得提取的信息，请返回空数组 []。`;
  }

  /**
   * 构建增量提取 prompt
   *
   * @param conversation - 对话内容
   * @param existingMemory - 已有的记忆
   * @returns 提取 prompt
   */
  private buildIncrementalExtractionPrompt(conversation: string, existingMemory: string): string {
    return `你是一个信息提取专家。请从以下对话片段中提取新的关键信息。

已有的记忆:
${existingMemory}

新的对话片段:
${conversation}

请只提取对话片段中新的、尚未在已有记忆中记录的信息。

对于每条提取的信息，请提供:
- type: 提取类型
- content: 提取内容
- confidence: 置信度 (0-1)
- context: 上下文信息 (可选)

请以 JSON 数组格式输出，例如:
[
  {
    "type": "project_knowledge",
    "content": "项目使用 PostgreSQL 数据库",
    "confidence": 0.85,
    "context": "用户在讨论数据库选型时提到"
  }
]

如果没有新的信息，请返回空数组 []。`;
  }

  /**
   * 调用 LLM 进行提取
   *
   * @param sessionId - 会话 ID
   * @param prompt - 提取 prompt
   * @param turn - 当前轮次
   * @returns 提取的信息
   */
  private async callLLMForExtraction(
    sessionId: string,
    prompt: string,
    turn: number
  ): Promise<MemoryExtract[]> {
    const input: ChatInputTurn = {
      turn,
      content: prompt,
      source: 'interactive',
    };

    const context = createTurnContext({
      sessionId,
      input,
      cwd: process.cwd(),
      history: [],
      prompt: 'You are a memory extraction expert. Extract key information from conversations.',
    });

    const state = createInitialTurnState({
      sessionId,
      input,
      cwd: process.cwd(),
      history: [],
    });

    const events = await lastValueFrom(
      this.provider.runStep({ context, state }).pipe(
        timeout(this.config.timeoutMs),
        toArray()
      ),
      { defaultValue: [] }
    );

    // 提取响应内容
    const finalMsg = events.find((e) => e.type === 'assistant_message');
    let responseText: string;

    if (finalMsg && finalMsg.type === 'assistant_message') {
      responseText = finalMsg.text;
    } else {
      // 退化为拼接 chunks
      responseText = events
        .map((e) => (e.type === 'assistant_chunk' ? e.text : ''))
        .join('');
    }

    // 解析 JSON 响应
    return this.parseExtractionResponse(responseText);
  }

  /**
   * 解析提取响应
   *
   * @param response - LLM 响应
   * @returns 解析后的提取信息
   */
  private parseExtractionResponse(response: string): MemoryExtract[] {
    try {
      // 尝试提取 JSON 数组
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return [];
      }

      const jsonStr = jsonMatch[0];
      const parsed = JSON.parse(jsonStr);

      if (!Array.isArray(parsed)) {
        return [];
      }

      // 验证每条提取信息
      return parsed.filter((item: Record<string, unknown>) => {
        return (
          item.type &&
          item.content &&
          typeof item.confidence === 'number' &&
          item.confidence >= 0 &&
          item.confidence <= 1
        );
      });
    } catch (error) {
      console.error('Failed to parse extraction response:', error);
      return [];
    }
  }

  /**
   * 验证提取结果
   *
   * @param extracts - 提取的信息
   * @returns 验证后的提取信息
   */
  private validateExtracts(extracts: MemoryExtract[]): MemoryExtract[] {
    return extracts.filter((extract) => {
      // 检查置信度阈值
      if (extract.confidence < this.config.minConfidence) {
        return false;
      }

      // 检查内容长度
      if (extract.content.length < 10) {
        return false;
      }

      // 检查类型有效性
      const validTypes: ExtractType[] = [
        'user_preference',
        'project_knowledge',
        'decision',
        'code_convention',
        'error_pattern',
      ];

      if (!validTypes.includes(extract.type)) {
        return false;
      }

      return true;
    });
  }

  /**
   * 更新统计信息
   *
   * @param extracts - 提取的信息
   */
  private updateStats(extracts: MemoryExtract[]): void {
    this.stats.totalExtractions++;
    this.stats.lastExtractionTime = new Date().toISOString();

    if (extracts.length > 0) {
      this.stats.successfulExtractions++;
      this.stats.totalExtracts += extracts.length;

      // 更新平均置信度
      const totalConfidence = extracts.reduce((sum, e) => sum + e.confidence, 0);
      const avgConfidence = totalConfidence / extracts.length;

      this.stats.averageConfidence =
        (this.stats.averageConfidence * (this.stats.totalExtractions - 1) + avgConfidence) /
        this.stats.totalExtractions;
    }
  }

  /**
   * 获取统计信息
   *
   * @returns 统计信息
   */
  getStats(): ExtractionStats {
    return { ...this.stats };
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    this.stats = {
      totalExtractions: 0,
      successfulExtractions: 0,
      totalExtracts: 0,
      averageConfidence: 0,
    };
  }

  /**
   * 强制提取（忽略轮次检查）
   *
   * @param sessionId - 会话 ID
   * @param history - 对话历史
   * @param currentTurn - 当前轮次
   * @param existingMemory - 已有的记忆
   * @returns 提取结果
   */
  async forceExtraction(
    sessionId: string,
    history: readonly HistoryRecord[],
    currentTurn: number,
    existingMemory?: string
  ): Promise<ExtractionResult> {
    // 临时禁用轮次检查
    const originalLastTurn = this.lastExtractionTurn;
    this.lastExtractionTurn = 0;

    try {
      return await this.extractFromConversation(
        sessionId,
        history,
        currentTurn,
        existingMemory
      );
    } finally {
      // 恢复原始轮次
      this.lastExtractionTurn = originalLastTurn;
    }
  }
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 创建 Memory 提取器
 *
 * @param provider - LLM 提供者
 * @param config - 提取配置
 * @returns MemoryExtractor 实例
 */
export function createMemoryExtractor(
  provider: AgentProvider,
  config?: Partial<ExtractionConfig>
): MemoryExtractor {
  return new MemoryExtractor(provider, config);
}
