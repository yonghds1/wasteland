# Memory 提取策略设计文档

## 概述

本文档定义了 wasteland 项目中从对话中自动提取关键信息并更新 memory.md 的策略。

## 目标

1. **自动化**: 无需手动维护 memory.md
2. **智能化**: 自动识别和提取有价值的信息
3. **增量式**: 只提取新信息，避免重复
4. **可追溯**: 记录提取来源和置信度

## 提取内容类型

### 1. 用户偏好 (user_preference)

用户在对话中表现出的偏好和习惯。

**示例**:
- "我喜欢使用 TypeScript 而不是 JavaScript"
- "我偏好函数式编程风格"
- "我喜欢使用 Tailwind CSS"
- "我习惯使用 VS Code"

**提取规则**:
- 用户明确表达的偏好
- 用户重复提及的习惯
- 用户对特定工具/技术的选择

### 2. 项目知识 (project_knowledge)

关于项目的技术栈、架构、约定等知识。

**示例**:
- "这个项目使用 React + TypeScript"
- "数据库使用 PostgreSQL"
- "部署在 AWS ECS 上"
- "使用 ESLint + Prettier 代码规范"

**提取规则**:
- 用户描述的项目技术栈
- 用户提到的架构决策
- 用户说明的项目约定

### 3. 决策记录 (decision)

用户做出的重要决策和原因。

**示例**:
- "我们选择使用 Redis 而不是 Memcached，因为需要数据持久化"
- "我们决定使用微服务架构，因为需要独立部署"
- "我们选择使用 Jest 而不是 Mocha，因为配置更简单"

**提取规则**:
- 用户明确说明的决策
- 用户解释的决策原因
- 用户比较后的选择

### 4. 代码规范 (code_convention)

用户遵循的代码规范和最佳实践。

**示例**:
- "我们使用 camelCase 命名变量"
- "我们使用 2 空格缩进"
- "我们为所有函数编写 JSDoc 注释"
- "我们使用 async/await 而不是 Promise"

**提取规则**:
- 用户明确说明的规范
- 用户在代码中展示的模式
- 用户纠正的代码风格

### 5. 错误模式 (error_pattern)

用户遇到的错误和解决方案。

**示例**:
- "TypeScript 错误 TS2322 通常是类型不匹配"
- "React useEffect 需要添加依赖数组"
- "Node.js 内存溢出需要增加 --max-old-space-size"

**提取规则**:
- 用户遇到的错误信息
- 用户采用的解决方案
- 用户总结的经验教训

## 提取时机和频率

### 时机

1. **对话结束时**: 用户主动结束对话时
2. **达到轮次阈值**: 每 N 轮对话后
3. **检测到关键信息**: LLM 检测到可能有价值的信息时
4. **用户显式请求**: 用户说"记住这个"或"保存这个"

### 频率策略

```typescript
interface ExtractionFrequency {
  /** 基础轮次间隔 */
  baseInterval: number;  // 默认: 10 轮
  /** 最小间隔（防止频繁提取） */
  minInterval: number;   // 默认: 5 轮
  /** 最大间隔（防止遗漏） */
  maxInterval: number;   // 默认: 20 轮
  /** 是否在对话结束时提取 */
  extractOnEnd: boolean; // 默认: true
}
```

### 自适应频率

根据对话内容动态调整提取频率：

- **高信息密度对话**: 缩短间隔（如技术讨论、决策讨论）
- **低信息密度对话**: 延长间隔（如闲聊、简单问答）
- **关键信息出现**: 立即触发提取

## 合并策略

### 1. 去重

**规则**: 相同类型、相同内容的信息不重复提取。

**实现**:
```typescript
function isDuplicate(existing: MemoryExtract, newExtract: MemoryExtract): boolean {
  // 类型不同，不重复
  if (existing.type !== newExtract.type) return false;

  // 内容相似度检查
  const similarity = calculateSimilarity(existing.content, newExtract.content);
  return similarity > 0.8; // 阈值: 80%
}
```

### 2. 冲突解决

当新旧信息冲突时：

**规则**:
- **用户偏好**: 新信息覆盖旧信息（用户偏好可能改变）
- **项目知识**: 保留最新信息（项目可能演进）
- **决策记录**: 保留所有决策（历史记录）
- **代码规范**: 新信息覆盖旧规范（规范可能更新）
- **错误模式**: 保留所有错误模式（不同场景可能不同）

**实现**:
```typescript
function resolveConflict(
  existing: MemoryExtract,
  newExtract: MemoryExtract
): MemoryExtract | null {
  switch (newExtract.type) {
    case 'user_preference':
    case 'code_convention':
      // 新信息覆盖旧信息
      return newExtract;

    case 'project_knowledge':
      // 保留最新信息
      return newExtract;

    case 'decision':
    case 'error_pattern':
      // 保留所有
      return null; // 表示不冲突，都保留

    default:
      return newExtract;
  }
}
```

### 3. 合并策略

**memory.md 格式**:

