# 多 Agent 使用指南

本指南介绍 wasteland 的多 Agent 协作功能。

## 概述

wasteland 采用 **Agents-as-Tools** 模式实现多 Agent 编排：

- 主 Agent (Immortan Joe) 负责任务分析和调度
- 子 Agent 负责执行具体任务
- 通过 `spawn-agent` 工具创建和管理子 Agent

## 架构图

```
用户
  ↓
主 Agent (Immortan Joe)
  ↓
┌─────────────────────────────────────┐
│  spawn_agent                        │
│  ↓                                  │
│  子 Agent 1 (researcher)            │
│  子 Agent 2 (developer)             │
│  子 Agent 3 (analyst)               │
│  子 Agent 4 (tester)                │
└─────────────────────────────────────┘
  ↓
结果汇总
```

## 内置子 Agent

| 子 Agent | 职责 | 可用工具 |
|----------|------|----------|
| `researcher` | 信息收集 | read-file, glob, grep, list-directory, web-fetch |
| `developer` | 代码开发 | bash, read-file, edit-file, write-file, grep, glob |
| `analyst` | 系统分析 | read-file, glob, grep, list-directory |
| `tester` | 测试验证 | bash, read-file |

## 使用方法

### 自动调度

主 Agent 会根据任务自动决定是否需要创建子 Agent：

```bash
# 自动创建子 Agent 分析代码
wasteland chat --provider jdcloud --message "分析这个项目的架构"
```

### 显式创建

也可以显式要求创建子 Agent：

```bash
# 创建 researcher 子 Agent
wasteland chat --provider jdcloud --message "创建一个 researcher 子 Agent 来搜索信息"

# 创建 developer 子 Agent
wasteland chat --provider jdcloud --message "创建一个 developer 子 Agent 来编写代码"
```

### 并行执行

主 Agent 可以同时创建多个子 Agent 并行执行任务：

```bash
# 并行执行多个任务
wasteland chat --provider jdcloud --message "同时执行：1. 读取 README.md 2. 列出目录结构 3. 分析 package.json"
```

## spawn-agent 工具

### 参数

```typescript
spawn_agent({
  name: string;      // 子 Agent 名称
  task: string;      // 任务描述
  model?: string;    // 模型选择（可选）
  tools?: string[];  // 工具列表（可选）
})
```

### 示例

```bash
# 基础使用
wasteland chat --provider jdcloud --message "spawn_agent researcher 搜索 RxJS 最佳实践"

# 指定工具
wasteland chat --provider jdcloud --message "spawn_agent developer 编写测试，只使用 bash 和 read-file 工具"
```

## 配置子 Agent

在 `.wasteland/settings.json` 中配置子 Agent：

```json
{
  "subAgents": {
    "researcher": {
      "model": "worker_model",
      "promptTemplate": "role-worker",
      "description": "信息收集与研究",
      "promptVariables": {
        "role": "信息收集专家",
        "goal": "搜索、发现、检索信息和资源",
        "tools": "read-file, glob, grep, list-directory, web-fetch"
      }
    }
  }
}
```

## 工作流程

### 1. 任务分析

主 Agent 分析用户请求，决定是否需要子 Agent：

```
用户: "分析这个项目的架构"
  ↓
主 Agent: 需要分析代码结构 → 创建 analyst 子 Agent
```

### 2. 子 Agent 创建

主 Agent 通过 `spawn-agent` 工具创建子 Agent：

```
主 Agent 调用 spawn_agent({
  name: "project-analyzer",
  task: "分析项目架构"
})
```

### 3. 任务执行

子 Agent 独立执行任务，使用指定的工具：

```
子 Agent:
  - read-file package.json
  - list-directory src
  - grep "export" src/**/*.ts
```

### 4. 结果返回

子 Agent 完成任务后，结果返回给主 Agent：

```
子 Agent 返回: "项目使用 TypeScript，基于 RxJS..."
```

### 5. 结果汇总

主 Agent 汇总所有子 Agent 的结果，形成最终响应：

```
主 Agent: "根据分析，这个项目..."
```

## 高级用法

### 串行执行

主 Agent 可以按顺序执行多个子 Agent：

```bash
wasteland chat --provider jdcloud --message "先创建 researcher 搜索信息，然后创建 developer 编写代码"
```

### 条件执行

主 Agent 可以根据前一个子 Agent 的结果决定下一步：

```bash
wasteland chat --provider jdcloud --message "先分析代码，如果有问题就修复，然后运行测试"
```

### 错误处理

子 Agent 执行失败时，主 Agent 会尝试恢复：

```bash
wasteland chat --provider jdcloud --message "如果分析失败，就列出目录结构作为备选方案"
```

## Session 管理

每个子 Agent 都有独立的 Session：

- 主 Agent: `.wasteland/sessions/{sessionId}.jsonl`
- 子 Agent: `.wasteland/sessions/{sessionId}-child-{name}.jsonl`

```bash
# 查看所有 session（包括子 Agent）
wasteland sessions

# 查看特定 session
wasteland sessions show <session-id>
```

## 性能优化

### 并行执行

对于独立任务，主 Agent 会自动并行执行子 Agent：

```
任务 A ──→ 子 Agent 1 ──→ 结果 A
任务 B ──→ 子 Agent 2 ──→ 结果 B
任务 C ──→ 子 Agent 3 ──→ 结果 C
                    ↓
              主 Agent 汇总
```

### 工具限制

可以通过 `tools` 参数限制子 Agent 的工具集，提高安全性：

```bash
wasteland chat --provider jdcloud --message "创建只读子 Agent，只使用 read-file 和 grep"
```

## 故障排除

### 子 Agent 超时

```
Error: Child agent timeout
```

**解决方案**:
1. 增加 `childAgentTimeout` 配置
2. 简化任务描述
3. 使用更强的模型

### 子 Agent 工具执行失败

```
Error: Tool execution failed
```

**解决方案**:
1. 检查工具参数
2. 检查文件权限
3. 使用 `--permission-mode bypass_permissions`

### 子 Agent 无法创建

```
Error: Failed to spawn agent
```

**解决方案**:
1. 检查 provider 是否支持 spawn_agent
2. 检查 API 配额
3. 检查网络连接

## 最佳实践

1. **任务描述清晰**: 提供详细的任务描述，帮助主 Agent 正确调度
2. **合理分工**: 将复杂任务拆分为多个子任务
3. **工具限制**: 对只读任务限制子 Agent 的工具集
4. **错误处理**: 为关键任务提供备选方案
5. **监控进度**: 使用 `wasteland sessions` 查看执行进度
