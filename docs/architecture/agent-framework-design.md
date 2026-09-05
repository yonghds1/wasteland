# AI Agent 框架设计文档

## 一、设计原则

本项目采用**业界通用的三层结构**定义 Agent 角色：

```
┌─────────────────────────────────────────────────────────────┐
│  Agent 角色 = 身份层 + 能力层 + 行为层                        │
├─────────────────────────────────────────────────────────────┤
│  身份层 (Identity)                                           │
│    - role: 角色描述，如 "Senior Software Developer"          │
│    - goal: 目标，如 "Write clean, maintainable code"         │
│    - backstory: 背景故事，定义行为模式和专长                  │
├─────────────────────────────────────────────────────────────┤
│  能力层 (Capabilities)                                       │
│    - tools: 可用工具列表                                      │
│    - constraints: 约束条件                                   │
├─────────────────────────────────────────────────────────────┤
│  行为层 (Behavior)                                           │
│    - workflow: 工作流程                                       │
│    - outputFormat: 输出格式要求                               │
└─────────────────────────────────────────────────────────────┘
```

### 业界参考

| 框架 | 采用模式 | 本项目对应 |
|------|---------|-----------|
| CrewAI | role/goal/backstory 三元组 | 身份层 |
| AutoGPT | tools/constraints/resources | 能力层 |
| LangChain | 模板化变量注入 | PromptTemplate |

---

## 二、类型定义

### RoleDefinition（角色定义）

```typescript
type RoleDefinition = {
  // === 身份层 ===
  name: string;           // 角色名称（引用用），如 "coder"
  role: string;           // 角色描述，如 "Senior Software Developer"
  goal: string;           // 目标
  backstory?: string;     // 背景故事

  // === 能力层 ===
  tools?: string[];       // 可用工具
  constraints?: string[]; // 约束条件

  // === 行为层 ===
  workflow?: string;      // 工作流程
  outputFormat?: string;  // 输出格式
};
```

### PromptTemplate（提示词模板）

```typescript
type PromptTemplate = {
  name: string;           // 模板名称
  id?: string;            // 模板 ID
  description?: string;   // 描述
  sections: PromptSection[];  // 段落列表
  variables?: Record<string, PromptVariableDef>;  // 变量定义
  defaults?: Record<string, unknown>;  // 默认值
};

type PromptSection = {
  id: string;             // 段落 ID
  content: string | { $ref: string };  // 内容或文件引用
  order?: number;         // 排序权重
};
```

---

## 三、内置角色模板

### 执行层角色

| 角色 ID | 描述 | 适用场景 |
|---------|------|---------|
| `role-chat` | 简单对话角色 | 日常问答 |
| `role-coder` | 代码编写角色 | 代码开发、调试、重构 |
| `role-planner` | 任务规划角色 | 项目规划、架构设计 |
| `role-reviewer` | 代码审查角色 | 代码评审、质量检查 |
| `role-researcher` | 信息收集角色 | 调研、分析 |

### 编排层角色

| 角色 ID | 描述 | 适用场景 |
|---------|------|---------|
| `role-orchestrator` | 多 agent 编排 | 任务分解、结果聚合 |
| `role-router` | 简单路由 | 任务分类、agent 选择 |
| `role-supervisor` | 并行监督 | 多 agent 并行执行 |

---

## 四、配置示例

### 4.1 基础配置

角色定义在 `.wasteland/roles.json`，`settings.json` 的 `multiAgent` 引用组合：

```jsonc
// .wasteland/roles.json
{
  "roles": {
    "developer": {
      "promptTemplate": "role-worker",
      "model": "qwen-max",
      "tools": "bash, read, edit, write",
      "skins": ["coder"]
    }
  }
}

// .wasteland/settings.json
{
  "multiAgent": {
    "coder": { "role": "developer", "skin": "coder" }
  },
  "runtime": {
    "defaultRole": "orchestrator"
  }
}
```

### 4.2 多 agent 编排配置

```jsonc
// .wasteland/roles.json
{
  "roles": {
    "orchestrator": { "promptTemplate": "role-orchestrator", "model": "qwen-max" },
    "developer": { "promptTemplate": "role-worker", "model": "qwen-max", "skins": ["coder"] },
    "analyst": { "promptTemplate": "role-worker", "model": "qwen-fast", "skins": ["scholar"] }
  }
}

// .wasteland/settings.json
{
  "multiAgent": {
    "main": { "role": "orchestrator", "skin": "warlord-stern" },
    "coder": { "role": "developer", "skin": "coder" },
    "reviewer": { "role": "analyst", "skin": "scholar" }
  },
  "runtime": {
    "defaultRole": "orchestrator"
  }
}
```

### 4.3 自定义角色

