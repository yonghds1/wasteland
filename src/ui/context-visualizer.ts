/**
 * context-visualizer.ts - Context 可视化渲染器
 *
 * 以图表/表格形式展示 context 使用情况。
 *
 * ## 设计原则
 *
 * - 多种输出格式：文本、JSON、图表
 * - 实时更新：支持动态刷新
 * - 可定制：支持自定义样式和配置
 * - 高性能：增量渲染，减少重绘
 */

import type {
  ContextStats,
  UsageHistoryEntry,
  MessageDistribution,
  PerformanceMetrics,
} from '@core/runtime/context-stats.js';

import { ANSI } from './terminal-theme.js';

// ============================================================
// 类型定义
// ============================================================

/**
 * 输出格式
 */
export type OutputFormat = 'text' | 'json' | 'markdown' | 'html';

/**
 * 渲染配置
 */
export interface VisualizerConfig {
  /** 输出格式 */
  format: OutputFormat;

  /** 是否显示颜色 */
  enableColors: boolean;

  /** 是否显示详细信息 */
  showDetails: boolean;

  /** 是否显示历史记录 */
  showHistory: boolean;

  /** 历史记录显示条数 */
  historyLimit: number;

  /** 进度条长度 */
  progressBarLength: number;

  /** 是否显示压缩历史 */
  showCompactionHistory: boolean;

  /** 压缩历史显示条数 */
  compactionHistoryLimit: number;
}

/**
 * 状态卡片
 */
export interface StatusCard {
  /** 标题 */
  title: string;

  /** 当前值 */
  currentValue: number;

  /** 最大值 */
  maxValue: number;

  /** 单位 */
  unit: string;

  /** 颜色编码 */
  color: 'green' | 'yellow' | 'red' | 'gray';

  /** 进度条 */
  progressBar: string;

  /** 百分比 */
  percentage: number;
}

/**
 * 图表数据点
 */
export interface ChartDataPoint {
  /** X 轴值 */
  x: number | string;

  /** Y 轴值 */
  y: number;

  /** 标签 */
  label?: string;

  /** 颜色 */
  color?: string;
}

/**
 * 图表配置
 */
export interface ChartConfig {
  /** 图表类型 */
  type: 'line' | 'area' | 'bar' | 'pie';

  /** 标题 */
  title: string;

  /** 宽度 */
  width: number;

  /** 高度 */
  height: number;

  /** 是否显示网格 */
  showGrid: boolean;

  /** 是否显示标签 */
  showLabels: boolean;

  /** 颜色方案 */
  colorScheme: string[];
}

// ============================================================
// 默认配置
// ============================================================

const DEFAULT_CONFIG: VisualizerConfig = {
  format: 'text',
  enableColors: true,
  showDetails: true,
  showHistory: true,
  historyLimit: 10,
  progressBarLength: 30,
  showCompactionHistory: true,
  compactionHistoryLimit: 5,
};

// ============================================================
// 颜色定义（复用 CLI 统一 ANSI 调色板，避免重复定义）
// ============================================================

const COLORS = ANSI;

// ============================================================
// ContextVisualizer 类
// ============================================================

/**
 * Context 可视化渲染器
 *
 * 以图表/表格形式展示 context 使用情况。
 *
 * @example
 * const visualizer = new ContextVisualizer();
 *
 * // 渲染统计表格
 * const table = visualizer.renderStatsTable(stats);
 * console.log(table);
 *
 * // 渲染 token 进度条
 * const progress = visualizer.renderTokenProgress(stats);
 * console.log(progress);
 *
 * // 渲染压缩历史
 * const history = visualizer.renderCompactionHistory(stats);
 * console.log(history);
 */
export class ContextVisualizer {
  private config: VisualizerConfig;