```markdown
# 项目记忆

## 用户偏好
- 偏好使用 TypeScript
- 偏好函数式编程风格
- 喜欢使用 Tailwind CSS

## 项目知识
- 技术栈: React + TypeScript + Node.js
- 数据库: PostgreSQL
- 部署: AWS ECS

## 决策记录
- [2026-08-08] 选择 Redis 而不是 Memcached，因为需要数据持久化
- [2026-08-08] 选择微服务架构，因为需要独立部署

## 代码规范
- 使用 camelCase 命名变量
- 使用 2 空格缩进
- 为所有函数编写 JSDoc 注释

## 错误模式
- TypeScript TS2322: 类型不匹配
- React useEffect: 需要添加依赖数组
- Node.js 内存溢出: 增加 --max-old-space-size
```

### 4. 置信度评估

每个提取的信息都有置信度分数：

```typescript
interface MemoryExtract {
  type: ExtractType;
  content: string;
  confidence: number; // 0-1
  source_turn: number;
  context?: string;
}
```

**置信度规则**:
- **高置信度 (0.8-1.0)**: 用户明确表达的偏好、决策
- **中置信度 (0.5-0.8)**: 用户暗示的偏好、推断的知识
- **低置信度 (0.0-0.5)**: 模糊的表达、不确定的信息

**阈值**: 只有置信度 > 0.5 的信息才会被合并到 memory.md

## 提取 Prompt 设计

### 基础 Prompt

```
你是一个信息提取专家。请从以下对话中提取关键信息。

对话内容:
{conversation}

请提取以下类型的信息:
1. 用户偏好 (user_preference): 用户表现出的偏好和习惯
2. 项目知识 (project_knowledge): 关于项目的技术栈、架构等知识
3. 决策记录 (decision): 用户做出的重要决策
4. 代码规范 (code_convention): 用户遵循的代码规范
5. 错误模式 (error_pattern): 用户遇到的错误和解决方案

对于每条提取的信息，请提供:
- 类型 (type)
- 内容 (content)
- 置信度 (confidence, 0-1)
- 上下文 (context, 可选)

请以 JSON 格式输出。
```

### 增量提取 Prompt

```
你是一个信息提取专家。请从以下对话片段中提取新的关键信息。

已有的记忆:
{existing_memory}

新的对话片段:
{new_conversation}

请只提取对话片段中新的、尚未在已有记忆中记录的信息。

对于每条提取的信息，请提供:
- 类型 (type)
- 内容 (content)
- 置信度 (confidence, 0-1)
- 上下文 (context, 可选)

请以 JSON 格式输出。如果没有新的信息，请返回空数组。
```

## 实现架构

### 组件

1. **MemoryExtractor**: 从对话中提取信息
2. **MemoryMerger**: 合并提取的信息到 memory.md
3. **MemoryTrigger**: 触发提取的时机控制
4. **MemoryStorage**: 持久化存储提取的信息

### 数据流

```
对话 → MemoryTrigger → MemoryExtractor → MemoryMerger → memory.md
                          ↓
                    提取信息 JSON
                          ↓
                    MemoryStorage
```

### 存储位置

```
~/.wasteland/memory/
├── extracts.json          # 提取的信息
├── history.json           # 提取历史
└── stats.json             # 提取统计
```

## 性能优化

### 1. 增量提取

只对新的对话内容进行提取，避免重复处理整个对话历史。

### 2. 缓存

缓存已提取的信息，避免重复提取相同内容。

### 3. 异步处理

提取过程异步执行，不阻塞主对话流程。

### 4. 批量处理

多个提取任务批量处理，减少 LLM 调用次数。

## 错误处理

### 1. 提取失败

- 记录错误日志
- 重试机制（最多 3 次）
- 降级策略：跳过本次提取

### 2. 合并失败

- 保留原始 memory.md
- 记录冲突信息
- 人工干预机制

### 3. 存储失败

- 本地缓存
- 重试机制
- 错误恢复

## 监控和日志

### 监控指标

- 提取频率
- 提取成功率
- 提取置信度分布
- 合并冲突率

### 日志记录

```typescript
interface ExtractionLog {
  timestamp: string;
  sessionId: string;
  turnCount: number;
  extractedCount: number;
  mergedCount: number;
  conflictCount: number;
  duration: number;
  success: boolean;
  error?: string;
}
```

## 总结

本设计文档定义了 wasteland 项目中 Memory 提取的完整策略，包括：

1. **提取内容类型**: 5 种类型，覆盖用户偏好、项目知识、决策、规范、错误模式
2. **提取时机**: 多种触发条件，支持自适应频率
3. **合并策略**: 去重、冲突解决、格式化存储
4. **置信度评估**: 量化提取信息的可靠性
5. **实现架构**: 清晰的组件划分和数据流
6. **性能优化**: 增量提取、缓存、异步处理
7. **错误处理**: 完善的失败恢复机制

这个策略将帮助 wasteland 自动学习和记忆用户的知识，提供更个性化的体验。
