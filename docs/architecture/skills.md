# 技能系统架构

## 概述

技能(Skills)是 RxCLI 中的高级工作流抽象,用于编排多个工具调用和复杂操作。与工具(Tools)不同,技能:

- 可以编排多个工具调用
- 可以被用户在 `.wasteland/skills/` 中自定义
- 通过 `/skill-name` 斜杠命令调用
- 支持参数、别名和分类

## 架构层次

```
用户输入: /init --template minimal
    ↓
SkillExecutor (技能执行器)
    ↓
SkillRegistry (技能注册表)
    ↓
Skill (技能实现)
    ↓
ToolRegistry (工具调用)
```

## 核心组件

### 1. SkillDefinition (技能定义)

描述技能的元数据:

```typescript
type SkillDefinition = {
  name: string;              // 技能名称
  description: string;       // 描述
  riskLevel: SkillRiskLevel; // 风险等级
  parameters?: Record<string, SkillParameterDef>; // 参数定义
  aliases?: string[];        // 别名
  category?: string;         // 分类
  examples?: string[];       // 使用示例
};
```

### 2. Skill (技能接口)

所有技能必须实现的接口:

```typescript
interface Skill {
  readonly definition: SkillDefinition;
  execute(args: SkillArgs, context: SkillExecutionContext): Promise<SkillResult>;
}
```

### 3. SkillRegistry (技能注册表)

管理所有已注册的技能:

- 按名称或别名查找技能
- 列出所有技能
- 检测是否为技能命令

### 4. SkillExecutor (技能执行器)

协调技能执行:

- 解析参数
- 验证参数
- 权限检查
- 执行技能
- 发出运行时事件

### 5. SkillDiscovery (技能发现)

从文件系统自动发现和加载技能:

- 项目级: `.wasteland/skills/`
- 用户级: `~/.wasteland/skills/`

## 技能来源

技能可以来自三个来源:

1. **内置技能** (`builtin`): 随 RxCLI 发布的默认技能
2. **项目技能** (`project`): 项目 `.wasteland/skills/` 目录中的技能
3. **用户技能** (`user`): 用户全局 `~/.wasteland/skills/` 目录中的技能

## 内置技能

### 系统技能

- `/help` (`/h`, `/?`): 显示帮助信息和可用命令列表
- `/status` (`/stat`, `/info`): 显示当前会话状态和统计信息
- `/tools` (`/tls`): 显示所有可用工具的详细信息

### 项目技能

- `/init` (`/i`): 初始化 CLAUDE.md 项目上下文文件
- `/context` (`/ctx`, `/info`): 显示项目上下文和结构概览

## 技能文件格式

### JSON 格式

```json
{
  "name": "my-skill",
  "description": "我的自定义技能",
  "riskLevel": "read",
  "aliases": ["ms"],
  "category": "custom",
  "parameters": {
    "target": {
      "type": "string",
      "description": "目标文件",
      "required": true
    }
  },
  "steps": [
    {
      "tool": "read-file",
      "input": { "path": "{{target}}" },
      "saveAs": "content"
    }
  ],
  "template": "文件内容:\n{{content}}"
}
```

### TypeScript 格式

```typescript
import type { Skill } from "rx-cli";

export default {
  definition: {
    name: "my-skill",
    description: "我的自定义技能",
    riskLevel: "read",
  },
  async execute(args, context) {
    // 实现逻辑
    return { status: "success", output: "完成" };
  },
} satisfies Skill;
```

### 目录格式

```
.wasteland/skills/my-skill/
├── skill.json        # 技能定义
└── handler.ts        # 可选的处理器
```

## 参数系统

### 参数定义

```typescript
type SkillParameterDef = {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];      // 仅 string 类型
  items?: SkillParameterDef;  // 仅 array 类型
  properties?: Record<string, SkillParameterDef>; // 仅 object 类型
};
```

### 参数解析

技能参数支持两种形式:

1. **位置参数**: `/skill value1 value2`
2. **命名参数**: `/skill --name value --flag`

解析结果:

```typescript
type SkillArgs = {
  positional: string[];         // 位置参数
  named: Record<string, unknown>; // 命名参数
  raw: string;                  // 原始输入
};
```

## 执行流程

```
1. 用户输入: /init --template minimal
    ↓
2. SkillExecutor 检测技能命令
    ↓
3. 解析参数: { named: { template: "minimal" }, positional: [] }
    ↓
4. 验证参数
    ↓
5. 应用默认值
    ↓
6. 创建执行上下文
    ↓
7. 发出 skill_started 事件
    ↓
8. 执行技能: skill.execute(args, context)
    ↓
9. 发出 skill_result 事件
    ↓
10. 返回结果
```

## 事件集成

技能执行会发出以下运行时事件:

```typescript
// 技能开始
type skill_started = {
  type: "skill_started";
  sessionId: string;
  turn: number;
  skillName: string;
  args: SkillArgs;
};

// 技能结果
type skill_result = {
  type: "skill_result";
  sessionId: string;
  turn: number;
  skillName: string;
  result: SkillResult;
};
```

## 权限控制

技能的风险等级影响权限决策:

- `read`: 只读操作,通常不需要确认
- `write`: 写入操作,可能需要确认
- `execute`: 执行操作,通常需要确认

## 最佳实践

### 1. 技能设计

- 单一职责: 每个技能只做一件事
- 清晰描述: 提供准确的描述和示例
- 合理分类: 使用 category 组织技能
- 适当别名: 提供简短的别名方便使用

### 2. 参数设计

- 必需参数: 只将真正必需的参数标记为 required
- 默认值: 为可选参数提供合理的默认值
- 参数验证: 使用 enum 限制可选值
- 帮助文本: 为每个参数提供 description

### 3. 错误处理

- 清晰错误: 返回明确的错误信息
- 建议修复: 尽可能提供修复建议
- 优雅降级: 在部分失败时继续执行

### 4. 输出格式

- 结构化: 使用 Markdown 格式化输出
- 简洁明了: 避免过多冗余信息
- 分段展示: 使用标题和列表组织内容

## 扩展技能系统

### 添加新的内置技能

1. 在 `src/skills/skills/` 创建新文件
2. 实现 Skill 接口
3. 在 `src/skills/default-skills.ts` 注册

### 添加自定义技能

1. 在项目 `.wasteland/skills/` 创建技能文件
2. 使用 JSON 或 TypeScript 格式
3. 重启 RxCLI 自动加载

## 调试技能

使用 `--debug` 标志查看技能执行详情:

```bash
wasteland chat --debug --message "/init"
```

在 TUI 的调试页面可以看到:
- 技能开始事件
- 参数解析结果
- 工具调用详情
- 执行结果

## 未来扩展

- [ ] 技能组合: 支持技能调用其他技能
- [ ] 条件执行: 基于条件选择执行路径
- [ ] 并行执行: 支持并行执行多个步骤
- [ ] 交互式技能: 支持技能请求用户输入
- [ ] 技能市场: 共享和发现社区技能
