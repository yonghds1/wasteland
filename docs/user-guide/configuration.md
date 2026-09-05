# 配置指南

本指南详细介绍 wasteland 的配置选项。

## 首次使用

无配置时首次运行 wasteland，会自动进入交互式初始化向导，引导你填写最小可运行配置：

```bash
wasteland          # 检测到无配置 → 自动进入 init wizard → 完成后进入 TUI
wasteland init     # 显式重跑向导（已存在配置时报错）
wasteland init --force  # 强制覆盖已有配置
```

向导会依次询问：

1. **Provider 协议类型** — `openai-compatible`（DeepSeek/GLM/OpenAI/自建）或 `anthropic`（Anthropic 官方协议）
2. **Provider 名称** — 用作 `settings.json` 中 `providers` 的 key
3. **API baseUrl** — 端点地址，例如 `https://api.deepseek.com/v1`
4. **API Key** — 输入将被掩码；写入 `~/.wasteland/auth.json`
5. **模型 ID** — 服务端识别的模型名，如 `deepseek-chat`、`gpt-4o`、`claude-sonnet-4-6`

向导写入的完整结构：

```jsonc
// ~/.wasteland/settings.json
{
  "runtime": { "defaultModel": "default" },
  "providers": {
    "<providerName>": {
      "type": "openai-compatible",
      "baseUrl": "<baseUrl>",
      "apiKey": { "$auth": "<providerName>_api_key" }
    }
  },
  "models": {
    "default": { "provider": "<providerName>", "model": "<modelId>" }
  },
  "singleAgent": {
    "model": "default",
    "skin": "warlord-stern",
    "promptTemplate": "orchestrator"
  },
  "multiAgent": {
    "main": { "role": "orchestrator", "model": "default", "skin": "warlord-stern" },
    "researcher": { "role": "researcher", "model": "default" },
    "developer": { "role": "developer", "model": "default" },
    "analyst": { "role": "analyst", "model": "default" },
    "tester": { "role": "tester", "model": "default" }
  }
}
```

```jsonc
// ~/.wasteland/auth.json
{ "<providerName>_api_key": "<apiKey>" }
```

向导还会生成可编辑的皮肤与角色骨架（完整定义仍由内置默认兜底）：

```jsonc
// ~/.wasteland/skins.json
{
  "skins": { "scout": { "id": "scout", "label": "荣耀之路车长", ... } },
  "singleAgent": { "skin": "warlord-stern" }
}

// ~/.wasteland/roles.json
{
  "roles": {
    "researcher": { "promptTemplate": "role-worker", "description": "信息收集与研究", "skins": ["scout"] },
    "developer": { "promptTemplate": "role-worker", "description": "代码开发与实现", "skins": ["coder"] }
  }
}
```

**非交互环境**（管道、CI）不会自动触发向导；如需在此类环境配置，请手动创建上述文件。

---

## 配置文件位置

wasteland 使用分层配置系统：

1. **项目配置**: `.wasteland/settings.json`
2. **项目认证**: `.wasteland/auth.json`
3. **全局配置**: `~/.wasteland/settings.json`
4. **环境变量**: 覆盖配置文件中的值

## 配置优先级

```
CLI 参数 > 环境变量 > 项目配置 > 全局配置 > 内置默认值
```

## 核心配置

### .wasteland/settings.json

```json
{
  "runtime": {
    "defaultRole": "orchestrator",
    "defaultModel": "main_model",
    "permissionMode": "bypass_permissions",
    "maxStepsPerTurn": 15,
    "maxTurns": 30,
    "debug": false,
    "language": "en"
  },
  "providers": {
    "jdcloud": {
      "type": "openai-compatible",
      "baseUrl": "https://modelservice.jdcloud.com/coding/openai/v1",
      "apiKey": { "$auth": "jdcloud_api_key" }
    }
  },
  "models": {
    "main_model": {
      "provider": "jdcloud",
      "model": "GLM-5"
    }
  }
}
```

### .wasteland/auth.json

```json
{
  "jdcloud_api_key": "your-api-key",
  "xiaomi_api_key": "your-api-key"
}
```

## 配置项说明

