# Context 统计数据结构设计文档

## 概述

本文档定义了 wasteland 项目中 Context 使用统计的数据结构、存储格式和展示方式。

## 目标

1. **实时监控**: 跟踪 context window 的使用情况
2. **历史分析**: 记录 token 使用趋势
3. **可视化展示**: 以图表形式展示统计数据
4. **性能优化**: 高效的数据收集和存储

## 统计数据 Schema

### 核心统计

```typescript
interface ContextStats {
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
}
```

### 详细统计

```typescript
interface DetailedContextStats extends ContextStats {
  /** Token 使用历史 */
  usageHistory: UsageHistoryEntry[];
  
  /** 压缩历史 */
  compactionHistory: CompactionHistoryEntry[];
  
  /** 消息分布 */
  messageDistribution: MessageDistribution;
  
  /** 性能指标 */
  performanceMetrics: PerformanceMetrics;
}
```

### 使用历史

```typescript
interface UsageHistoryEntry {
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
```

### 压缩历史

```typescript
interface CompactionHistoryEntry {
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
```

### 消息分布

```typescript
interface MessageDistribution {
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
```

### 性能指标

```typescript
interface PerformanceMetrics {
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
```

## 存储格式

### 文件结构

```
~/.wasteland/sessions/<session-id>/
├── context-stats.json      # Context 统计数据
└── ...
```

### JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string"
    },
    "contextWindow": {
      "type": "integer",
      "minimum": 1
    },
    "currentUsage": {
      "type": "integer",
      "minimum": 0
    },
    "usageRatio": {
      "type": "number",
      "minimum": 0,
      "maximum": 1
    },
    "timestamp": {
      "type": "string",
      "format": "date-time"
    },
    "usageHistory": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "turn": { "type": "integer" },
          "timestamp": { "type": "string", "format": "date-time" },
          "promptTokens": { "type": "integer" },
          "completionTokens": { "type": "integer" },
          "totalTokens": { "type": "integer" },
          "cachedTokens": { "type": "integer" },
          "usageRatio": { "type": "number" }
        },
        "required": ["turn", "timestamp", "totalTokens", "usageRatio"]
      }
    },
    "compactionHistory": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "timestamp": { "type": "string", "format": "date-time" },
          "removedCount": { "type": "integer" },
          "tokensSaved": { "type": "integer" },
          "reason": { 
            "type": "string",
            "enum": ["threshold", "summarization", "manual"]
          },
          "usageRatioBefore": { "type": "number" },
          "usageRatioAfter": { "type": "number" }
        },
        "required": ["timestamp", "removedCount", "tokensSaved", "reason"]
      }
    },
    "messageDistribution": {
      "type": "object",
      "properties": {
        "userMessages": { "type": "integer" },
        "assistantMessages": { "type": "integer" },
        "toolCalls": { "type": "integer" },
        "toolResults": { "type": "integer" },
        "summaries": { "type": "integer" },
        "totalMessages": { "type": "integer" }
      }
    },
    "performanceMetrics": {
      "type": "object",
      "properties": {
        "averageTokensPerTurn": { "type": "number" },
        "maxTokensPerTurn": { "type": "integer" },
        "minTokensPerTurn": { "type": "integer" },
        "compressionFrequency": { "type": "number" },
        "averageTokensSavedPerCompression": { "type": "number" }
      }
    }
  },
  "required": ["sessionId", "contextWindow", "currentUsage", "usageRatio", "timestamp"]
}
```

## 展示方式

### 1. 文本表格

```
📊 Context 使用统计

会话 ID: 20260808-143052-a3b8c9d0
Context Window: 128,000 tokens
当前使用: 45,230 tokens (35.3%)

消息分布:
  用户消息: 15
  助手消息: 12
  工具调用: 8
  工具结果: 8
  摘要: 2

性能指标:
  平均 tokens/轮: 3,456
  最大 tokens/轮: 8,901
  压缩频率: 每 10 轮

压缩历史:
  2026-08-08 14:30 - 移除 12 条消息, 节省 45,000 tokens
  2026-08-08 14:45 - 移除 8 条消息, 节省 32,000 tokens
```

### 2. 进度条

```
Context 使用率: [████████░░░░░░░░░░░░] 35.3% (45,230 / 128,000)
```

### 3. 图表

#### 使用趋势图

```
Token 使用量趋势