```jsonc
// .wasteland/roles.json
{
  "roles": {
    "custom": {
      "promptTemplate": {
        "name": "custom-role",
        "sections": [
          { "id": "identity", "content": "You are a Database Administrator." },
          { "id": "goal", "content": "Optimize database performance." }
        ]
      },
      "model": "qwen-max",
      "tools": "bash, read, sql-query",
      "skins": ["warlord-stern"]
    }
  }
}
```

> 变量系统（`promptVariables` / `{{placeholder}}`）已移除，模板内容直接写死。

---

## 五、组装流程

```
配置加载 → role 引用展开 → 模板解析 → 段落排序 → 格式包裹 → 输出

1. 配置加载
   - roles.json 加载角色定义（内置默认 + 用户级 + 项目级）
   - 字符串 ID → 查找内置角色模板
   - 内联对象 → 直接使用

2. role 引用展开
   - multiAgent[name].role 引用的角色定义展开合并进该条目
   - 条目显式字段优先

3. 模板解析
   - 解析模板结构（sections 数组）

4. 段落排序
   - 按 order 字段排序

5. 格式包裹
   - markdown：用 `## 标题` 包裹每个段落（默认）
   - xml：用 `<section id="...">` 包裹（runtime.promptFormat='xml'）
```

---

## 六、输出格式

### 示例：role-coder 输出

```xml
<section id="identity">
You are a Senior TypeScript Developer.
</section>

<section id="goal">
Your goal is: Write clean, type-safe code
</section>

<section id="backstory">
You are an experienced software developer who follows best practices...
</section>

<section id="workflow">
1. Understand the requirements
2. Plan the approach
3. Implement
4. Test and verify
</section>

<section id="tools">
Available tools:
bash, read, edit, write
</section>

<section id="constraints">
Constraints:
- Always test your changes
- Follow existing code style
</section>
```

---

## 七、文件结构

```
src/prompts/
├── index.ts                    # 公共导出
├── prompt-types.ts             # 类型定义
├── prompt-assembler.ts         # 组装器
├── variable-interpolator.ts    # 变量插值
└── role-templates.ts           # 预定义角色模板
```

---

## 八、API 参考

### 组装提示词

```typescript
import { assemblePrompt, ROLE_CODER } from "./prompts/index.js";

const prompt = assemblePrompt(
  ROLE_CODER,  // 或 "role-coder" 或自定义模板
  { cwd: process.cwd(), variables: {} },
  { role: "Custom Developer", tools: "bash, read" }
);
```

### 获取内置角色

```typescript
import { getBuiltinRole, listBuiltinRoles, isBuiltinRoleId } from "./prompts/index.js";

// 获取单个角色
const coder = getBuiltinRole("role-coder");

// 列出所有角色
const roles = listBuiltinRoles();

// 检查是否为内置角色
if (isBuiltinRoleId("role-coder")) {
  // ...
}
```

---

## 九、多 Agent 架构

### 架构图

```
┌─────────────────────────────────────────────────────────┐
│  Orchestrator (role-orchestrator)                       │
│  - 任务分解、agent 选择、结果聚合                         │
└─────────────────────────────────────────────────────────┘
         │                    │                    │
         ↓                    ↓                    ↓
    ┌─────────┐          ┌─────────┐          ┌─────────┐
    │ Coder   │          │Reviewer │          │Researcher│
    │(role-   │          │(role-   │          │(role-    │
    │ coder)  │          │reviewer)│          │researcher)│
    └─────────┘          └─────────┘          └─────────┘
```

### spawn_agent 使用

```typescript
// 编排者调用子 agent
spawn_agent({
  name: "coder",
  task: "Implement the authentication module with JWT support"
})

// 并行调用多个 agent
spawn_agent({ name: "coder", task: "Write unit tests" })
spawn_agent({ name: "reviewer", task: "Review the PR" })
```

---

## 十、迁移指南

### 从 SOLE 模式迁移

| 旧名称 | 新名称 |
|--------|--------|
| `sole-chat` | `role-chat` |
| `sole-coder` | `role-coder` |
| `sole-planner` | `role-planner` |
| `sole-reviewer` | `role-reviewer` |
| `sole-researcher` | `role-researcher` |
| `sole-orchestrator` | `role-orchestrator` |
| `sole-router` | `role-router` |
| `sole-supervisor` | `role-supervisor` |

### API 变更

| 旧 API | 新 API |
|--------|--------|
| `getBuiltinTemplate()` | `getBuiltinRole()` |
| `isBuiltinTemplateId()` | `isBuiltinRoleId()` |
| `listBuiltinTemplates()` | `listBuiltinRoles()` |
| `SOLE_CHAT` | `ROLE_CHAT` |
| `SOLE_CODER` | `ROLE_CODER` |

**注意**：旧 API 已标记为 `@deprecated`，仍可使用但建议迁移。