### runtime 配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `defaultRole` | string | `orchestrator` | 默认角色 |
| `defaultModel` | string | - | 默认模型 |
| `mode` | string | `single` | 运行模式（`single` 单 Agent / `multi` 多 Agent），可被 `--mode` 启动参数覆盖 |
| `skinId` | string | `warlord-stern` | 皮肤主题 id（与角色独立） |
| `permissionMode` | string | `default` | 权限模式 |
| `maxStepsPerTurn` | number | `8` | 单轮最大步数 |
| `maxTurns` | number | `20` | 最大轮次数 |
| `contextWindowSize` | number | `30` | 上下文压缩滑动窗口（保留的最近消息数） |
| `compactionThreshold` | number | `0.8` | 触发同步压缩的低水位（0-1），token 占比超此值即滑动切割 |
| `summarizationThreshold` | number | `0.95` | 触发异步摘要压缩的高水位（0-1），须 >= `compactionThreshold` |
| `contextSummarization` | boolean | `true` | 压缩时是否用 LLM 生成摘要替代直接丢弃 |
| `debug` | boolean | `false` | 调试模式 |
| `language` | string | `en` | 语言 |

#### 上下文压缩缓冲带

wasteland 的自动压缩分为两层，由两个阈值构成缓冲带：

- **低水位 `compactionThreshold`（默认 0.8）**：token 占比超过它时，做**同步滑动切割**（不调 LLM，快速腾出空间的安全网）。
- **高水位 `summarizationThreshold`（默认 0.95）**：冲到高水位才用 **LLM 生成摘要**替代直接丢弃，保留早期上下文。

之所以分层，是因为若只用一个阈值，usage 一过阈值就会被同步切割先切掉一部分，之后异步摘要拿到的记录不完整，摘要质量打折。缓冲带让"便宜切割"和"优质摘要"各管一段，互不打架。`summarizationThreshold` 必须 ≥ `compactionThreshold`。

### providers 配置

```json
{
  "providers": {
    "<provider-name>": {
      "type": "openai-compatible|anthropic|local",
      "baseUrl": "API 端点",
      "apiKey": { "$auth": "env-key-name" }
    }
  }
}
```

### models 配置

```json
{
  "models": {
    "<model-name>": {
      "provider": "provider-name",
      "model": "model-id"
    }
  }
}
```

### multiAgent / singleAgent 配置

`multiAgent` 与 `singleAgent` 是两个同级的顶层块，分别对应 `multi` / `single` 运行模式
（见 `runtime.mode`）。详细用法见[多 Agent 使用指南](./multi-agent.md)。

```json
{
  "singleAgent": {
    "model": "minimax_model",
    "skin": "warlord-stern",
    "promptTemplate": "orchestrator"
  },
  "multiAgent": {
    "researcher": { "role": "researcher", "skin": "scout" },
    "developer": { "role": "developer", "skin": "coder" }
  }
}
```

- `singleAgent`：`single` 模式下完整取用（`model` / `skin` / `promptTemplate`），并去掉多角色编排提示词。
- `multiAgent`：`multi` 模式下注入主 Agent 的子角色清单；每个 key 是一个子角色名，值为
  `{ role, skin }` 引用。角色定义在 `.wasteland/roles.json`（见[多 Agent 使用指南](./multi-agent.md)）。

> 旧的内联 `promptVariables` 变量系统已移除，角色定义统一走 `roles.json`。

### 项目记忆（memory.md）

wasteland 支持将**项目级 + 用户级持久记忆**注入 system prompt 最前面，作为跨会话保留的项目约定（类似 Claude Code 的 `CLAUDE.md`）：

- **用户级**：`~/.wasteland/memory.md`（全局基线）
- **项目级**：`.wasteland/memory.md`（项目特化，追加在后）

```markdown
# .wasteland/memory.md
## 项目约定
- 新模块遵循 index.ts + __tests__ 结构
- 测试用 Vitest，从源码导入
```

每次会话启动时，两者合并（用户级在前、项目级在后）后以 `## Project Memory` 块注入 system prompt 最前面。主 Agent 与 spawn 出的子 Agent 都会继承。

