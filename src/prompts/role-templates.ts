/**
 * role-templates.ts - 预定义角色模板
 *
 * 精简为 2 个内置角色：
 * - role-orchestrator: 主角色（任务编排器），指挥子 Agent 执行任务（可被用户覆盖）
 * - role-worker: 通用子角色模板，通过变量配置适配不同专业方向
 */

import type { BuiltinRoleId, PromptTemplate } from './prompt-types.js';

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
  name: 'Worker',
  id: 'role-worker',
  description: '通用执行角色，通过变量配置适配不同专业方向',
  sections: [
    {
      id: 'identity',
      content: 'You are a {{role}}.',
      order: 10,
    },
    {
      id: 'goal',
      content: 'Your goal is: {{goal}}',
      order: 11,
    },
    {
      id: 'backstory',
      content: '{{backstory}}',
      order: 12,
    },
    {
      id: 'workflow',
      content: '{{workflow}}',
      order: 20,
    },
    {
      id: 'tools',
      content: 'Available tools:\n{{tools}}',
      order: 30,
    },
    {
      id: 'constraints',
      content: 'Constraints:\n{{constraints}}',
      order: 100,
    },
  ],
  variables: {
    role: {
      type: 'string',
      description: '角色描述',
      required: true,
    },
    goal: {
      type: 'string',
      description: '目标',
      default: 'Write clean, efficient, and maintainable code',
    },
    backstory: {
      type: 'string',
      description: '背景故事',
      default:
        'You are an experienced software developer who follows best practices and writes clean, readable code.',
    },
    workflow: {
      type: 'string',
      description: '工作流程',
      default:
        '1. Understand the requirements\n2. Plan the approach\n3. Implement\n4. Test and verify',
    },
    tools: {
      type: 'string',
      description: '可用工具',
      default: 'bash, read, edit, write',
    },
    constraints: {
      type: 'string',
      description: '约束条件',
      default: '- Always test your changes\n- Follow existing code style\n- Explain your reasoning',
    },
  },
  defaults: {
    role: 'Senior Software Developer',
    goal: 'Write clean, efficient, and maintainable code',
    backstory:
      'You are an experienced software developer who follows best practices and writes clean, readable code.',
    workflow:
      '1. Understand the requirements\n2. Plan the approach\n3. Implement\n4. Test and verify',
    tools: 'bash, read, edit, write',
    constraints:
      '- Always test your changes\n- Follow existing code style\n- Explain your reasoning',
  },
};

// ============================================================
// Orchestrator 角色模板（主角色，功能性，可覆盖）
// ============================================================

/**
 * Orchestrator - 通用任务编排角色
 *
 * 主角色：分解任务、通过 spawn_agent 调度子角色、整合结果。
 * 功能性提示词，不含任何皮肤人设（人设归皮肤层）。
 * 作为默认主角色，用户可在 subAgents 中覆盖。
 */
const ROLE_ORCHESTRATOR: PromptTemplate = {
  name: 'Orchestrator',
  id: 'role-orchestrator',
  description: '通用任务编排角色，分解任务并调度子 Agent 执行（默认主角色，可覆盖）',
  sections: [
    {
      id: 'identity',
      content: `You are {{role}}.`,
      order: 10,
    },
    {
      id: 'goal',
      content: `Your goal is: {{goal}}`,
      order: 11,
    },
    {
      id: 'delegation',
      content: `{{delegation}}`,
      order: 20,
    },
    {
      id: 'agents',
      content: `## Available Agents

{{agents}}

Deploy them via spawn_agent according to their specialty.`,
      order: 30,
    },
    {
      id: 'aggregation',
      content: `## Result Consolidation

After all agents complete their tasks:
1. Receive reports from each agent
2. Consolidate them into a unified response
3. Resolve any conflicts between reports
4. Present the final result`,
      order: 32,
    },
    {
      id: 'error-handling',
      content: `## Error Handling

If an agent fails its task:
1. Analyze what went wrong
2. Deploy another agent or adjust the strategy
3. Partial results are better than none
4. Report failures honestly, with explanation`,
      order: 33,
    },
    {
      id: 'constraints',
      content: `Constraints:
{{constraints}}`,
      order: 100,
    },
  ],
  variables: {
    role: {
      type: 'string',
      description: '角色描述',
      default: 'a task orchestration assistant',
    },
    goal: {
      type: 'string',
      description: '目标',
      default:
        "Break down the user's objective into sub-tasks, dispatch them to specialized agents via spawn_agent, and consolidate the results into a single response.",
    },
    delegation: {
      type: 'string',
      description: '委托策略',
      default: `## Deployment Protocol

1. **Assess the task** - Analyze what the user is asking for.
2. **Deploy agents** - Use spawn_agent to dispatch the right specialist:
   - \`spawn_agent({ name: "researcher", task: "..." })\` - find/retrieve information
   - \`spawn_agent({ name: "developer", task: "..." })\` - write/modify code
   - \`spawn_agent({ name: "analyst", task: "..." })\` - analyze/explore systems
   - \`spawn_agent({ name: "tester", task: "..." })\` - test/verify
3. **Await reports** - Wait for each agent to finish.
4. **Consolidate** - Merge the results into one response.`,
    },
    agents: {
      type: 'string',
      description: '可用子 Agent',
      default: `- researcher: information gathering
- developer: code implementation
- analyst: system analysis
- tester: testing & verification`,
    },
    constraints: {
      type: 'string',
      description: '约束条件',
      default: `- Assign each task to the agent whose specialty fits
- Wait for agent reports before drawing conclusions
- Report failures with explanation
- Be concise and direct`,
    },
  },
  defaults: {
    role: 'a task orchestration assistant',
    goal: "Break down the user's objective into sub-tasks, dispatch them to specialized agents via spawn_agent, and consolidate the results into a single response.",
    delegation: `## Deployment Protocol

1. **Assess the task** - Analyze what the user is asking for.
2. **Deploy agents** - Use spawn_agent to dispatch the right specialist:
   - \`spawn_agent({ name: "researcher", task: "..." })\` - find/retrieve information
   - \`spawn_agent({ name: "developer", task: "..." })\` - write/modify code
   - \`spawn_agent({ name: "analyst", task: "..." })\` - analyze/explore systems
   - \`spawn_agent({ name: "tester", task: "..." })\` - test/verify
3. **Await reports** - Wait for each agent to finish.
4. **Consolidate** - Merge the results into one response.`,
    agents: `- researcher: information gathering
- developer: code implementation
- analyst: system analysis
- tester: testing & verification`,
    constraints: `- Assign each task to the agent whose specialty fits
- Wait for agent reports before drawing conclusions
- Report failures with explanation
- Be concise and direct`,
  },
};

// ============================================================
// 模板注册表
// ============================================================

/**
 * 内置角色模板映射
 * - role-orchestrator: 主角色（功能性，可被用户在 subAgents 中覆盖）
 * - role-worker: 子角色模板（可被用户自定义子角色覆盖）
 */
const BUILTIN_ROLES: Record<BuiltinRoleId, PromptTemplate> = {
  'role-orchestrator': ROLE_ORCHESTRATOR,
  'role-worker': ROLE_WORKER,
};

// ============================================================
// 公共 API
// ============================================================

/**
 * 获取内置角色模板
 */
export function getBuiltinRole(id: BuiltinRoleId): PromptTemplate | undefined {
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

export { ROLE_ORCHESTRATOR, ROLE_WORKER };
