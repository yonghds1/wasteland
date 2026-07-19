# 国际化 (i18n) 规范

## 概述

本文档定义了 wasteland 项目的国际化规范，确保所有用户界面文本支持中英文双语，并防止硬编码问题。

## 核心原则

**代码里不出现任何用户可见的文本，全部通过翻译键查表。**

对于配置文件中的用户可见文本，使用**语言后缀覆盖**：`key.zh` / `key.en`。

## 支持的语言

- 中文 (zh)
- 英文 (en)

## 语言使用规范

### 1. 日志消息（console.log/warn/error）

**统一使用中文**，通过 `t()` 函数获取。

```typescript
// ✅ 正确
console.log(t("mcp.serverStarted", { name }));
console.warn(t("tui.failedToLoadSkin"), error);
console.error(t("tui.runtimeEventStreamError"), error);

// ❌ 错误
console.log(`[MCP] Server ${name} started`);
console.warn("Failed to load skin:", error);
```

### 2. 错误消息（throw new Error）

**统一使用中文**，通过 `t()` 函数获取。

```typescript
// ✅ 正确
throw new Error(t("mcp.serverNotFound", { name }));
throw new Error(t("config.cannotParsePromptTemplate", { template }));

// ❌ 错误
throw new Error(`MCP server not found: ${name}`);
throw new Error("配置文件格式错误");
```

### 3. 用户界面文本（UI）

**根据当前语言动态切换**，通过 `t()` 函数获取。

```typescript
// ✅ 正确 - 根据当前语言切换
lines.push(`# ${t("skills.help.title")}`);
lines.push(`${t("skills.status.items")} ${count}`);

// ❌ 错误 - 硬编码语言
lines.push(`# 帮助`);
lines.push(`${count} 个`);
```

### 4. 日期格式

**根据当前语言动态选择 locale**。

```typescript
// ✅ 正确
const lang = getLanguage();
const locale = lang === "zh" ? "zh-CN" : "en-US";
date.toLocaleString(locale, options);

// ❌ 错误
date.toLocaleString("zh-CN", options);  // 硬编码中文环境
```

### 5. 配置文件中的文本

使用**语言后缀覆盖**：`key.zh` / `key.en`。

```json
// ✅ 正确
{
  "description": "Research & Information Gathering",
  "description.zh": "信息收集与研究"
}

// ❌ 错误
{
  "description": "Research & Information Gathering"
  // 缺少中文翻译
}
```

## 翻译文件位置

```
src/locales/
├── en.json        # 英文翻译（唯一真实来源）
├── zh.json        # 中文翻译（唯一真实来源）
├── i18n.ts        # i18n 模块
└── index.ts       # 导出模块
```

## 翻译键命名规范

### 1. 层级结构

翻译键采用点分隔的层级结构，按功能模块组织：

```
<模块>.<子模块>.<功能>.<具体文本>
```

示例：
- `skills.help.title` - 技能帮助标题
- `commands.sessions.list.description` - sessions 命令列表描述
- `tools.editFile.needRelativePath` - edit-file 工具错误提示

### 2. 模块划分

| 模块 | 说明 | 示例键 | 语言要求 |
|------|------|--------|----------|
| `cli` | CLI 入口 | `cli.description`, `cli.devDescription` | 根据语言切换 |
| `skin` | 皮肤系统 | `skin.name`, `skin.roles.main.name` | 根据语言切换 |
| `commands` | CLI 命令 | `commands.chat.description` | 根据语言切换 |
| `tui` | TUI 界面 | `tui.header.session` | 根据语言切换 |
| `skills` | 技能系统 | `skills.help.title` | 根据语言切换 |
| `tools` | 工具相关 | `tools.editFile.success` | 根据语言切换 |
| `runtime` | 运行时 | `runtime.toolNotFound` | 根据语言切换 |
| `providers` | Provider 相关 | `providers.openai.missingModel` | 根据语言切换 |
| `ui` | UI 组件 | `ui.spinner.thinking` | 根据语言切换 |
| `mcp` | MCP 相关 | `mcp.serverStarted`, `mcp.startupFailed` | 统一中文 |
| `config` | 配置相关 | `config.cannotParsePromptTemplate` | 统一中文 |
| `prompts` | 提示词相关 | `prompts.builtinRoleNotFound` | 统一中文 |
| `utils` | 工具函数 | `utils.failedToRunScript` | 统一中文 |

### 3. 命名规则

- 使用 camelCase 命名
- 描述性文本使用完整的句子
- 错误消息以 `error` 结尾或包含 `Error`
- 参数描述使用 `Desc` 后缀（如 `formatDesc`）
- 使用复数后缀 `Items` 表示数量单位

## 使用方法

### 1. 导入翻译函数

```typescript
import { t, getLanguage, getSupportedLanguages } from "../locales/index.js";
```

### 2. 基本使用

```typescript
// 获取翻译文本
const title = t("skills.help.title");

