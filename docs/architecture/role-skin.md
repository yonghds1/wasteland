# 角色与皮肤设计

## 概述

**角色(role)** 定义模型行为, **皮肤(skin)** 定义界面外观。两者正交、解耦：

- 角色提示词决定模型「怎么做事」「用什么语言回复」
- 皮肤决定界面「看起来像什么」「显示什么文案」
- 皮肤不进提示词, 换皮肤不改模型行为

## 设计原则

1. **皮肤不进提示词**：皮肤只影响 UI 显示（文案、视觉）, 不进入 system prompt, 不影响模型行为。
2. **角色功能性**：角色提示词是功能性指令（英文骨架 + 变量 + 语言指令）, 不绑皮肤人设。
3. **皮肤与角色正交**：`defaultRole`（行为）+ `skinId`（外观）独立配置。
4. **行为一致**：模型行为由角色提示词决定, 不受皮肤影响。换皮肤只改 UI, 模型回复始终一致。

## 角色体系

### 内置角色

| 角色 | 模板 id | 职责 |
|---|---|---|
| `orchestrator` | `role-orchestrator` | 主角色, 任务编排器（分解任务 -> spawn_agent 调度子角色 -> 整合结果） |
| `worker` | `role-worker` | 子角色模板, 通用执行者（通过变量配置不同专业方向） |

内置模板为功能性英文骨架 + 变量, **不含任何皮肤人设**。

### 用户角色

`settings.subAgents`：主子角色皆可覆盖/新增。

- 覆盖内置：`subAgents.orchestrator` 覆盖内置主角色
- 新增角色：`subAgents.my-role` 新增, `defaultRole` 指向它

### resolveRole 注册表（无特例）

```
name = requestedRoleName ?? settings.runtime.defaultRole
1. 用户优先：if name in subAgents -> subAgents[name]
2. 内置：    if name == 'orchestrator' -> BUILTIN_ORCHESTRATOR_CONFIG
            if name == 'worker'       -> BUILTIN_WORKER_CONFIG
3. 未定义：  throw roleNotDefined
```

无 `immortan-joe` 等硬编码特例, 加角色不改代码。

### defaultRole 语义

- 默认 `'orchestrator'`
- **应是编排角色**（orchestrator 或自定义编排角色）, 这样能调度子角色
- `worker` 是子角色模板, 作 `defaultRole` 时无 `spawn_agent` 委托、不能编排（不鼓励, 但代码不强制限制——用户可选择单角色无编排模式）

### 语言指令

`resolveChatRuntime` 按 `settings.runtime.language` 在提示词末尾注入回复语言指令：

- `zh`：`Always respond to the user in Simplified Chinese (简体中文).`
- `en`：`Always respond to the user in English.`

所有角色统一注入。提示词正文为英文骨架（模型遵循稳定）, 语言指令控制输出语言。

### orchestrator agents 动态

内置 orchestrator 的 `agents` 清单**动态从 `settings.subAgents` 生成**（本地化 description）, 反映实际可用子角色。用户加子角色, orchestrator 提示词自动列出。用户自定义 `agents` 变量时尊重用户配置。

## 皮肤体系

### 内置皮肤

- `immortan-joe`：废土风格（默认）
- 皮肤**内置**：文案在 `locales/{en,zh}.json` 的 `skin` 段（双语）, `getSkinWithLanguage(language)` 按 language 取
- `loadSkin(skinId, language)` 查内置注册表, **不支持外部 skin.json**（内置化, 避免外部皮肤多语言缺口）

### skinId（与角色独立）

`runtime.skinId`（默认 `'immortan-joe'`）, 与 `defaultRole` 解耦：

- `defaultRole` 决定行为（角色提示词）
- `skinId` 决定外观（皮肤文案/视觉）
- 两者独立配置, 正交

### TUI 皮肤接通

| 组件 | 接通字段 |
|---|---|
| StatusBar | `ui.banner.title`（标题）、`ui.messages.thinking`（思考提示） |
| ChatMessageList | `roles.main.greeting` + `catchphrases`（欢迎）、`ui.labels.*`（消息标签）、`ui.messages.thinking` |
| ChatInputBar | `ui.prompts.input`（输入提示符, 如 `wasteland>`） |
| useRuntimeEvents | `ui.messages.success`（编排完成）、`ui.messages.error`（失败）、`roles.workers.*.greeting`（子角色出场）、`roles.workers.*.catchphrases`（子角色完成） |

