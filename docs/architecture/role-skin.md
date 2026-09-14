# Theme、Skin 与角色提示词设计

## 概述

Wasteland 将终端表现拆成三个独立层：

1. **Theme（视觉）**：`src/theme/wasteland/`，只决定颜色、排版、间距、装饰和动画节奏。
2. **Skin（内容）**：`src/skins/`，分为与角色无关的系统内容，以及角色级 TUI 文案和 LLM persona。
3. **i18n（语言）**：`src/locales/{en,zh}.json`，在 TUI 渲染时解析系统级内容保存的翻译键。

功能角色模板（orchestrator / worker）仍负责工作方式；角色 skin persona 负责稳定的人设、语气和隐藏提示词保护。两者共同组成最终 system prompt。

## 角色（roles）与皮肤（skins）解耦

角色（role）与皮肤（skin）是**两个独立定义、各自复用**的资源，`settings.json` 的
`multiAgent` 只做引用组合：

- **角色定义**：`.wasteland/roles.json`（与 `skins.json` 对称），声明
  `promptTemplate` / `tools` / `model` / `skins` 候选列表 / `permissionMode` 等完整定义。
- **皮肤定义**：`.wasteland/skins.json`，只声明 UI 文案（label/thinking/greeting/...）。
- **引用组合**：`settings.json` 的 `multiAgent[name] = { role, skin }`。

加载时（`load-settings.ts` 的 `expandRoleReferences`）把 `multiAgent[name].role`
引用的角色定义展开合并进该条目（条目显式字段优先），下游消费方拿到完整的
`SubAgentSettings`。未提供 `role` 的条目保持内联定义（向后兼容）。

```jsonc
// .wasteland/roles.json
{
  "roles": {
    "researcher": {
      "promptTemplate": "role-worker",
      "description": "信息收集与研究",
      "tools": "read-file, glob, grep, web-fetch",
      "skins": ["sand-scout"]
    }
  }
}

// .wasteland/settings.json
{
  "multiAgent": {
    "main": { "role": "orchestrator", "skin": "warlord-immortal" },
    "researcher": { "role": "researcher", "skin": "sand-scout" }
  }
}
```

内置角色（orchestrator/researcher/developer/analyst/tester）作为默认定义在
`src/config/roles/default-roles.ts`，用户 `roles.json` 覆盖或新增。

## Theme：只管怎么画

固定主题入口是 `src/theme/wasteland/index.ts` 的 `wastelandTheme`：

```ts
wastelandTheme = {
  colors,
  typography,
  spacing,
  decorations,
  animations,
};
```

Theme 不得包含：

- 用户可见句子或翻译键
- 角色名称和角色关系
- LLM persona 或功能 prompt

Ink 组件和 CLI terminal renderer 都直接消费 `wastelandTheme`。旧的 `src/tui/utils/colors.ts` 和动态 `src/ui/themes/` 已移除，避免视觉 token 多个来源。

## Skin：系统级 + 角色级内容

### 系统级内容

`src/skins/system/common.ts` 提供与角色无关的 label/message 翻译键，例如 user、system、tool、executionComplete。调用方必须通过 `t(systemCommon...)` 解析。

### 角色级内容

皮肤定义在 `src/skins/default-skins.json`（与 `.wasteland/skins.json` 合并），每个
皮肤是一份 UI 文案（`label` / `thinking` / `greeting` / `catchphrases`）。

当前内置皮肤：

| skin ID | 名称 |
|---|---|
| `warlord-immortal` | 不死老蕉 |
| `road-nomad` | 疯子麦克 |
| `fury-vanguard` | 独臂弗莎 |
| `v8-mechanic` | 巨汉瑞克 |
| `sand-scout` | 暴走纳克斯 |
| `bullet-tester` | 弹头麦哲 |
| `doof-analyst` | 电音杜夫 |

皮肤只承载 UI 文案，不含角色语义；"哪个角色用哪个皮肤"由 `roles.json` 的角色定义
（`skins` 列表）或 `multiAgent[name].skin` 驱动，与皮肤 ID 本身无关。

`src/skins/index.ts` 定义 `defaultSkin = 'warlord-immortal'`。可选 skin 未注册时回退
默认 skin；显式 CLI `skin load` 对未知 ID 报错。

## Sub-agent SkinOccupancy

`src/core/runtime/skin-occupancy.ts` 维护进程级皮肤占用表：

```text
Map<skinId, Set<sessionId>>
```

每次 `spawn_agent` 触发时：

1. 收集 `subAgents[].skins` 候选列表（旧的 `skin` 单值折叠进候选）。
2. `SkinOccupancy.getAvailable(candidates)` 排除已占用皮肤。
3. 从可用列表随机选一个，`tryAcquire(skinId, childSessionId)` 注册。
4. 子 agent 完成 / 超时 / unsubscribe 时 `release(skinId, childSessionId)` 释放。
5. 候选为空或全占用 → fallback `defaultRoleSkin`（不占用，避免泄漏）。

