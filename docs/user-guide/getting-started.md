# 快速开始

本指南将帮助你快速上手 wasteland CLI。

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

## 基础使用

### 单次消息模式

```bash
# 使用 jdcloud provider
wasteland chat --provider jdcloud --message "你好"

# 使用 xiaomi provider
wasteland chat --provider xiaomi --message "你好"
```

### 交互模式

```bash
# 启动交互模式
wasteland chat --provider jdcloud

# 在交互模式中
> 你好
> /help
> /exit
```

### 管道输入

```bash
# 从文件读取
cat prompt.txt | wasteland chat --provider jdcloud

# 从命令输出
echo "列出当前目录" | wasteland chat --provider jdcloud
```

## Tool Calling

wasteland 支持 AI 自动调用工具完成任务。

### 文件操作

```bash
# 读取文件
wasteland chat --provider jdcloud --message "读取 package.json"

# 搜索文件
wasteland chat --provider jdcloud --message "搜索所有 .ts 文件"
```

### 命令执行

```bash
# 列出目录
wasteland chat --provider jdcloud --message "列出当前目录"

# 执行 bash 命令
wasteland chat --provider jdcloud --message "查看 git 状态"
```

## 多 Agent

wasteland 支持多 Agent 协作完成复杂任务。

```bash
# 创建子 Agent 分析代码
wasteland chat --provider jdcloud --message "创建一个子 Agent 来分析这个项目的架构"

# 并行执行多个任务
wasteland chat --provider jdcloud --message "同时执行：1. 读取 README.md 2. 列出目录结构"
```

## 会话管理

```bash
# 列出所有会话
wasteland sessions

# 查看会话详情
wasteland sessions show <session-id>

# 恢复会话
wasteland resume <session-id>

# 恢复会话并继续对话
wasteland resume <session-id> --message "继续之前的工作"
```

## 交互模式命令

在交互模式下，可以使用以下本地命令：

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助信息 |
| `/tools` | 列出可用工具 |
| `/skills` | 列出可用技能 |
| `/clear` | 清屏 |
| `/exit` | 退出交互模式 |

## 下一步

- [配置指南](./configuration.md) - 了解更多配置选项
- [工具使用指南](./tools.md) - 了解所有可用工具
- [多 Agent 指南](./multi-agent.md) - 深入了解多 Agent 协作
