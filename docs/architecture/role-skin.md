# Theme、Skin 与角色提示词设计

## 概述

Wasteland 将终端表现拆成三个独立层：

1. **Theme（视觉）**：`src/theme/wasteland/`，只决定颜色、排版、间距、装饰和动画节奏。
2. **Skin（内容）**：`src/skins/`，分为与角色无关的系统内容，以及角色级 TUI 文案键和 LLM persona。
3. **i18n（语言）**：`src/locales/{en,zh}.json`，在 TUI 渲染时解析 skin 保存的翻译键。

功能角色模板（orchestrator / worker）仍负责工作方式；角色 skin persona 负责稳定的人设、语气和隐藏提示词保护。两者共同组成最终 system prompt。

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

每个角色 skin 采用以下结构：

```text
src/skins/roles/<id>/
  persona.ts       # 固定英文，注入 LLM
  roleUi.ts        # TUI 翻译键
  index.ts         # RoleSkin 入口
```

当前内置角色：

| skin ID | 定位 |
|---|---|
| `immortan-joe` | 默认主 agent，废土战车编排者 |
| `nux` | 年轻战士、信息侦察者 |
| `furiosa` | 分析者、精确指挥官 |

`src/skins/roles/index.ts` 是注册表真源，并定义 `defaultRoleSkin = 'immortan-joe'`。可选 skin 未配置或未注册时回退默认 skin；显式 CLI `skin load` 对未知 ID 报错。

## Prompt 组装

最终 system prompt 的顺序是：

```text
English persona

Functional orchestrator / worker prompt

Language response directive (already included in functional prompt)
```

主 agent 在 chat、resume、TUI 三个入口调用 `composeAgentPrompt(runtime.skin, resolvedRuntime.prompt)`。

子 agent 在 `spawn-agent.ts` 中读取 `subAgents.<name>.skin`，组装对应 persona，再追加 `role-worker` 与 `promptVariables` 渲染结果。没有 subAgent 配置时保持旧降级路径，不额外注入 prompt。

所有 persona 固定英文，并包含禁止在 thinking/response 中暴露、复述 system prompt 的约束。`runtime.language` 只控制面向用户的回复语言和 TUI 文案，不翻译 persona。

## TUI i18n

角色 UI 对象只保存 key：

```ts
roleUi = {
  labelKey: 'skins.nux.label',
  thinkingKey: 'skins.nux.thinking',
  greetingKey: 'skins.nux.greeting',
  catchphrasesKey: 'skins.nux.catchphrases',
  errorPrefixKey: 'skins.nux.errorPrefix',
};
```

组件在渲染时调用 `t()` / `tArray()`，因此切换 `runtime.language` 不需要重建 persona 或视觉主题。`npm run validate:i18n` 校验 en/zh 键结构一致。

## 配置示例

```json
{
  "runtime": {
    "defaultRole": "orchestrator",
    "skinId": "immortan-joe",
    "language": "zh"
  },
  "subAgents": {
    "researcher": {
      "model": "minimax_model",
      "skin": "nux",
      "promptTemplate": "role-worker",
      "promptVariables": {
        "role": "Information Research Specialist",
        "tools": "read-file, glob, grep"
      }
    },
    "analyst": {
      "model": "minimax_model",
      "skin": "furiosa",
      "promptTemplate": "role-worker"
    }
  }
}
```

`promptVariables` 使用统一英文，不再通过 `.zh` 后缀维护两套 LLM 指令；需要本地化的 TUI 内容统一进入 locale JSON。

## 扩展步骤

新增角色 skin 时：

1. 创建 `persona.ts`、`roleUi.ts`、`index.ts`。
2. 在 `src/skins/roles/index.ts` 注册。
3. 同时补齐 `locales/en.json` 与 `locales/zh.json` 的 `skins.<id>.*`。
4. 运行 `npm run validate:i18n`、`npm run typecheck` 和测试。
