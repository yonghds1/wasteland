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

向导写入的最小结构：

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
  }
}
```

```jsonc
// ~/.wasteland/auth.json
{ "<providerName>_api_key": "<apiKey>" }
```

**非交互环境**（管道、CI）不会自动触发向导；如需在此类环境配置，请手动创建上述两个文件。

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
    "defaultRole": "immortan-joe",
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
| `defaultRole` | string | `immortan-joe` | 默认角色 |
| `defaultModel` | string | - | 默认模型 |
| `permissionMode` | string | `default` | 权限模式 |
| `maxStepsPerTurn` | number | `8` | 单轮最大步数 |
| `maxTurns` | number | `20` | 最大轮次数 |
| `debug` | boolean | `false` | 调试模式 |
| `language` | string | `en` | 语言 |

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

## CLI 参数

```bash
wasteland chat \
  --provider jdcloud \
  --role immortan-joe \
  --permission-mode bypass_permissions \
  --debug \
  --message "你好"
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