128,000 ┤
        │
 96,000 ┤                    ╭──╮
        │               ╭───╯  ╰──╮
 64,000 ┤          ╭───╯          ╰──╮
        │     ╭───╯                  ╰──╮
 32,000 ┤╭───╯                          ╰──
        │
      0 ┼──────────────────────────────────
        0    5    10   15   20   25   30
                    轮次
```

#### 压缩事件图

```
压缩事件

轮次 5: ████████████████████ 节省 45,000 tokens
轮次 15: ████████████ 节省 32,000 tokens
轮次 25: ████████████████████████ 节省 52,000 tokens
```

### 4. 交互式仪表盘

```typescript
interface Dashboard {
  /** 当前状态卡片 */
  currentStatus: {
    usageRatio: number;
    usageBar: string;
    tokenCount: string;
  };
  
  /** 使用趋势图 */
  usageTrend: {
    type: 'line' | 'area';
    data: UsageHistoryEntry[];
  };
  
  /** 消息分布饼图 */
  messageDistribution: {
    type: 'pie';
    data: MessageDistribution;
  };
  
  /** 压缩历史时间线 */
  compactionTimeline: {
    type: 'timeline';
    data: CompactionHistoryEntry[];
  };
}
```

## 数据收集

### 收集时机

1. **每轮对话后**: 更新当前使用量
2. **压缩前后**: 记录压缩事件
3. **会话结束时**: 保存最终统计

### 收集方法

```typescript
interface StatsCollector {
  /** 报告 token 使用量 */
  reportUsage(usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens?: number;
  }): void;
  
  /** 报告压缩事件 */
  reportCompaction(event: {
    removedCount: number;
    tokensSaved: number;
    reason: string;
  }): void;
  
  /** 获取当前统计 */
  getStats(): ContextStats;
  
  /** 获取详细统计 */
  getDetailedStats(): DetailedContextStats;
}
```

## 性能优化

### 1. 增量更新

- 只保存变更的部分
- 使用差异更新减少 I/O

### 2. 缓存

- 缓存计算结果
- 定期刷新缓存

### 3. 批量写入

- 合并多次更新
- 异步写入磁盘

### 4. 数据压缩

- 压缩历史数据
- 归档旧数据

## 可视化组件

### 1. 状态卡片

```typescript
interface StatusCard {
  /** 标题 */
  title: string;
  
  /** 当前值 */
  currentValue: number;
  
  /** 最大值 */
  maxValue: number;
  
  /** 单位 */
  unit: string;
  
  /** 颜色编码 */
  color: 'green' | 'yellow' | 'red';
  
  /** 进度条 */
  progressBar: string;
}
```

### 2. 趋势图

```typescript
interface TrendChart {
  /** 图表类型 */
  type: 'line' | 'area' | 'bar';
  
  /** X 轴数据 */
  xData: number[];
  
  /** Y 轴数据 */
  yData: number[];
  
  /** 标签 */
  labels: string[];
  
  /** 颜色 */
  color: string;
  
  /** 是否显示网格 */
  showGrid: boolean;
}
```

### 3. 分布图

```typescript
interface DistributionChart {
  /** 图表类型 */
  type: 'pie' | 'donut' | 'bar';
  
  /** 数据 */
  data: {
    label: string;
    value: number;
    color: string;
  }[];
  
  /** 是否显示百分比 */
  showPercentage: boolean;
}
```

## 示例实现

### 收集统计

```typescript
class ContextStatsCollector implements StatsCollector {
  private stats: DetailedContextStats;
  private historyFile: string;

  constructor(sessionId: string, contextWindow: number) {
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

    this.historyFile = join(
      homedir(),
      '.wasteland',
      'sessions',
      sessionId,
      'context-stats.json'
    );
  }

