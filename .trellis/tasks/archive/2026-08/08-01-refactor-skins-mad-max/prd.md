# refactor(skins): 去 Mad Max 化 — 皮肤配置化架构

## Goal

彻底去 Mad Max 化：核心代码不含任何角色名，所有皮肤配置由 `.wasteland/skins/` 目录下的 JSON 文件驱动。

### 核心原则
- **核心代码零角色名**：`src/` 目录中不出现任何 Mad Max 角色名
- **配置驱动**：皮肤定义全部在 `.wasteland/skins/` 目录下
- **无 i18n**：JSON 里写什么显示什么（先用中文，后续再翻译）
- **agent 和皮肤分离**：每个 agent 可有多个皮肤（随机选取）
- **用户可自定义**：`.wasteland/skins/` 下其他 JSON 文件是用户皮肤

## 架构设计

### 目录结构

```
.wasteland/
  skins/
    default.json      ← 内置默认皮肤集（代码维护，可重置）
    custom-skin.json  ← 用户自定义皮肤（可选）
    ...

src/skins/
  types.ts            ← SkinUi / SkinFile 类型定义
  loader.ts           ← 从 .wasteland/skins/*.json 加载皮肤
  registry.ts         ← 动态皮肤注册表
  default-skin.ts     ← 内置 default.json 内容（代码维护）
  index.ts            ← 导出 API
```

### 皮肤 JSON 格式

一个 JSON 文件包含**皮肤定义**和 **agent 映射**：

```json
{
  "skins": [
    {
      "id": "warlord-stern",
      "label": "废土军阀",
      "thinking": ["正在审视你的请求...", "在权衡利弊..."],
      "greeting": ["说吧，废土之上没有秘密。", "你的请求我已收到。"],
      "catchphrases": ["废土的规矩，我说了算。", "生存是唯一法则。"],
      "errorPrefix": "军阀"
    }
  ],
  "agent": {
    "single": {
      "skins": ["warlord-stern"]
    },
    "multiple": {
      "main": { "skins": ["warlord-stern", "warlord-casual"] },
      "scout": { "skins": ["scout"] }
    }
  }
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `skins` | array | ✅ | 皮肤定义数组（定义一次，多处引用） |
| `skins[].id` | string | ✅ | 皮肤唯一标识 |
| `skins[].label` | string | ✅ | 皮肤显示名 |
| `skins[].thinking` | string[] | ✅ | 思考状态文案（随机选取） |
| `skins[].greeting` | string[] | ✅ | 欢迎语（随机选取） |
| `skins[].catchphrases` | string[] | ✅ | 口头禅（随机选取） |
| `skins[].errorPrefix` | string | ✅ | 错误前缀 |
| `agent` | object | ✅ | agent 配置 |
| `agent.single` | object | ✅ | 单 agent 模式配置 |
| `agent.single.skins` | string[] | ✅ | 单 agent 可选皮肤 ID 列表 |
| `agent.multiple` | object | ✅ | 多 agent 模式配置（主 + 子） |
| `agent.multiple.{role}` | object | ✅ | agent 角色配置 |
| `agent.multiple.{role}.skins` | string[] | ✅ | agent 可选皮肤 ID 列表 |

### 默认皮肤（内置）

代码中维护一份 `default.json` 内容，首次启动写入 `.wasteland/skins/default.json`，用户可通过 `/skins reset` 恢复。

默认角色：
- 主 agent：废土军阀
- 子 agent：废土斥候、废土工匠、废土学者、废土哨兵

### 改动清单

| 文件 | 改动 |
|---|---|
| `src/skins/types.ts` | 改造：新增 `SkinFile` / `AgentSkinConfig` 接口 |
| `src/skins/loader.ts` | **新增**：从 `.wasteland/skins/*.json` 加载 |
| `src/skins/registry.ts` | **新增**：动态皮肤注册表 |
| `src/skins/default-skin.ts` | **新增**：内置 default.json 内容 |
| `src/skins/index.ts` | **重写**：移除静态导入，改为注册表查询 |
| `src/skins/*/` | **删除**：13 个 Mad Max 皮肤目录 |
| `src/locales/{en,zh}.json` | **删除**：所有 `skins.*` 键 |
| `src/commands/skin.ts` | 改造：支持从注册表查询，新增 `/skins reset` |
| `src/core/shared/initialize-runtime.ts` | 启动时加载 `.wasteland/skins/` |
| `src/config/settings-types.ts` | 改默认 skinId |

### TUI `/skins` 命令

在 TUI 中输入 `/skins`：
- 列出 `.wasteland/skins/` 下所有 JSON 文件
- 显示皮肤名称
- 方向键选择，Enter 应用
- `R` 键重置到默认

## Acceptance Criteria

- [ ] `src/` 目录中不出现任何 Mad Max 角色名
- [ ] `.wasteland/skins/default.json` 包含默认皮肤（废土军阀）
- [ ] 首次启动自动创建默认皮肤配置
- [ ] `/skins` 命令列出所有可用皮肤
- [ ] `/skins reset` 恢复到默认皮肤
- [ ] 用户可添加自定义皮肤 JSON
- [ ] agent 和皮肤分离：每个 agent 有多个可选皮肤
- [ ] typecheck/lint/contrast 全绿

## Out of Scope

- 不改 LLM 角色/提示词（roles/ 目录）
- 不做 YAML 支持
- 不做在线皮肤商店
- 不做 i18n（先用中文，后续再翻译）
