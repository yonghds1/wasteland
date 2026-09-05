/**
 * roles/index.ts - 角色管理
 *
 * 提供角色定义的加载、内置默认与 prompt 组装能力。
 *
 * - 角色定义：`.wasteland/roles.json`（与 skins.json 对称）
 * - 内置默认：default-roles.ts（orchestrator / researcher / developer / analyst / tester）
 * - prompt 组装：composeAgentPrompt（functionalPrompt 优先，否则 role-worker 回退）
 */

import { assemblePrompt } from '../prompts/index.js';
import { ROLE_WORKER } from '../prompts/role-templates.js';

export { DEFAULT_ROLES } from './default-roles.js';
export { loadRolesWithPriority, mergeRoles } from './loader.js';
export type {
  RoleDefinition,
  RolesDefinition,
  RolesFile,
  LoadedRoles,
} from './types.js';

/**
 * 将角色 system prompt 与功能性 prompt 合并。
 *
 * - 有 functionalPrompt（模板输出）时直接返回
 * - 无 functionalPrompt 时用 role-worker 模板作为默认
 *
 * @param roleName - 角色名称
 * @param functionalPrompt - 模板组装后的 prompt（可选）
 * @param format - 输出格式：'markdown'（## 标题）或 'xml'（语义化标签）
 * @returns 最终的 system prompt
 */
export function composeAgentPrompt(
  roleName: string,
  functionalPrompt?: string,
  format: 'markdown' | 'xml' = 'markdown'
): string {
  // 有模板输出则直接返回（模板已包含完整指令）
  const trimmed = functionalPrompt?.trim();
  if (trimmed) {
    return trimmed;
  }

  // 无模板：用 role-worker 作为默认（子 agent 无配置时的回退）
  return assemblePrompt(ROLE_WORKER, { cwd: process.cwd(), variables: {} }, format);
}

/**
 * 角色名称类型（内置）
 */
export type RoleName = 'orchestrator' | 'developer' | 'researcher' | 'analyst' | 'tester';

/**
 * 默认角色（兼容旧入口）
 */
export const defaultRole = 'orchestrator';