所有接通均 `skin?.field ?? t('tui.*')` fallback, 无皮肤时用通用文案。

## 语气：霸主恩赐

### 角色关系

```
废土幸存者（用户）许愿
    ↓
不死老乔（霸主, 主 agent）恩赐, 指挥 War Boys
    ↓
War Boys（子 agent）奉不死老乔之命执行
    ↓
如你所愿, 圣殿已交付（success）/ 愿望未达成, War Boys 受清算（error）
```

- **不死老乔**：废土霸主, 恩赐者, 指挥 War Boys 实现愿望
- **用户（废土幸存者）**：祈求者, 向霸主许愿
- **War Boys（子角色）**：奉不死老乔之命执行

### 主角色（不死老乔）文案

| 字段 | zh |
|---|---|
| greeting | 我允许你许愿。 |
| welcome | 欢迎来到圣殿, 我允许你许愿。 |
| thinking | 不死老乔正在审视你的愿望... |
| success | 如你所愿, 圣殿已交付。 |
| error | 你的愿望未能达成, War Boys 将受清算。 |
| catchphrases | 我即恩赐!/许愿吧, 我成全!/圣殿之恩, 降临于你!/奉我之恩, 废土得生! |
| labels | 废土幸存者 / 不死老乔 / 圣殿 |

### 子角色（War Boys）文案

| 角色 | greeting zh |
|---|---|
| researcher | 奉不死老乔之命, 我去废土搜寻。 |
| developer | 奉不死老乔之命, 我在熔炉锻造代码。 |
| analyst | 奉不死老乔之命, 我分析废土的模式。 |
| tester | 奉不死老乔之命, 我以战斗验证。 |

catchphrases 为 War Boys 口号（如「我找到了不死老乔所要的东西!」「代码就是法律!」）。

## 配置

### settings.json

```json
{
  "runtime": {
    "defaultRole": "orchestrator",
    "skinId": "immortan-joe",
    "defaultModel": "main_model",
    "language": "zh"
  },
  "subAgents": {
    "researcher": { "model": "...", "promptTemplate": "role-worker", "promptVariables": {...} }
  }
}
```

### 语言来源（优先级高 -> 低）

1. 环境变量 `WASTELAND_LANGUAGE` / `JOE_LANGUAGE`
2. 项目级 `.wasteland/settings.json` 的 `runtime.language`
3. 用户级 `~/.wasteland/settings.json` 的 `runtime.language`
4. 内置默认 `'en'`（`DEFAULT_LANGUAGE` 常量, SSOT）

支持语言由 `locales/` 目录动态扫描（当前 `en`、`zh`）。

## 扩展

### 加角色

- **子角色**：`settings.subAgents` 加一项, 用 `role-worker` 模板 + `promptVariables`（支持 `.zh` 后缀本地化）
- **主角色**：`subAgents.orchestrator` 覆盖内置, 或 `subAgents.my-orchestrator` 新增 + `defaultRole` 指向它

### 加内置皮肤

1. `locales/{en,zh}.json` 的 `skin` 段加该皮肤双语文案
2. `skin-loader.ts` 的 `getSkinWithLanguage` 加内置注册项
3. `loadSkin` 支持 `skinId === '<new>'`

（外部 skin.json 自定义皮肤不支持, 内置化）

## 备注

- **`skin.roles.main.id='immortan-joe'`**：皮肤主角色标识（装饰）, 非角色 id。`commands/skin.ts` 作 fallback 用（`main.name ?? main.id`）。
- **`cli.ts program.name('wasteland')`**：硬编码 CLI 命令名, 与 `skin.cli.commandName` 一致。
- **streaming / loading 动画**：回复流式内容直接显示（标签已皮肤化）, loading 动画（`⏳`）硬编码（skin 无 spinner 帧, 未皮肤化）。
- **两套 i18n 机制并存**：`t(key)`（locales json, UI 文案用）+ `getLocalizedValue(obj, key)`（配置对象 `.zh` 后缀, 子角色 `promptVariables` 用）。数据源不同, 都依赖 `currentLanguage`。
