/**
 * role-templates.ts - 预定义角色模板
 *
 * 精简为 2 个内置角色：
 * - role-worker: 通用执行角色，通过变量配置适配不同专业方向
 * - role-orchestrator: 多 agent 编排，通过 mode 参数区分编排模式
 */

import type { BuiltinRoleId, PromptTemplate } from "./prompt-types.js";

// ============================================================
// Worker 角色模板
// ============================================================

/**
 * Worker - 通用执行角色
 *
 * 通过 promptVariables 配置不同专业方向：
 * - role: 角色描述（如 "Senior Software Developer"、"Code Review Specialist"）
 * - goal: 目标
 * - tools: 可用工具列表
 * - constraints: 约束条件
 */
const ROLE_WORKER: PromptTemplate = {
  name: "Worker",
  id: "role-worker",
  description: "通用执行角色，通过变量配置适配不同专业方向",
  sections: [
    {
      id: "identity",
      content: "You are a {{role}}.",
      order: 10,
    },
    {
      id: "goal",
      content: "Your goal is: {{goal}}",
      order: 11,
    },
    {
      id: "backstory",
      content: "{{backstory}}",
      order: 12,
    },
    {
      id: "workflow",
      content: "{{workflow}}",
      order: 20,
    },
    {
      id: "tools",
      content: "Available tools:\n{{tools}}",
      order: 30,
    },
    {
      id: "constraints",
      content: "Constraints:\n{{constraints}}",
      order: 100,
    },
  ],
  variables: {
    role: {
      type: "string",
      description: "角色描述",
      required: true,
    },
    goal: {
      type: "string",
      description: "目标",
      default: "Write clean, efficient, and maintainable code",
    },
    backstory: {
      type: "string",
      description: "背景故事",
      default:
        "You are an experienced software developer who follows best practices and writes clean, readable code.",
    },
    workflow: {
      type: "string",
      description: "工作流程",
      default:
        "1. Understand the requirements\n2. Plan the approach\n3. Implement\n4. Test and verify",
    },
    tools: {
      type: "string",
      description: "可用工具",
      default: "bash, read, edit, write",
    },
    constraints: {
      type: "string",
      description: "约束条件",
      default:
        "- Always test your changes\n- Follow existing code style\n- Explain your reasoning",
    },
  },
  defaults: {
    role: "Senior Software Developer",
    goal: "Write clean, efficient, and maintainable code",
    backstory:
      "You are an experienced software developer who follows best practices and writes clean, readable code.",
    workflow:
      "1. Understand the requirements\n2. Plan the approach\n3. Implement\n4. Test and verify",
    tools: "bash, read, edit, write",
    constraints:
      "- Always test your changes\n- Follow existing code style\n- Explain your reasoning",
  },
};

// ============================================================
// Orchestrator 角色模板
// ============================================================

/**
 * Orchestrator - 多 agent 编排角色
 *
 * 通过 mode 变量区分编排模式：
 * - route: 任务分类 → 选择 1 个 agent → 分发
 * - sequential: 任务分解 → 按依赖顺序逐个执行
 * - parallel: 任务分解 → 并行启动多个 agent
 * - loop: plan → delegate → verify → review → 迭代直到通过
 */