// 带参数的翻译
const message = t("commands.sessions.list.found", { count: "5" });
```

### 3. 获取当前语言

```typescript
const lang = getLanguage(); // 返回当前语言代码

// 根据语言选择不同内容
if (lang === "zh") {
  // 中文逻辑
} else {
  // 英文逻辑
}
```

### 4. 获取支持的语言列表

```typescript
const supported = getSupportedLanguages(); // ["en", "zh"]
```

### 5. 模板国际化

模板内容应放在翻译文件中，代码只做查表：

```typescript
// ✅ 正确：从翻译文件获取模板
function getTemplate(template: string): string {
  return t(`skills.init.templates.${template}`);
}

// ❌ 错误：代码里硬编码模板
const TEMPLATE_ZH = `# 中文模板...`;
const TEMPLATE_EN = `# English Template...`;
```

### 6. 配置文件中的语言后缀覆盖

对于配置文件（如 settings.json）中的用户可见文本，使用语言后缀覆盖：

```json
{
  "subAgents": {
    "researcher": {
      "description": "Research & Information Gathering",
      "description.zh": "信息收集与研究",
      "promptVariables": {
        "role": "Information Research Specialist",
        "role.zh": "信息收集专家"
      }
    }
  }
}
```

代码中使用 `getLocalizedValue` 函数获取本地化值：

```typescript
import { getLocalizedValue } from "../locales/index.js";

const description = getLocalizedValue(agent, "description");
// 英文环境返回 "Research & Information Gathering"
// 中文环境返回 "信息收集与研究"
```

## 防止硬编码的规范

### 1. 代码中禁止出现用户可见的中文/英文文本

❌ 错误示例：
```typescript
lines.push(`${count} 个`);
lines.push("错误信息");
console.log("Loading...");
```

✅ 正确示例：
```typescript
lines.push(`${count} ${t("skills.status.items")}`);
lines.push(t("runtime.toolFailed"));
console.log(t("ui.spinner.loading"));
```

### 2. 参数描述必须使用翻译函数

❌ 错误示例：
```typescript
parameters: {
  format: {
    type: "string",
    description: "输出格式: simple, detailed, json",
  },
}
```

✅ 正确示例：
```typescript
parameters: {
  format: {
    type: "string",
    description: t("skills.status.formatDesc"),
  },
}
```

### 3. 模板内容必须放在翻译文件中

❌ 错误示例：
```typescript
const DEFAULT_TEMPLATE = `# 项目上下文
## 概述
{description}
...`;
```

✅ 正确示例：
```typescript
// zh.json
{
  "skills": {
    "init": {
      "templates": {
        "default": "# 项目上下文\n\n## 概述\n{description}..."
      }
    }
  }
}

