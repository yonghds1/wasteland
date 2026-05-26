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

```json
{
  "roles": {
    "coder": {
      "model": "qwen-max",
      "promptTemplate": "role-coder",
      "promptVariables": {
        "role": "Senior TypeScript Developer",
        "goal": "Write clean, type-safe code",
        "tools": "bash, read, edit, write"
      }
    }
  },
  "runtime": {
    "defaultRole": "coder"
  }
}
```

### 4.2 多 agent 编排配置

```json
{
  "roles": {
    "orchestrator": {
      "model": "qwen-max",
      "promptTemplate": "role-orchestrator",
      "promptVariables": {
        "agents": "- coder: code writing\n- reviewer: code review\n- researcher: info gathering"
      }
    },
    "coder": {
      "model": "qwen-max",
      "promptTemplate": "role-coder"
    },
    "reviewer": {
      "model": "qwen-fast",
      "promptTemplate": "role-reviewer"
    }
  },
  "runtime": {
    "defaultRole": "orchestrator"
  }
}
```

### 4.3 自定义角色

```json
{
  "roles": {
    "custom": {
      "model": "qwen-max",
      "promptTemplate": {
        "name": "custom-role",
        "sections": [
          { "id": "identity", "content": "You are a {{role}}.", "order": 1 },
          { "id": "goal", "content": "Your goal is: {{goal}}", "order": 2 },
          { "id": "tools", "content": "Available tools: {{tools}}", "order": 3 }
        ]
      },
      "promptVariables": {
        "role": "Database Administrator",
        "goal": "Optimize database performance",
        "tools": "bash, read, sql-query"
      }
    }
  }
}
```

---

## 五、组装流程

```
配置加载 → 模板解析 → 变量合并 → 内容插值 → 段落排序 → XML 包裹 → 输出

1. 配置加载
   - 字符串 ID → 查找内置角色模板
   - 文件路径 → 加载 JSON 文件
   - 内联对象 → 直接使用

2. 模板解析
   - 解析模板结构
   - 合并 defaults 和 promptVariables

3. 变量合并（优先级）
   - template.defaults (最低)
   - context.variables
   - promptVariables (最高)

4. 内容插值
   - 执行 {{variable}} 替换
   - 支持 {{nested.path}} 和 {{var|default:value}}

5. 段落排序
   - 按 order 字段排序

6. XML 包裹
   - 每个段落用 <section id="..."> 包裹
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
