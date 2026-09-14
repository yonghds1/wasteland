# 多 Agent 使用指南

本指南介绍 wasteland 的多 Agent 协作功能。

## 概述

wasteland 采用 **Agents-as-Tools** 模式实现多 Agent 编排：

- 主 Agent (orchestrator) 负责任务分析和调度
- 子 Agent 负责执行具体任务
- 通过 `spawn_agent` 工具创建和管理子 Agent

多 Agent 调度由主 Agent 自动完成：你在 TUI 中用自然语言提出需求，主 Agent 会判断是否需要拆分任务，并通过 `spawn_agent` 工具自动派发子 Agent。是否注入多角色编排提示词由**运行模式**（`runtime.mode`，`single` / `multi`）控制，详见下文[运行模式](#运行模式single--multi)一节。

## 架构图

```
用户 (TUI 输入)
  ↓
主 Agent (orchestrator)
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
wasteland tui --provider qwen
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
| `--mode <mode>` | 运行模式覆盖（`single` / `multi`，启动时生效） |
| `--debug` | 开启调试输出 |
| `--attach <session>` | 附加到已有 session |

进入 TUI 后，直接在输入框用自然语言对话即可。下文示例中 `>` 开头的行表示在 TUI 输入框中输入的内容。

## 使用方法

### 自动调度

主 Agent 会根据任务自动决定是否需要创建子 Agent：

```
> 分析这个项目的架构
```

主 Agent 收到请求后，判断需要分析代码结构，自动通过 `spawn_agent` 派发 `analyst` 子 Agent。

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

子 Agent 通过**角色（role）与皮肤（skin）解耦引用**配置：

- **角色定义**在 `.wasteland/roles.json`（可复用的完整定义：promptTemplate / model /
  tools / skins 候选列表 / permissionMode 等）。
- **皮肤定义**在 `.wasteland/skins.json`（UI 文案）。
- **`multiAgent` 引用组合**：`.wasteland/settings.json` 的 `multiAgent[name] = { role, skin }`。

加载时把 `role` 引用的角色定义展开合并进 `multiAgent` 条目（条目显式字段优先），
下游消费方拿到完整配置。未提供 `role` 的条目保持内联定义（向后兼容）。

```jsonc
// .wasteland/roles.json — 角色定义
{
  "roles": {
    "researcher": {
      "promptTemplate": "role-worker",
      "description": "信息收集与研究 - 搜索、发现、检索信息和资源",
      "model": "worker_model",
      "tools": "read-file, glob, grep, list-directory, web-fetch",
      "skins": ["scout"]
    },
    "developer": {
      "promptTemplate": "role-worker",
      "description": "代码开发与实现 - 编写、修改、调试代码",
      "skins": ["coder"]
    }
  }
}

// .wasteland/settings.json — 引用组合
{
  "multiAgent": {
    "researcher": { "role": "researcher", "skin": "scout" },
    "developer": { "role": "developer", "skin": "coder" }
  }
}
```

角色定义字段说明（`roles.json` 中）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `promptTemplate` | string | 提示词模板（内置角色 ID 如 `role-worker`，或自定义） |
| `model` | string | 该角色使用的 model（指向 `models` 块的 key） |
| `skins` | string[] | 皮肤候选列表（spawn 时随机取用一个可用） |
| `tools` | string / string[] | 可用工具白名单 |
| `description` | string | 角色描述，用于 multi 模式注入主 Agent 的角色清单与配置页展示 |
| `permissionMode` | string | 该角色的权限模式（可选） |
| `maxRetries` / `retryDelayMs` / `fallbackModel` | - | 失败重试策略（可选） |

`multiAgent[name]` 引用字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `role` | string | 引用 `roles.json` 中的角色定义 |
| `skin` | string | 该实例使用的皮肤（覆盖角色候选） |
| `model` | string | 该实例使用的 model（覆盖角色定义） |

> 内置角色（orchestrator/researcher/developer/analyst/tester）默认定义在代码中，
> 用户 `roles.json` 覆盖；主角色（orchestrator）同样可通过 `multiAgent.main` 引用。

## 运行模式（single / multi）

wasteland 通过 `runtime.mode` 区分两种运行模式：

| 模式 | 语义 |
|------|------|
| `single` | 单 Agent 模式：完整取 `singleAgent` 配置（`skin` / `model` / `promptTemplate`），**去掉多角色编排提示词**（orchestrator 不注入子角色清单）。`spawn_agent` 工具仍然可用。 |
| `multi` | 多 Agent 模式：orchestrator 注入 `multiAgent` 子角色清单，按角色专长自动派发子 Agent。 |

> 默认值为 `single`。两种模式都**不禁用** `spawn_agent`，区别仅在于是否注入多角色编排提示词与是否取 `singleAgent` 配置。

### singleAgent 配置

`single` 模式下生效的配置（与 `multiAgent` 同级）：

```json
{
  "singleAgent": {
    "model": "minimax_model",
    "skin": "warlord-stern",
    "promptTemplate": "orchestrator"
  }
}
```

### 切换模式

模式有两种切换方式：

**1. `--mode` 启动参数（启动时覆盖，优先于配置）**

```bash
wasteland tui --mode multi
wasteland chat --mode single --message "你好"
wasteland resume --mode multi
```

`--mode` 只接受 `single` / `multi`，非法值在进入运行时之前报错。优先级：
`--mode` 启动参数 > `settings.runtime.mode` > 默认 `single`。

**2. `/mode` 斜杠命令（写回配置，重启后生效）**

在 TUI 或 CLI 交互界面中输入：

```
/mode multi      # 切换为多 Agent 模式
/mode single     # 切换为单 Agent 模式
```

`/mode` 会把 `runtime.mode` 写回当前生效的 `settings.json`（cwd 内有项目级配置则写项目级，
否则写用户级 `~/.wasteland/settings.json`），并提示「重启后生效」。模式在运行时启动时固化，
因此**不支持** turn 中途热切换，需要重启 wasteland 才能应用新配置。

## ACP 集成

wasteland 支持 [ACP（Agent Client Protocol）](https://agentclientprotocol.com)，通过顶层 `acp`
配置块（与 `multiAgent` 同级）声明。远程 agent 以**子进程**启动、经 stdio 上的 JSON-RPC 通信；
在 single / multi 模式下**机制统一**：每个 agent 注册为直接工具，主 Agent 与子 Agent（经继承）都能调用。

```json
{
  "acp": {
    "agents": [
      {
        "name": "claude_code",
        "command": "npx",
        "args": ["-y", "@agentclientprotocol/claude-agent-acp"],
        "description": "调用本地 Claude Code 智能体执行全工程检索、重构与跨文件编码任务"
      }
    ]
  }
}
```

### `acp.agents`：出站调用的远程 Agent

每个 `agents` 条目成为一个直接工具 `acp_<name>`（如 `acp_claude_code`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | Agent 名称，工具名后缀（`acp_<name>`），字母/数字/`_`/`-`，全表唯一 |
| `command` | string | 子进程启动命令（如 `npx`） |
| `args` | string[] | 命令参数 |
| `env` | object | 追加环境变量，值支持 `$auth` ref |
| `cwd` | string | 子进程工作目录（默认运行时 cwd） |
| `description` | string | 描述，供 LLM 发现工具用途 |
| `timeoutMs` | number | 单次任务超时（覆盖 `acp.defaults.timeoutMs`） |

主 Agent 调用 `acp_<name>` 工具即可向远程 Agent 派发任务；子 Agent 通过工具集继承同样可以调用。
工具执行时 spawn 子进程 → initialize 握手 → session/prompt 流式收 `session/update` →
拿到 `stopReason` 终态 → 回收子进程，**无常驻服务、无端口、无轮询**。

> 历史说明：此前版本使用顶层 `a2a` 块（HTTP+SSE 协议 + 本机 HTTP 托管 server），已整体移除；
> 残留 `a2a` 配置块会在启动时打印一次迁移提示并被忽略。更早的嵌套写法
> `multiAgent[x].mode: 'a2a'` / `multiAgent[x].a2aServer` 亦已移除。

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

每个子 Agent 都有独立的 Session（中央数据根 `~/.wasteland/data/sessions/<projectId>/`）：

- 主 Agent: `{sessionId}.jsonl`
- 子 Agent: `{sessionId}-child-{name}.jsonl`

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
wasteland chat --provider qwen --message "分析这个项目的架构"

# 管道输入
echo "分析 package.json" | wasteland chat --provider qwen

# 带权限模式（适用于自动化脚本）
wasteland chat --provider qwen --message "..." --permission-mode bypass_permissions
```

chat 选项：

| 选项 | 说明 |
|------|------|
| `-m, --message <text>` | 单次消息（非交互） |
| `-p, --provider <name>` | 指定模型 provider |
| `-r, --role <name>` | 指定角色 |
| `--mode <mode>` | 运行模式覆盖（`single` / `multi`，启动时生效） |
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