// 代码中
function getTemplate(template: string): string {
  return t(`skills.init.templates.${template}`);
}
```

### 4. 错误消息必须使用翻译函数（中文）

❌ 错误示例：
```typescript
throw new Error("MCP server not found");
console.error("Runtime event stream error:", error);
```

✅ 正确示例：
```typescript
throw new Error(t("mcp.serverNotFound", { name }));
console.error(t("tui.runtimeEventStreamError"), error);
```

**注意**：配置验证错误（如 load-settings.ts）可能在 i18n 初始化之前执行，此时需要保留硬编码文本，或重构为延迟初始化。

### 5. 日志消息必须使用翻译函数（中文）

❌ 错误示例：
```typescript
console.log(`[MCP] Server ${name} started`);
console.warn("Failed to load skin:", error);
```

✅ 正确示例：
```typescript
console.log(t("mcp.serverStarted", { name }));
console.warn(t("tui.failedToLoadSkin"), error);
```

### 6. 日期格式必须根据语言动态选择

❌ 错误示例：
```typescript
date.toLocaleString("zh-CN", options);  // 硬编码中文环境
```

✅ 正确示例：
```typescript
const lang = getLanguage();
const locale = lang === "zh" ? "zh-CN" : "en-US";
date.toLocaleString(locale, options);
```

### 7. 测试断言必须支持翻译键

❌ 错误示例：
```javascript
assert.ok(error.includes("缺少 model"));
```

✅ 正确示例：
```javascript
assert.ok(
  error.includes("missingModel") || error.includes("缺少 model"),
  "错误信息应该包含预期内容"
);
```

## 检查流程

### 1. 构建时检查

运行翻译完整性校验：

```bash
npm run validate:i18n
```

或在 `check` 脚本中自动执行：

```bash
npm run check  # 包含 typecheck、validate:i18n、test
```

### 2. 代码审查清单

- [ ] 所有用户可见文本是否使用 `t()` 函数？
- [ ] 所有参数描述是否使用 `t()` 函数？
- [ ] 所有模板内容是否在翻译文件中？
- [ ] 所有错误消息是否使用 `t()` 函数（中文）？
- [ ] 所有日志消息是否使用 `t()` 函数（中文）？
- [ ] 日期格式是否根据语言动态选择？
- [ ] 配置文件中的文本是否使用语言后缀覆盖？
- [ ] 翻译键是否在所有语言文件中都存在？

### 3. 翻译完整性校验

运行校验脚本：

```bash
node scripts/validate-i18n.js
```

输出示例：

```
🔍 正在检查翻译完整性...

📁 找到 2 个翻译文件: en.json, zh.json

📋 基准语言: en
📋 基准键数量: 490

✅ zh: 键结构一致

✅ 翻译完整性检查通过
```

## 最佳实践

### 1. 翻译键组织

- 按功能模块组织翻译键
- 保持层级清晰，便于查找
- 避免过深的嵌套（建议不超过 4 层）

### 2. 翻译内容

- 保持翻译简洁明了
- 使用一致的术语
- 考虑不同语言的文本长度差异

### 3. 参数插值

使用 `{{param}}` 语法进行参数插值：

```json
{
  "found": "Found {{count}} sessions:"
}
```

```typescript
t("commands.sessions.list.found", { count: "5" });
// 输出: "Found 5 sessions:"
```

### 4. 数量单位

为数量单位创建独立的翻译键：

```json
{
  "items": "条",
  "available": "个可用"
}
```

英文中数量单位通常为空或使用空格：

```json
{
  "items": "",
  "available": " available"
}
```

## 添加新翻译的步骤

1. 在 `src/locales/zh.json` 中添加中文翻译
2. 在 `src/locales/en.json` 中添加英文翻译
3. 确保键名一致
4. 在代码中使用 `t()` 函数获取翻译
5. 更新测试代码以支持翻译键
6. 运行检查脚本确认无硬编码

## 测试规范

测试代码应该同时支持翻译键和硬编码文本：

```javascript
assert.ok(
  error.includes("translationKey") || error.includes("硬编码文本"),
  "错误信息应该包含预期内容"
);
```

## 维护指南

### 定期检查

- 定期运行检查脚本
- 定期检查翻译完整性
- 确保新增功能都有对应的翻译
- 更新过时的翻译内容

### 翻译审查

- 新增翻译需要双语审查
- 确保翻译准确传达原意
- 保持术语一致性

## 示例

### 完整的技能定义示例

```typescript
export const exampleSkill: Skill = {
  definition: {
    name: "example",
    description: t("skills.example.description"),
    riskLevel: "read",
    parameters: {
      format: {
        type: "string",
        description: t("skills.example.formatDesc"),
        default: "simple",
      },
    },
    examples: [
      "/example",
      "/example --format detailed",
    ],
  },

  async execute(args, context): Promise<SkillResult> {
    const format = args.named.format as string;
    const lines: string[] = [];

    lines.push(`# ${t("skills.example.title")}`);
    lines.push(`${t("skills.example.count")} ${context.history.length} ${t("skills.example.items")}`);

    return {
      status: "success",
      output: lines.join("\n"),
    };
  },
};
```

对应的翻译文件：

**zh.json:**
```json
{
  "skills": {
    "example": {
      "description": "示例技能",
      "formatDesc": "输出格式: simple, detailed",
      "title": "示例标题",
      "count": "数量:",
      "items": "个"
    }
  }
}
```

**en.json:**
```json
{
  "skills": {
    "example": {
      "description": "Example skill",
      "formatDesc": "Output format: simple, detailed",
      "title": "Example Title",
      "count": "Count:",
      "items": ""
    }
  }
}
```