  constructor(config?: Partial<VisualizerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 渲染统计表格
   *
   * @param stats - Context 统计数据
   * @returns 渲染后的表格字符串
   */
  renderStatsTable(stats: ContextStats): string {
    switch (this.config.format) {
      case 'json':
        return this.renderStatsJson(stats);
      case 'markdown':
        return this.renderStatsMarkdown(stats);
      case 'html':
        return this.renderStatsHtml(stats);
      case 'text':
      default:
        return this.renderStatsText(stats);
    }
  }

  /**
   * 渲染文本格式统计表格
   *
   * @param stats - Context 统计数据
   * @returns 渲染后的表格字符串
   */
  private renderStatsText(stats: ContextStats): string {
    const lines: string[] = [];

    // 标题
    lines.push(this.colorize('📊 Context 使用统计', 'bold'));
    lines.push('');

    // 基本信息
    lines.push(`会话 ID: ${stats.sessionId}`);
    lines.push(`Context Window: ${this.formatNumber(stats.contextWindow)} tokens`);
    lines.push(`当前使用: ${this.formatNumber(stats.currentUsage)} tokens`);
    lines.push('');

    // 使用率进度条
    const progress = this.renderTokenProgress(stats);
    lines.push(progress);
    lines.push('');

    // 消息分布
    if (this.config.showDetails) {
      const distribution = this.renderMessageDistribution(stats.messageDistribution);
      lines.push(distribution);
      lines.push('');
    }

    // 性能指标
    if (this.config.showDetails) {
      const performance = this.renderPerformanceMetrics(stats.performanceMetrics);
      lines.push(performance);
      lines.push('');
    }

    // 压缩历史
    if (this.config.showCompactionHistory && stats.compactionHistory.length > 0) {
      const history = this.renderCompactionHistory(stats);
      lines.push(history);
    }

    return lines.join('\n');
  }

  /**
   * 渲染 JSON 格式统计
   *
   * @param stats - Context 统计数据
   * @returns JSON 字符串
   */
  private renderStatsJson(stats: ContextStats): string {
    return JSON.stringify(stats, null, 2);
  }

  /**
   * 渲染 Markdown 格式统计
   *
   * @param stats - Context 统计数据
   * @returns Markdown 字符串
   */
  private renderStatsMarkdown(stats: ContextStats): string {
    const lines: string[] = [];

    // 标题
    lines.push('# Context 使用统计');
    lines.push('');

    // 基本信息
    lines.push('## 基本信息');
    lines.push('');
    lines.push(`- **会话 ID**: ${stats.sessionId}`);
    lines.push(`- **Context Window**: ${this.formatNumber(stats.contextWindow)} tokens`);
    lines.push(`- **当前使用**: ${this.formatNumber(stats.currentUsage)} tokens`);
    lines.push(`- **使用率**: ${(stats.usageRatio * 100).toFixed(1)}%`);
    lines.push('');

    // 消息分布
    if (this.config.showDetails) {
      lines.push('## 消息分布');
      lines.push('');
      lines.push('| 类型 | 数量 |');
      lines.push('|------|------|');
      lines.push(`| 用户消息 | ${stats.messageDistribution.userMessages} |`);
      lines.push(`| 助手消息 | ${stats.messageDistribution.assistantMessages} |`);
      lines.push(`| 工具调用 | ${stats.messageDistribution.toolCalls} |`);
      lines.push(`| 工具结果 | ${stats.messageDistribution.toolResults} |`);
      lines.push(`| 摘要 | ${stats.messageDistribution.summaries} |`);
      lines.push(`| **总计** | **${stats.messageDistribution.totalMessages}** |`);
      lines.push('');
    }

    // 性能指标
    if (this.config.showDetails) {
      lines.push('## 性能指标');
      lines.push('');
      lines.push(`- **平均 tokens/轮**: ${this.formatNumber(stats.performanceMetrics.averageTokensPerTurn)}`);
      lines.push(`- **最大 tokens/轮**: ${this.formatNumber(stats.performanceMetrics.maxTokensPerTurn)}`);
      lines.push(`- **最小 tokens/轮**: ${this.formatNumber(stats.performanceMetrics.minTokensPerTurn)}`);
      lines.push(`- **压缩频率**: 每 ${stats.performanceMetrics.compressionFrequency.toFixed(1)} 轮`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 渲染 HTML 格式统计
   *
   * @param stats - Context 统计数据
   * @returns HTML 字符串
   */
  private renderStatsHtml(stats: ContextStats): string {
    const percentage = (stats.usageRatio * 100).toFixed(1);
    const barColor = this.getUsageColor(stats.usageRatio);

    return `
<div class="context-stats">
  <h2>📊 Context 使用统计</h2>

  <div class="info">
    <p><strong>会话 ID:</strong> ${stats.sessionId}</p>
    <p><strong>Context Window:</strong> ${this.formatNumber(stats.contextWindow)} tokens</p>
    <p><strong>当前使用:</strong> ${this.formatNumber(stats.currentUsage)} tokens</p>
  </div>

  <div class="progress-container">
    <div class="progress-bar" style="width: ${percentage}%; background-color: ${barColor};">
      ${percentage}%
    </div>
  </div>

  <div class="distribution">
    <h3>消息分布</h3>
    <ul>
      <li>用户消息: ${stats.messageDistribution.userMessages}</li>
      <li>助手消息: ${stats.messageDistribution.assistantMessages}</li>
      <li>工具调用: ${stats.messageDistribution.toolCalls}</li>
      <li>工具结果: ${stats.messageDistribution.toolResults}</li>
      <li>摘要: ${stats.messageDistribution.summaries}</li>
    </ul>
  </div>

  <div class="performance">
    <h3>性能指标</h3>
    <ul>
      <li>平均 tokens/轮: ${this.formatNumber(stats.performanceMetrics.averageTokensPerTurn)}</li>
      <li>最大 tokens/轮: ${this.formatNumber(stats.performanceMetrics.maxTokensPerTurn)}</li>
      <li>最小 tokens/轮: ${this.formatNumber(stats.performanceMetrics.minTokensPerTurn)}</li>
      <li>压缩频率: 每 ${stats.performanceMetrics.compressionFrequency.toFixed(1)} 轮</li>
    </ul>
  </div>
</div>
`;
  }

  /**
   * 渲染 token 进度条
   *
   * @param stats - Context 统计数据
   * @returns 进度条字符串
   */
  renderTokenProgress(stats: ContextStats): string {
    const percentage = stats.usageRatio * 100;
    const barLength = this.config.progressBarLength;
    const filledLength = Math.round((stats.usageRatio * barLength));
    const emptyLength = barLength - filledLength;

    const filled = '█'.repeat(filledLength);
    const empty = '░'.repeat(emptyLength);

    const color = this.getUsageColor(stats.usageRatio);
    const colorStart = this.config.enableColors ? color : '';
    const colorEnd = this.config.enableColors ? COLORS.reset : '';

    return `使用率: ${colorStart}[${filled}${empty}]${colorEnd} ${percentage.toFixed(1)}% (${this.formatNumber(stats.currentUsage)} / ${this.formatNumber(stats.contextWindow)})`;
  }

  /**
   * 渲染消息分布
   *
   * @param distribution - 消息分布
   * @returns 渲染后的字符串
   */
  renderMessageDistribution(distribution: MessageDistribution): string {
    const lines: string[] = [];

    lines.push(this.colorize('消息分布:', 'bold'));
    lines.push(`  用户消息: ${distribution.userMessages}`);
    lines.push(`  助手消息: ${distribution.assistantMessages}`);
    lines.push(`  工具调用: ${distribution.toolCalls}`);
    lines.push(`  工具结果: ${distribution.toolResults}`);
    lines.push(`  摘要: ${distribution.summaries}`);
    lines.push(`  总计: ${distribution.totalMessages}`);

    return lines.join('\n');
  }

  /**
   * 渲染性能指标
   *
   * @param metrics - 性能指标
   * @returns 渲染后的字符串
   */
  renderPerformanceMetrics(metrics: PerformanceMetrics): string {
    const lines: string[] = [];

    lines.push(this.colorize('性能指标:', 'bold'));
    lines.push(`  平均 tokens/轮: ${this.formatNumber(metrics.averageTokensPerTurn)}`);
    lines.push(`  最大 tokens/轮: ${this.formatNumber(metrics.maxTokensPerTurn)}`);
    lines.push(`  最小 tokens/轮: ${this.formatNumber(metrics.minTokensPerTurn)}`);
    lines.push(`  压缩频率: 每 ${metrics.compressionFrequency.toFixed(1)} 轮`);
    lines.push(`  平均压缩节省: ${this.formatNumber(metrics.averageTokensSavedPerCompression)} tokens`);

    return lines.join('\n');
  }

  /**
   * 渲染压缩历史
   *
   * @param stats - Context 统计数据
   * @returns 渲染后的字符串
   */
  renderCompactionHistory(stats: ContextStats): string {
    const lines: string[] = [];

    lines.push(this.colorize('压缩历史:', 'bold'));

    const history = stats.compactionHistory.slice(-this.config.compactionHistoryLimit);

    if (history.length === 0) {
      lines.push('  暂无压缩记录');
    } else {
      for (const entry of history) {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        const reason = this.getCompactionReasonText(entry.reason);
        lines.push(`  ${time} - ${reason}: 移除 ${entry.removedCount} 条消息, 节省 ${this.formatNumber(entry.tokensSaved)} tokens`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 渲染使用趋势图（文本格式）
   *
   * @param history - 使用历史
   * @param width - 图表宽度
   * @returns 渲染后的字符串
   */
  renderUsageTrend(history: UsageHistoryEntry[], width: number = 60): string {
    if (history.length === 0) {
      return '暂无使用历史';
    }

    const lines: string[] = [];

    lines.push(this.colorize('Token 使用趋势:', 'bold'));

    // 计算最大值
    const maxTokens = Math.max(...history.map(h => h.totalTokens));
    const chartHeight = 10;

    // 创建图表
    const chart: string[][] = [];
    for (let i = 0; i < chartHeight; i++) {
      chart.push(new Array(width).fill(' '));
    }

    // 填充图表
    for (let i = 0; i < history.length && i < width; i++) {
      const entry = history[i];
      const normalizedHeight = Math.round((entry.totalTokens / maxTokens) * (chartHeight - 1));

      for (let j = 0; j <= normalizedHeight; j++) {
        chart[chartHeight - 1 - j][i] = '█';
      }
    }

    // 渲染图表
    for (const row of chart) {
      lines.push('  ' + row.join(''));
    }

    // X 轴标签
    lines.push('  ' + '─'.repeat(width));
    lines.push(`  0${' '.repeat(width - 10)}${history.length}`);

    return lines.join('\n');
  }

  /**
   * 渲染状态卡片
   *
   * @param stats - Context 统计数据
   * @returns 状态卡片
   */
  getStatusCards(stats: ContextStats): StatusCard[] {
    return [
      {
        title: 'Context 使用率',
        currentValue: stats.currentUsage,
        maxValue: stats.contextWindow,
        unit: 'tokens',
        color: this.getUsageColorEnum(stats.usageRatio),
        progressBar: this.renderTokenProgress(stats),
        percentage: stats.usageRatio * 100,
      },
      {
        title: '总消息数',
        currentValue: stats.messageDistribution.totalMessages,
        maxValue: Infinity,
        unit: '条',
        color: 'green',
        progressBar: '',
        percentage: 100,
      },
      {
        title: '压缩次数',
        currentValue: stats.compactionHistory.length,
        maxValue: Infinity,
        unit: '次',
        color: 'gray',
        progressBar: '',
        percentage: 100,
      },
    ];
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  /**
   * 格式化数字
   *
   * @param num - 数字
   * @returns 格式化后的字符串
   */
  private formatNumber(num: number): string {
    return num.toLocaleString();
  }

  /**
   * 添加颜色
   *
   * @param text - 文本
   * @param color - 颜色类型
   * @returns 带颜色的文本
   */
  private colorize(text: string, color: keyof typeof COLORS): string {
    if (!this.config.enableColors) {
      return text;
    }
    return `${COLORS[color]}${text}${COLORS.reset}`;
  }

  /**
   * 获取使用率颜色
   *
   * @param ratio - 使用率
   * @returns 颜色代码
   */
  private getUsageColor(ratio: number): string {
    if (ratio < 0.5) {
      return COLORS.green;
    } else if (ratio < 0.8) {
      return COLORS.yellow;
    } else {
      return COLORS.red;
    }
  }

  /**
   * 获取使用率颜色枚举
   *
   * @param ratio - 使用率
   * @returns 颜色枚举
   */
  private getUsageColorEnum(ratio: number): 'green' | 'yellow' | 'red' {
    if (ratio < 0.5) {
      return 'green';
    } else if (ratio < 0.8) {
      return 'yellow';
    } else {
      return 'red';
    }
  }

  /**
   * 获取压缩原因文本
   *
   * @param reason - 压缩原因
   * @returns 原因文本
   */
  private getCompactionReasonText(reason: string): string {
    switch (reason) {
      case 'threshold':
        return '阈值压缩';
      case 'summarization':
        return '摘要压缩';
      case 'manual':
        return '手动压缩';
      default:
        return '未知原因';
    }
  }
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 创建 Context 可视化渲染器
 *
 * @param config - 配置
 * @returns ContextVisualizer 实例
 */
export function createContextVisualizer(
  config?: Partial<VisualizerConfig>
): ContextVisualizer {
  return new ContextVisualizer(config);
}