  reportUsage(usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens?: number;
  }): void {
    // 更新当前使用量
    this.stats.currentUsage = usage.totalTokens;
    this.stats.usageRatio = usage.totalTokens / this.stats.contextWindow;
    this.stats.timestamp = new Date().toISOString();

    // 添加历史记录
    const turn = this.stats.usageHistory.length + 1;
    this.stats.usageHistory.push({
      turn,
      timestamp: new Date().toISOString(),
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      cachedTokens: usage.cachedTokens,
      usageRatio: this.stats.usageRatio,
    });

    // 更新性能指标
    this.updatePerformanceMetrics(usage.totalTokens);
  }

  reportCompaction(event: {
    removedCount: number;
    tokensSaved: number;
    reason: string;
  }): void {
    const usageRatioBefore = this.stats.usageRatio;
    
    // 更新使用量
    this.stats.currentUsage = Math.max(
      0,
      this.stats.currentUsage - event.tokensSaved
    );
    this.stats.usageRatio = this.stats.currentUsage / this.stats.contextWindow;

    // 添加压缩历史
    this.stats.compactionHistory.push({
      timestamp: new Date().toISOString(),
      removedCount: event.removedCount,
      tokensSaved: event.tokensSaved,
      reason: event.reason as any,
      usageRatioBefore,
      usageRatioAfter: this.stats.usageRatio,
    });

    // 更新压缩频率
    this.updateCompressionFrequency();
  }

  private updatePerformanceMetrics(totalTokens: number): void {
    const history = this.stats.usageHistory;
    const count = history.length;

    // 更新最大最小值
    this.stats.performanceMetrics.maxTokensPerTurn = Math.max(
      this.stats.performanceMetrics.maxTokensPerTurn,
      totalTokens
    );
    this.stats.performanceMetrics.minTokensPerTurn = Math.min(
      this.stats.performanceMetrics.minTokensPerTurn,
      totalTokens
    );

    // 计算平均值
    const total = history.reduce((sum, h) => sum + h.totalTokens, 0);
    this.stats.performanceMetrics.averageTokensPerTurn = total / count;
  }

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

  getStats(): ContextStats {
    return {
      sessionId: this.stats.sessionId,
      contextWindow: this.stats.contextWindow,
      currentUsage: this.stats.currentUsage,
      usageRatio: this.stats.usageRatio,
      timestamp: this.stats.timestamp,
    };
  }

  getDetailedStats(): DetailedContextStats {
    return { ...this.stats };
  }
}
```

### 展示统计

```typescript
function renderContextStats(stats: DetailedContextStats): string {
  const lines: string[] = [];

  // 标题
  lines.push('📊 Context 使用统计\n');

  // 基本信息
  lines.push(`会话 ID: ${stats.sessionId}`);
  lines.push(`Context Window: ${stats.contextWindow.toLocaleString()} tokens`);
  lines.push(`当前使用: ${stats.currentUsage.toLocaleString()} tokens (${(stats.usageRatio * 100).toFixed(1)}%)`);
  lines.push('');

  // 使用率进度条
  const barLength = 30;
  const filledLength = Math.round(stats.usageRatio * barLength);
  const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
  lines.push(`使用率: [${bar}] ${(stats.usageRatio * 100).toFixed(1)}%`);
  lines.push('');

  // 消息分布
  lines.push('消息分布:');
  const dist = stats.messageDistribution;
  lines.push(`  用户消息: ${dist.userMessages}`);
  lines.push(`  助手消息: ${dist.assistantMessages}`);
  lines.push(`  工具调用: ${dist.toolCalls}`);
  lines.push(`  工具结果: ${dist.toolResults}`);
  lines.push(`  摘要: ${dist.summaries}`);
  lines.push('');

  // 性能指标
  lines.push('性能指标:');
  const perf = stats.performanceMetrics;
  lines.push(`  平均 tokens/轮: ${perf.averageTokensPerTurn.toLocaleString()}`);
  lines.push(`  最大 tokens/轮: ${perf.maxTokensPerTurn.toLocaleString()}`);
  lines.push(`  最小 tokens/轮: ${perf.minTokensPerTurn.toLocaleString()}`);
  lines.push(`  压缩频率: 每 ${perf.compressionFrequency.toFixed(1)} 轮`);
  lines.push('');

  // 最近压缩历史
  if (stats.compactionHistory.length > 0) {
    lines.push('最近压缩历史:');
    const recent = stats.compactionHistory.slice(-3);
    for (const compaction of recent) {
      const time = new Date(compaction.timestamp).toLocaleTimeString();
      lines.push(`  ${time} - 移除 ${compaction.removedCount} 条消息, 节省 ${compaction.tokensSaved.toLocaleString()} tokens`);
    }
  }

  return lines.join('\n');
}
```

## 总结

本设计文档定义了 wasteland 项目中 Context 统计的完整数据结构，包括：

1. **核心统计**: 基本的使用量和使用率
2. **详细统计**: 历史记录、压缩事件、消息分布、性能指标
3. **存储格式**: JSON Schema 和文件结构
4. **展示方式**: 文本表格、进度条、图表、交互式仪表盘
5. **数据收集**: 收集时机和方法
6. **性能优化**: 增量更新、缓存、批量写入

这个设计支持全面的 context 使用监控和分析。
