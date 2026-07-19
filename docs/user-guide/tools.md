# 工具使用指南

本指南介绍 wasteland 的所有内建工具。

工具是 core 层能力，与 UI 无关：无论是在 TUI 中对话，还是在非交互的 `chat` fallback 中，Agent 调用的都是同一套工具。区别只在于「如何触发」——TUI 中你用自然语言描述需求，主 Agent 自动选择并调用合适的工具；`chat` 中则通过 `--message` 一次性提交。

## 工具概览

wasteland 内置 13 个工具，按用途分为以下几类（另有一类 MCP 工具在配置 MCP 服务器后动态发现）：

| 类别 | 工具 |
|------|------|
| 文件操作 | read-file, write-file, edit-file |
| 目录操作 | list-directory, glob |
| 搜索 | grep, web-search |
| 命令执行 | bash |
| 网络 | web-fetch, http-request |
| 版本控制 | git |
| 多 Agent | spawn_agent |
| 用户交互 | ask-user |
| MCP | （按配置动态发现） |

## 在 TUI 中调用工具

TUI 是唯一主界面。默认无参启动即进入 TUI：

```bash
# 默认启动 TUI
wasteland

# 或显式指定 tui 子命令与选项
wasteland tui --provider jdcloud
wasteland tui -r <role>
wasteland tui --permission-mode bypass_permissions
wasteland tui --attach <session>
```

进入 TUI 后，直接在输入框用自然语言描述需求即可，主 Agent 会判断需要哪些工具并自动调用。下文示例中 `>` 开头的行表示在 TUI 输入框中输入的内容，紧跟其后的是 Agent 实际触发的工具调用（仅供参考，无需手动输入）。

## 文件操作工具

### read-file

读取文件内容，支持分页读取大文件。

**参数**:
- `path`: 文件路径，相对于工作目录（必填）
- `offset`: 起始行号，从 1 开始（可选）
- `limit`: 读取行数（可选）

**TUI 示例**:
```
> 读取 package.json
  → read-file({ path: "package.json" })

> 读取 src/index.ts 的前 10 行
  → read-file({ path: "src/index.ts", offset: 1, limit: 10 })

> 读取 README.md 的第 50-100 行
  → read-file({ path: "README.md", offset: 50, limit: 51 })
```

### write-file

创建或覆写文件内容。

**参数**:
- `path`: 文件路径，相对于工作目录（必填）
- `content`: 文件完整内容（必填）

**注意**: 需要先读取文件才能写入（read-before-write 安全检查）。

**TUI 示例**:
```
> 创建文件 hello.ts，内容是 console.log('hello')
  → write-file({ path: "hello.ts", content: "console.log('hello')" })
```

### edit-file

精确编辑文件内容，通过字符串替换修改。

**参数**:
- `path`: 要编辑的文件路径，相对于工作目录（必填）
- `old_string`: 要替换的原始字符串（必填）
- `new_string`: 替换后的新字符串（必填）
- `replace_all`: 是否替换所有匹配项（可选，默认 false）

**注意**: 需要先读取文件才能编辑（read-before-write 安全检查）。

**TUI 示例**:
```
> 把 src/index.ts 里的 const foo 改成 const bar
  → edit-file({ path: "src/index.ts", old_string: "const foo", new_string: "const bar" })

> 替换 utils.ts 中所有的 oldValue 为 newValue
  → edit-file({ path: "utils.ts", old_string: "oldValue", new_string: "newValue", replace_all: true })
```

## 目录操作工具

### list-directory

列出目录内容，支持递归和隐藏文件。

**参数**:
- `path`: 目录路径（可选，默认当前工作目录）
- `recursive`: 是否递归列出子目录（可选，默认 false）
- `showHidden`: 是否显示隐藏文件（可选，默认 false）

**TUI 示例**:
```
> 列出当前目录
  → list-directory({})

> 递归列出 src 目录
  → list-directory({ path: "src", recursive: true })
```

### glob

使用 glob 模式查找文件。

**参数**:
- `pattern`: 文件匹配模式，如 `*.ts`、`src/**`（必填）
- `cwd`: 搜索根目录（可选，默认当前工作目录）

**TUI 示例**:
```
> 搜索所有 .ts 文件
  → glob({ pattern: "**/*.ts" })

> 搜索 src 目录下的所有文件
  → glob({ pattern: "src/**/*" })

> 搜索所有测试文件
  → glob({ pattern: "**/*.test.js" })
```

