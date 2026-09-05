# 快速开始

本指南将帮助你快速上手 wasteland。

wasteland 以 **TUI（终端交互界面）为唯一主界面**：所有日常对话、工具调用、多 Agent 协作都在 TUI 中完成。CLI 的 `chat` 命令保留为非交互 fallback，适用于脚本、管道等无人值守场景（详见文末[非交互 fallback](#非交互-fallback)）。

## 环境要求

- Node.js 20+
- npm

## 安装

```bash
# 克隆项目
git clone <repository-url>
cd wasteland

# 安装依赖
npm install
```

## 配置 Provider

wasteland 支持多种 AI Provider。你需要配置至少一个 Provider 才能使用。

### 方式 1: 环境变量

```bash
# 配置 jdcloud (GLM-5)
export jdcloud_api_key='your-jdcloud-api-key'

# 配置 xiaomi (mimo-v2.5)
export xiaomi_api_key='your-xiaomi-api-key'
```

### 方式 2: 配置文件

编辑 `.wasteland/auth.json`:

```json
{
  "jdcloud_api_key": "your-jdcloud-api-key",
  "xiaomi_api_key": "your-xiaomi-api-key"
}
```

## 启动 TUI

安装并配置好 Provider 后，直接启动 TUI：

```bash
# 开发模式启动（推荐）
npm run dev

# 或显式启动 TUI
npm run tui

# 若已全局安装 wasteland
wasteland tui
```

> 无参数运行 `npm run dev`（即 `wasteland` 不带子命令）时会自动进入 TUI——TUI 是默认且唯一的主入口。

TUI 支持以下启动选项：

| 选项 | 说明 |
|------|------|
| `-r, --role <name>` | 指定角色 |
| `-p, --provider <name>` | 指定 Provider |
| `--permission-mode <mode>` | 权限模式（default / accept_edits / bypass_permissions） |
| `--debug` | 输出调试信息 |
| `--attach <session>` | 恢复指定会话并进入 TUI |

```bash
# 指定 provider 启动
npm run dev -- tui --provider jdcloud

# 恢复某个历史会话
npm run dev -- tui --attach <session-id>
```

## 基础使用

启动 TUI 后，直接在输入框中输入消息即可与 AI 对话：

```text
> 你好
> 帮我看看这个项目的结构
> /help
> /exit
```

切换 Provider 或角色需在启动 TUI 时通过 `-p` / `-r` 指定（重启 TUI 生效），详见[配置指南](./configuration.md)。

## Tool Calling

wasteland 支持 AI 在 TUI 中自动调用工具完成任务。

### 文件操作

```text
> 读取 package.json
> 搜索所有 .ts 文件
```

### 命令执行

```text
> 列出当前目录
> 查看 git 状态
```

工具调用过程、权限确认与结果都会在 TUI 中实时展示。

## 多 Agent

wasteland 支持多 Agent 协作完成复杂任务。在 TUI 中直接用自然语言描述即可，主 Agent 会通过 `spawn_agent` 工具调度子 Agent：

```text
> 创建一个子 Agent 来分析这个项目的架构
> 同时执行：1. 读取 README.md 2. 列出目录结构
```

## 会话管理

```bash
# 列出所有会话
wasteland sessions

# 查看会话详情
wasteland sessions show <session-id>

# 恢复会话并继续对话（进入交互模式）
wasteland resume <session-id>
```

若想在 TUI 中恢复历史会话，使用 `--attach`：

```bash
npm run dev -- tui --attach <session-id>
```

## TUI 本地命令

在 TUI 中，可以使用以下本地命令（输入后回车，不会发送给 AI）：

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助信息 |
| `/tools` | 列出可用工具 |
| `/skills` | 列出可用技能 |
| `/clear` | 清屏 |
| `/exit` | 退出 TUI |

## 非交互 fallback

对于脚本、管道、CI 等无人值守场景，可使用 `chat` 命令（已从 `--help` 隐藏，仅作 fallback）。`chat` 是非交互式单次调用，不会启动 TUI。

### 单次消息

```bash
# 使用 jdcloud provider
wasteland chat --provider jdcloud --message "你好"

# 使用 xiaomi provider
wasteland chat --provider xiaomi --message "你好"
```

### 管道输入

```bash
# 从文件读取
cat prompt.txt | wasteland chat --provider jdcloud

# 从命令输出
echo "列出当前目录" | wasteland chat --provider jdcloud
```

`chat` 的常用选项：`-m/--message`、`-p/--provider`、`-r/--role`、`--debug`、`--debug-format`、`--permission-mode`。

## 下一步

- [配置指南](./configuration.md) - 了解更多配置选项
- [工具使用指南](./tools.md) - 了解所有可用工具
- [多 Agent 指南](./multi-agent.md) - 深入了解多 Agent 协作
