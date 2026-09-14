# 多角色配置方案

## 目的

本文档定义 `wasteland` 后续支持多角色、多模型、多 provider 时，建议采用的配置结构。

这是一份架构设计文档，不代表当前代码已经全部实现。当前仓库已经落地的是：

- `providers`
- `defaultProvider`
- 统一配置加载优先级
- `qwen` / `local` 两个 provider

本文档描述的是下一步的目标收口方式。

---

## 设计目标

多角色配置要解决 4 个问题：

1. 不同角色使用不同模型
2. 不同模型可能来自不同 provider
3. 一组角色路由需要在不同场景下快速切换
4. 不把密钥、endpoint、模型名和角色语义混成一团

因此配置需要拆成 4 层：

- `providers`：连接方式、鉴权、endpoint
- `models`：具体模型定义
- `roles`：角色语义与默认模型
- `profiles`：一组角色覆盖方案

---

## 推荐结构

```json
{
  "runtime": {
    "defaultProfile": "default",
    "defaultRole": "chat",
    "permissionMode": "default",
    "maxStepsPerTurn": 30,
    "debug": false
  },
  "providers": {
    "dashscope": {
      "type": "openai-compatible",
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "apiKeyEnv": "DASHSCOPE_API_KEY"
    }
  },
  "models": {
    "qwen-max": {
      "provider": "dashscope",
      "model": "qwen3-max",
      "temperature": 0.2,
      "capabilities": ["chat", "reasoning"]
    },
    "qwen-fast": {
      "provider": "dashscope",
      "model": "qwen3-plus"
    }
  },
  "roles": {
    "chat": {
      "model": "qwen-max",
      "prompt": "prompts/chat.md",
      "permissionMode": "default"
    },
    "planner": {
      "model": "qwen-fast",
      "prompt": "prompts/planner.md",
      "permissionMode": "default"
    },
    "coder": {
      "model": "qwen-max",
      "prompt": "prompts/coder.md",
      "permissionMode": "accept_edits"
    },
    "reviewer": {
      "model": "qwen-fast",
      "prompt": "prompts/reviewer.md"
    }
  },
  "profiles": {
    "default": {},
    "economy": {
      "roleOverrides": {
        "chat": {
          "model": "qwen-fast"
        },
        "coder": {
          "model": "qwen-fast"
        }
      }
    }
  }
}
```

---

## 分层规则

### 1. `providers`

只负责“怎么连”：

- provider 类型
- base URL
- 鉴权方式
- transport 能力

不要在这一层放：

- 角色名
- prompt
- 业务语义

### 2. `models`

只负责“调用哪个模型”：

- provider 归属
- model id
- 默认推理参数
- 能力标签

不要在这一层放：

- 角色用途
- 工具权限策略

### 3. `roles`

只负责“这个角色应该怎么工作”：

- 默认模型
- prompt
- 权限模式
- 后续可扩展的 tool policy

### 4. `profiles`

只负责“在某个运行场景下覆盖哪些角色路由”。

适合表达：

- `default`
- `economy`
- `fast`
- `review-heavy`

---

## CLI 覆盖建议

后续命令面建议支持：

- `--profile`
- `--role`
- `--model`
- `--provider`

推荐生效顺序：

1. `--model`
2. `--role`
3. `runtime.defaultRole`
4. `--profile`
5. `runtime.defaultProfile`

其中：

- `--model` 是最强覆盖，直接指定最终模型
- `--role` 决定角色语义
- `profile` 决定是否对角色默认模型做覆盖

---

## 与当前实现的兼容策略

当前代码仍以：

- `defaultProvider`
- `providers`

为主。

后续演进建议分 3 步：

1. 先引入 `models` / `roles` / `profiles` schema，但保留旧字段兼容
2. 再在 runtime 中增加 role/profile 解析
3. 最后把 `defaultProvider` 逐步降级为兼容入口

这样可以避免一次性推翻当前已经可运行的 `qwen` 接入路径。

---

## 当前仓库建议

对当前项目，我建议下一步最小实现先做：

- `models`
- `roles`
- `runtime.defaultRole`
- `chat --role`
- `wasteland config current`

先不急着做：

- 完整 `profiles`
- 多 provider tool-calling 差异层
- 所有角色的 prompt 装载系统

这样改动面最小，但已经足够支撑“一个 CLI 有多个角色、每个角色走不同模型”的主需求。