## 搜索工具

### grep

在文件中搜索匹配指定模式的文本行。

**参数**:
- `pattern`: 搜索模式，支持正则表达式（必填）
- `path`: 搜索路径（可选，默认当前工作目录）
- `include`: 文件包含模式，如 `*.ts`（可选）
- `ignoreCase`: 是否忽略大小写（可选，默认 false）

**TUI 示例**:
```
> 搜索所有包含 TODO 的文件
  → grep({ pattern: "TODO" })

> 在 src 目录的 TypeScript 文件中搜索 FIXME
  → grep({ pattern: "FIXME", path: "src", include: "*.ts" })

> 不区分大小写搜索 import
  → grep({ pattern: "import", ignoreCase: true })
```

### web-search

使用搜索引擎搜索网络信息。

**参数**:
- `query`: 搜索关键词（必填）
- `maxResults`: 最大结果数量（可选，默认 5，最大 20）
- `engine`: 搜索引擎（可选，默认 `duckduckgo`）

**TUI 示例**:
```
> 搜索 RxJS 最佳实践
  → web-search({ query: "RxJS 最佳实践" })

> 搜索 Node.js 教程，返回 10 条结果
  → web-search({ query: "Node.js tutorials", maxResults: 10 })
```

## 命令执行工具

### bash

执行 shell 命令。

**参数**:
- `command`: 要执行的 shell 命令（必填）

**TUI 示例**:
```
> 查看 git 状态
  → bash({ command: "git status" })

> 运行测试
  → bash({ command: "npm test" })

> 查看当前目录
  → bash({ command: "pwd" })
```

**安全说明**: bash 工具会执行任意命令，风险等级为 `execute`，默认需要用户确认。

## 网络工具

### web-fetch

从 URL 获取内容并返回文本响应。

**参数**:
- `url`: 请求 URL，支持 http/https（必填）
- `method`: HTTP 方法（可选，默认 `GET`）
- `headers`: 自定义请求头（可选）
- `body`: 请求体，POST/PUT/PATCH 时使用（可选）
- `timeout`: 超时时间，毫秒（可选，默认 30000）

**TUI 示例**:
```
> 获取 https://example.com 的内容
  → web-fetch({ url: "https://example.com" })
```

### http-request

发送 HTTP 请求。建议优先使用 web-fetch，http-request 适用于需要更细粒度控制的场景。

**参数**:
- `url`: 请求 URL（必填）
- `method`: HTTP 方法（可选，默认 `GET`）
- `headers`: 请求头（可选）
- `body`: 请求体（可选）
- `timeout`: 超时时间，毫秒（可选，默认 30000）

**TUI 示例**:
```
> 发送 GET 请求到 https://api.example.com
  → http-request({ url: "https://api.example.com" })
```

## 版本控制工具

### git

执行 Git 版本控制操作，支持常用子命令。

**参数**:
- `subcommand`: Git 子命令（必填，可选值：`status`、`diff`、`log`、`add`、`commit`、`branch`、`checkout`、`push`、`pull`）
- `args`: 子命令的参数数组（可选）
- `message`: commit 信息（仅 `commit` 时需要）

**安全限制**: 禁止 force push（`push --force` / `push -f`）、`rebase`、`reset --hard` 等危险操作。

**TUI 示例**:
```
> 查看 git 状态
  → git({ subcommand: "status" })

> 查看最近 5 条提交记录
  → git({ subcommand: "log", args: ["-5"] })

> 提交所有改动，信息为 "fix: 修复登录问题"
  → git({ subcommand: "add", args: ["-A"] })
  → git({ subcommand: "commit", message: "fix: 修复登录问题" })
```

## 多 Agent 工具

### spawn_agent

创建并运行子 Agent 执行任务。多 Agent 调度由主 Agent 自动完成，无需任何 `--multi` 之类的开关。

**参数**:
- `name`: 子 Agent 标识（必填）
- `task`: 任务描述（必填）
- `model`: 模型选择，如 `haiku`/`sonnet`/`opus` 或具体模型名（可选）
- `tools`: 限定子 Agent 可用的工具集（可选）
- `inheritHistory`: 是否继承父 Agent 的历史上下文（可选，默认 false）