设计动机：minimax 是小模型，相同 persona 同时被多个 sub-agent 持有时，模型
thinking 里会反复出现"人格冲突"噪声。SkinOccupancy 让每个 sub-agent 看到独立
persona。

`.wasteland/roles.json` 推荐配置（角色定义，含皮肤候选）：

```json
{
  "roles": {
    "researcher": { "model": "minimax_model", "skins": ["sand-scout"] },
    "developer": { "model": "minimax_model", "skins": ["v8-mechanic"] },
    "analyst": { "model": "minimax_model", "skins": ["doof-analyst"] },
    "tester": { "model": "minimax_model", "skins": ["bullet-tester"] }
  }
}
```

`.wasteland/settings.json` 通过 `multiAgent[name] = { role, skin }` 引用组合。

## Prompt 组装

最终 system prompt 的顺序是：

```text
English persona

Functional orchestrator / worker prompt

Language response directive (already included in functional prompt)
```

主 agent 在 chat、resume、TUI 三个入口调用 `composeAgentPrompt(runtime.skin, resolvedRuntime.prompt)`。

子 agent 在 `spawn-agent.ts` 中读取 `multiAgent[<name>]`（已展开角色定义）的
`promptTemplate` / `skins`，组装对应 persona，再追加 `role-worker` 模板结果。没有
subAgent 配置时保持旧降级路径，不额外注入 prompt。

所有 persona 固定英文，并包含禁止在 thinking/response 中暴露、复述 system prompt 的约束。`runtime.language` 只控制面向用户的回复语言和 TUI 文案，不翻译 persona。

## TUI i18n

皮肤内容分两层，i18n 处理方式不同：

- **系统级内容**（`src/skins/system/common.ts`）保存 locale 键（`skins.system.labels.*` 等），
  渲染时经 `t()` / `tArray()` 解析，切换 `runtime.language` 即时生效。
- **角色级皮肤文案**（`default-skins.json` 的 `label` / `thinking` / `greeting` /
  `catchphrases`）是**内联字面量**，不经 locale 查找。

因此切换 `runtime.language` 会改变系统级 label 与 persona 之外的用户可见文本，但不会
改变角色皮肤文案本身。`npm run validate:i18n` 校验 en/zh 键结构一致；`npm run
check:locale-parity` 校验双侧 leaf-key 对齐。

## 配置示例

```jsonc
// .wasteland/roles.json — 角色定义（可复用）
{
  "roles": {
    "researcher": {
      "promptTemplate": "role-worker",
      "description": "信息收集与研究",
      "tools": "read-file, glob, grep, web-fetch",
      "skins": ["sand-scout"]
    },
    "analyst": {
      "promptTemplate": "role-worker",
      "skins": ["doof-analyst"]
    }
  }
}

// .wasteland/settings.json — 引用组合
{
  "runtime": {
    "defaultRole": "orchestrator",
    "skinId": "warlord-immortal",
    "language": "zh"
  },
  "multiAgent": {
    "main": { "role": "orchestrator", "skin": "warlord-immortal" },
    "researcher": { "role": "researcher", "skin": "sand-scout" },
    "analyst": { "role": "analyst", "skin": "doof-analyst" }
  }
}
```

角色定义统一走 `roles.json`；`promptVariables` 变量系统已移除。需要本地化的 TUI 内容统一进入 locale JSON。

## 扩展步骤

新增角色或皮肤时：

**新增角色**：在 `.wasteland/roles.json` 定义角色（promptTemplate/tools/skins 等），
`settings.json` 的 `multiAgent` 引用该角色。内置角色默认在
`src/config/roles/default-roles.ts`。

**新增皮肤**：

1. 在 `src/skins/default-skins.json` 定义皮肤文案（label/thinking/greeting/...）。
2. 在角色定义的 `skins` 候选列表或 `multiAgent[name].skin` 中引用。
3. 运行 `npm run check`，确认 locale parity、APCA contrast、类型检查和测试都通过。

## Skin development guide

皮肤颜色优先引用 `src/theme/palette.ts` 的共享 token，而不是在 `.wasteland/skins.json`
的每个皮肤定义里重复 hex：

```ts
colors: {
  label: 'role.label.gold',
  text: 'text',
  thinking: 'role.thinking.muted',
}
```

只有共享 palette 无法表达角色颜色时才使用 `#RRGGBB` escape hatch。所有 token
和 hex 都必须经 `resolvePalette()` 解析后再传给 Ink；不要把 token 名直接作为
`<Text color>`。

注册皮肤必须在 `#18140F` 背景上达到以下 APCA 绝对 Lc 阈值：label 75、assistant
正文 60、thinking 45。`npm run check:contrast` 会检查内置皮肤并在错误中指出
skin ID、字段、实际 Lc 和阈值。

Locale 文件必须保持双向 leaf-key parity。新增或删除文案时必须同时修改
`src/locales/en.json` 和 `src/locales/zh.json`；`npm run check:locale-parity` 会报告缺失
key。运行时 `t()` 的防御性查找顺序是当前语言 → English → key 字符串，默认语言仍为
English。