用 `runtime.projectMemory: false` 可关闭注入（默认 `true`）：

```json
{ "runtime": { "projectMemory": false } }
```

> 记忆文件是纯文本 markdown，写入靠人工维护（agent 只读不写）。

### a2a 配置

顶层 `a2a` 块（与 `multiAgent` 同级）声明 A2A（Agent-to-Agent）集成，single / multi 模式机制统一：

```json
{
  "a2a": {
    "agents": [
      {
        "name": "claude-code",
        "url": "http://localhost:9200",
        "description": "Claude Code - AI coding assistant",
        "token": { "$auth": "claude_code_token" }
      }
    ],
    "servers": {
      "claude-code": {
        "enabled": true,
        "port": 9200,
        "command": "claude",
        "description": "Claude Code - AI coding assistant"
      }
    }
  }
}
```

| 子块 | 说明 |
|------|------|
| `a2a.agents` | 出站调用的远程 Agent。每个条目注册为一个直接工具 `a2a_<name>`，`description` 供 LLM 发现用途，`token` 支持 `$auth` 引用。主 Agent 与子 Agent 均可调用。 |
| `a2a.servers` | 本机启动托管的 A2A server（按名称索引）。`enabled: true` 时 wasteland 启动会拉起 `command` 进程并监听 `port`，与工具无关。 |

> 旧的嵌套写法 `multiAgent[x].mode: 'a2a'` / `multiAgent[x].a2aServer` 已移除，A2A 配置统一迁移到顶层 `a2a` 块。

## 环境变量

### 核心环境变量

| 环境变量 | 说明 |
|----------|------|
| `WASTELAND_HOME` | 全局配置目录 |
| `WASTELAND_PROVIDER` | 覆盖默认 provider |
| `WASTELAND_PERMISSION_MODE` | 覆盖权限模式 |
| `WASTELAND_MAX_STEPS_PER_TURN` | 覆盖最大步数 |
| `WASTELAND_DEBUG` | 启用调试模式 |
| `WASTELAND_SESSION_DIR` | 覆盖 session 目录 |

### Provider 环境变量

```bash
# jdcloud
export jdcloud_api_key='your-key'

# xiaomi
export xiaomi_api_key='your-key'

# Qwen (兼容 OpenAI)
export APP_CHAT_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode"
export APP_CHAT_API_KEY="your-key"
export APP_CHAT_MODEL="qwen3-max"
```

## 权限模式

| 模式 | 说明 |
|------|------|
| `default` | 读操作自动允许，写操作需要确认 |
| `accept_edits` | 读写操作自动允许，高风险操作需要确认 |
| `bypass_permissions` | 所有操作自动允许（不推荐生产使用） |

## 启动参数

### TUI(主界面)

```bash
npm run dev -- tui --provider jdcloud --role orchestrator --permission-mode bypass_permissions --debug
# 或(全局安装后):wasteland tui --provider jdcloud --role orchestrator
# --attach <session-id> 可直接恢复指定会话
```

TUI 是交互式界面,无需 `--message`。选项:`-p/--provider`、`-r/--role`、`--permission-mode`、`--debug`、`--attach <session>`。

### 非交互 fallback(chat)

`chat` 命令已从 `--help` 隐藏,保留作脚本/管道场景:

```bash
wasteland chat --provider jdcloud --role orchestrator --permission-mode bypass_permissions --message "你好"
```

## 配置验证

```bash
# 查看当前配置
wasteland config current

# 查看可用的 providers
wasteland config current --json | jq '.available.providers'

# 查看可用的 models
wasteland config current --json | jq '.available.models'
```

## 故障排除

### API 密钥错误

```
Error: API key is invalid
```

**解决方案**:
1. 检查 `.wasteland/auth.json` 中的 API 密钥
2. 检查环境变量是否正确设置

### Provider 连接失败

```
Error: Connection refused
```

**解决方案**:
1. 检查网络连接
2. 检查 `baseUrl` 配置是否正确
3. 检查 API 密钥是否有效

### 模型不支持

```
Error: Not supported model xxx
```

**解决方案**:
1. 检查模型名称是否正确
2. 检查 provider 是否支持该模型