**TUI 示例**:
```
> 创建一个 researcher 子 Agent 搜索信息
  → spawn_agent({ name: "researcher", task: "搜索信息" })

> 创建只读子 Agent，只使用 read-file 和 grep
  → spawn_agent({ name: "analyst", task: "分析代码", tools: ["read-file", "grep"] })
```

> 详细的多 Agent 编排说明见[多 Agent 使用指南](./multi-agent.md)。

## 用户交互工具

### ask-user

向用户提问并等待回答。

**参数**:
- `question`: 要问用户的问题（必填）
- `options`: 可选答案列表（可选）
- `default`: 默认答案（可选）

**TUI 示例**:
```
> 问我一个问题：你今天心情如何？
  → ask-user({ question: "你今天心情如何？" })

> 让我在 A. 读取文件 B. 执行命令 中选一个
  → ask-user({ question: "选择操作", options: ["A. 读取文件", "B. 执行命令"] })
```

## MCP 工具

MCP（Model Context Protocol）工具通过外部进程通信，支持动态发现和调用。MCP 工具没有固定名称，而是在你配置 MCP 服务器后，运行时按 `<server-name>/<tool-name>` 的形式动态注册到工具表中。

**参数**: 由具体 MCP 服务器定义。

**TUI 示例**:
```
> 使用配置好的 MCP 工具执行任务
```

主 Agent 会根据已注册的 MCP 工具自动选择调用。配置 MCP 服务器的方法见[配置指南](./configuration.md)。

## 工具组合使用

wasteland 的主 Agent 会自动组合多个工具完成复杂任务。在 TUI 中只需用自然语言描述目标即可。

### 示例 1: 代码分析

```
> 分析这个项目的架构，包括：1. 列出目录结构 2. 读取主要文件 3. 总结功能
```

主 Agent 会依次调用 list-directory、read-file 等工具，最后汇总分析结果。

### 示例 2: 代码重构

```
> 重构 src/index.ts：1. 读取文件 2. 分析代码 3. 提出改进建议 4. 应用修改
```

主 Agent 会先 read-file 读取内容，分析后用 edit-file 应用修改（写操作会触发权限确认）。

### 示例 3: 测试执行

```
> 运行测试并分析结果：1. 执行 npm test 2. 分析输出 3. 修复失败的测试
```

主 Agent 会用 bash 执行 `npm test`，根据输出定位失败用例，再结合 read-file / edit-file 修复。

## 工具权限

每个工具有一个风险等级（`read` / `write` / `execute`），权限系统据此决定是否需要用户确认：

| 风险等级 | 工具 | `default` 模式 | `accept_edits` 模式 |
|----------|------|----------------|---------------------|
| read | read-file, list-directory, glob, grep, web-search, ask-user | 自动允许 | 自动允许 |
| write | write-file, edit-file | 需要确认 | 自动允许 |
| execute | bash, web-fetch, http-request, git, spawn_agent | 需要确认 | 需要确认 |

第三种模式 `bypass_permissions` 会跳过所有权限检查，全部自动允许（仅限受信任的自动化场景）。

可在启动 TUI 时通过 `--permission-mode` 指定模式：

```bash
wasteland tui --permission-mode accept_edits
wasteland tui --permission-mode bypass_permissions
```

## 故障排除

### 工具执行失败

```
Error: Tool execution failed
```

**解决方案**:
1. 检查工具参数是否正确（路径、模式等）
2. 检查文件路径是否存在
3. 检查权限是否足够

### 权限被拒绝

```
Permission denied
```

**解决方案**:
1. 在 TUI 中遇到权限请求时选择允许
2. 启动时使用 `--permission-mode accept_edits` 自动放行写操作
3. 受信任的自动化场景可使用 `--permission-mode bypass_permissions` 跳过权限检查

## 非交互 fallback（chat 命令）

TUI 是唯一主界面。当处于非交互环境（管道、脚本、CI）或无 TTY 时，可使用保留的 `chat` 命令作为 fallback。`chat` 命令已从 `--help` 隐藏，但仍可正常调用。

`chat` 模式下 Agent 调用的工具集与 TUI 完全一致，区别仅在于输入输出为非交互式。

```bash
# 单次消息
wasteland chat --provider jdcloud --message "读取 package.json"

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
