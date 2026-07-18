/**
 * prompts/index.ts - 提示词组装系统公共导出
 *
 * 提供模块化提示词组装能力：
 * - RoleDefinition: 角色定义（role/goal/backstory 三层结构）
 * - PromptTemplate: 提示词模板
 * - PromptAssembler: 组装器
 * - 预定义角色模板
 */

// 类型导出
export type {
  // 核心类型
  RoleDefinition,
  PromptSection,
  PromptTemplate,
  PromptVariableDef,
  PromptTemplateRef,
  PromptAssemblyContext,
  ResolvedPrompt,
  BuiltinRoleId,
} from './prompt-types.js';

// 组装器导出
export { PromptAssembler, assemblePrompt } from './prompt-assembler.js';

// 变量插值导出
export { interpolateVariables, interpolateObject } from './variable-interpolator.js';

// 角色模板导出
export {
  getBuiltinRole,
  isBuiltinRoleId,
  listBuiltinRoles,
  ROLE_WORKER,
  ROLE_ORCHESTRATOR,
} from './role-templates.js';