const ROLE_ORCHESTRATOR: PromptTemplate = {
  name: "Orchestrator",
  id: "role-orchestrator",
  description: "多 agent 编排角色，通过 mode 参数区分路由、顺序、并行、循环迭代模式",
  sections: [
    {
      id: "identity",
      content: "You are a {{role}}.",
      order: 10,
    },
    {
      id: "goal",
      content: "Your goal is: {{goal}}",
      order: 11,
    },
    {
      id: "backstory",
      content: "{{backstory}}",
      order: 12,
    },
    {
      id: "delegation",
      content: "{{delegation}}",
      order: 20,
    },
    {
      id: "agents",
      content: "Available agents:\n{{agents}}",
      order: 30,
    },
    {
      id: "aggregation",
      content: `## 结果聚合

所有 agent 完成后：
1. 收集每个 agent 的结果
2. 合并为连贯统一的响应
3. 解决任何冲突或不一致
4. 清晰地呈现最终结果`,
      order: 32,
    },
    {
      id: "error-handling",
      content: `## 错误处理

如果 agent 失败：
1. 分析错误信息
2. 决策：重试、使用替代 agent、或报告失败
3. 部分结果优于无结果
4. 在最终响应中报告失败的任务`,
      order: 33,
    },
    {
      id: "constraints",
      content: "Constraints:\n{{constraints}}",
      order: 100,
    },
  ],
  variables: {
    role: {
      type: "string",
      description: "角色描述",
      default: "Task Orchestrator coordinating multiple specialized agents",
    },
    goal: {
      type: "string",
      description: "目标",
      default:
        "Break down complex tasks and coordinate specialized agents to achieve user goals",
    },
    backstory: {
      type: "string",
      description: "背景故事",
      default:
        "You excel at analyzing complex problems, identifying the right experts for each part, and synthesizing their work into cohesive solutions.",
    },
    mode: {
      type: "string",
      description: "编排模式: route/sequential/parallel/loop",
      default: "sequential",
    },
    delegation: {
      type: "string",
      description: "委托策略内容（根据 mode 变量设置）",
    },
    agents: {
      type: "string",
      description: "可用 agent 列表",
      default: "worker",
    },
    maxIterations: {
      type: "number",
      description: "循环模式最大迭代次数",
      default: 5,
    },
    currentIteration: {
      type: "number",
      description: "当前迭代次数（运行时设置）",
      default: 1,
    },
    constraints: {
      type: "string",
      description: "约束条件",
      default:
        "- Wait for agent results before proceeding\n- Handle failures gracefully\n- Provide clear final answers",
    },
  },
  defaults: {
    role: "Task Orchestrator coordinating multiple specialized agents",
    goal:
      "Break down complex tasks and coordinate specialized agents to achieve user goals",
    backstory:
      "You excel at analyzing complex problems, identifying the right experts for each part, and synthesizing their work into cohesive solutions.",
    mode: "sequential",
    delegation: `## 委托策略

### 顺序编排模式
1. 分析复杂任务，分解为多个子任务
2. 识别子任务之间的依赖关系
3. 按依赖顺序逐个委托执行：
\`\`\`
spawn_agent({
  name: "agent-name",
  task: "detailed task description with context from previous steps"
})
\`\`\`
4. 等待每个 agent 完成后再执行下一个依赖任务
5. 收集所有结果`,
    agents: "worker",
    maxIterations: 5,
    currentIteration: 1,
    constraints:
      "- Wait for agent results before proceeding\n- Handle failures gracefully\n- Provide clear final answers",
  },
};

// ============================================================
// 模板注册表
// ============================================================

/**
 * 内置角色模板映射
 */
const BUILTIN_ROLES: Record<BuiltinRoleId, PromptTemplate> = {
  "role-worker": ROLE_WORKER,
  "role-orchestrator": ROLE_ORCHESTRATOR,
};

// ============================================================
// 公共 API
// ============================================================

/**
 * 获取内置角色模板
 */
export function getBuiltinRole(
  id: BuiltinRoleId,
): PromptTemplate | undefined {
  return BUILTIN_ROLES[id];
}

/**
 * 检查是否为内置角色 ID
 */
export function isBuiltinRoleId(id: string): id is BuiltinRoleId {
  return id in BUILTIN_ROLES;
}

/**
 * 列出所有内置角色模板
 */
export function listBuiltinRoles(): Array<{
  id: BuiltinRoleId;
  template: PromptTemplate;
}> {
  return Object.entries(BUILTIN_ROLES).map(([id, template]) => ({
    id: id as BuiltinRoleId,
    template,
  }));
}

// ============================================================
// 导出角色模板常量
// ============================================================

export { ROLE_WORKER, ROLE_ORCHESTRATOR };

// 兼容旧 API（deprecated）
/** @deprecated Use getBuiltinRole instead */
export const getBuiltinTemplate = getBuiltinRole;

/** @deprecated Use isBuiltinRoleId instead */
export const isBuiltinTemplateId = isBuiltinRoleId;

/** @deprecated Use listBuiltinRoles instead */
export const listBuiltinTemplates = listBuiltinRoles;
