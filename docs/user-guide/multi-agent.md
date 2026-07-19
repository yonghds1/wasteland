# 多 Agent 使用指南

本指南介绍 wasteland 的多 Agent 协作功能。

## 概述

wasteland 采用 **Agents-as-Tools** 模式实现多 Agent 编排：

- 主 Agent (Immortan Joe) 负责任务分析和调度
- 子 Agent 负责执行具体任务
- 通过 `spawn_agent` 工具创建和管理子 Agent

多 Agent 调度由主 Agent 自动完成：你在 TUI 中用自然语言提出需求，Immortan Joe 会判断是否需要拆分任务，并通过 `spawn_agent` 工具自动派发子 Agent。无需任何 `--multi` 之类的开关。

## 架构图

```
用户 (TUI 输入)
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

## 启动 TUI

多 Agent 协作在 TUI 中进行。默认无参启动即进入 TUI：

```bash
# 默认启动 TUI
wasteland

# 或显式指定 tui 子命令与选项
wasteland tui --provider jdcloud
wasteland tui -r <role>
wasteland tui --permission-mode bypass_permissions
wasteland tui --attach <session>
```

TUI 选项：

| 选项 | 说明 |
|------|------|
| `-r, --role <name>` | 指定主角色 |
| `-p, --provider <name>` | 指定模型 provider |
| `--permission-mode <mode>` | 权限模式（`default` / `accept_edits` / `bypass_permissions`） |
| `--debug` | 开启调试输出 |
| `--attach <session>` | 附加到已有 session |

进入 TUI 后，直接在输入框用自然语言对话即可。下文示例中 `>` 开头的行表示在 TUI 输入框中输入的内容。

## 使用方法

### 自动调度

主 Agent 会根据任务自动决定是否需要创建子 Agent：

```
> 分析这个项目的架构
```

Immortan Joe 收到请求后，判断需要分析代码结构，自动通过 `spawn_agent` 派发 `analyst` 子 Agent。

### 显式创建

也可以在对话中显式要求创建子 Agent：

```
> 创建一个 researcher 子 Agent 来搜索信息
> 创建一个 developer 子 Agent 来编写代码
```

### 并行执行

主 Agent 可以同时创建多个子 Agent 并行执行任务：

```
> 同时执行：1. 读取 README.md 2. 列出目录结构 3. 分析 package.json
```

## spawn_agent 工具

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

在 TUI 中用自然语言描述即可，主 Agent 会转换成对应的 `spawn_agent` 调用：

```
> 让 researcher 搜索 RxJS 最佳实践
> 让 developer 编写测试，只使用 bash 和 read-file 工具
```

对应的主 Agent 调用形如：

```
spawn_agent({ name: "researcher", task: "搜索 RxJS 最佳实践" })
spawn_agent({ name: "developer", task: "编写测试", tools: ["bash", "read-file"] })
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
> 分析这个项目的架构
  ↓
主 Agent: 需要分析代码结构 -> 创建 analyst 子 Agent
```

### 2. 子 Agent 创建

主 Agent 通过 `spawn_agent` 工具创建子 Agent：

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

```
> 先创建 researcher 搜索信息，然后创建 developer 编写代码
```

### 条件执行

主 Agent 可以根据前一个子 Agent 的结果决定下一步：

```
> 先分析代码，如果有问题就修复，然后运行测试
```

### 错误处理

子 Agent 执行失败时，主 Agent 会尝试恢复：

```
> 如果分析失败，就列出目录结构作为备选方案
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
任务 A ──-> 子 Agent 1 ──-> 结果 A
任务 B ──-> 子 Agent 2 ──-> 结果 B
任务 C ──-> 子 Agent 3 ──-> 结果 C
                    ↓
              主 Agent 汇总
```

### 工具限制

可以通过 `tools` 参数限制子 Agent 的工具集，提高安全性：

```
> 创建只读子 Agent，只使用 read-file 和 grep
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

## 非交互 fallback（chat 命令）

TUI 是唯一主界面。当处于非交互环境（管道、脚本、CI）或无 TTY 时，可使用保留的 `chat` 命令作为 fallback。`chat` 命令已从 `--help` 隐藏，但仍可正常调用。

```bash
# 单次消息
wasteland chat --provider jdcloud --message "分析这个项目的架构"

# 管道输入
echo "分析 package.json" | wasteland chat --provider jdcloud

# 带权限模式（适用于自动化脚本）
wasteland chat --provider jdcloud --message "..." --permission-mode bypass_permissions
```

chat 选项：

| 选项 | 说明 |
|------|------|
| `-m, --message <text>` | 单次消息（非交互） |
| `-p, --provider <name>` | 指定模型 provider |
| `-r, --role <name>` | 指定角色 |
| `--debug` | 开启调试输出 |
| `--debug-format <format>` | 调试输出格式（`pretty` / `jsonl`） |
| `--permission-mode <mode>` | 权限模式 |

chat 模式下，主 Agent 同样会通过 `spawn_agent` 自动调度子 Agent，多 Agent 行为与 TUI 一致；区别仅在于输入输出为非交互式。

## 最佳实践

1. **任务描述清晰**: 提供详细的任务描述，帮助主 Agent 正确调度
2. **合理分工**: 将复杂任务拆分为多个子任务
3. **工具限制**: 对只读任务限制子 Agent 的工具集
4. **错误处理**: 为关键任务提供备选方案
5. **监控进度**: 使用 `wasteland sessions` 查看执行进度
