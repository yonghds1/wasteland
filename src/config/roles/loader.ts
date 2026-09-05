/**
 * roles/loader.ts - 角色定义加载器
 *
 * 从 `roles.json` 加载角色定义，内置默认作为兜底，支持用户级/项目级覆盖。
 * 镜像 `skins/loader.ts` 的优先级加载模式。
 *
 * ## 加载优先级（从低到高）
 *
 * - 内置默认（default-roles.ts）→ 兜底
 * - 用户级 `~/.wasteland/roles.json` → 全局偏好
 * - 项目级 `<cwd>/.wasteland/roles.json` → 项目特化（最高优先）
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DEFAULT_ROLES } from './default-roles.js';
import type { LoadedRoles, RoleDefinition, RolesDefinition } from './types.js';

/**
 * 加载 roles.json 文件
 *
 * @param dir - 目录路径
 * @returns 角色定义文件，文件不存在返回 null
 */
async function loadRolesFile(dir: string): Promise<RolesDefinition | null> {
  const filePath = join(dir, 'roles.json');
  try {
    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content) as { roles?: RolesDefinition };
    return parsed.roles ?? null;
  } catch {
    return null;
  }
}

/**
 * 合并角色定义（高优先覆盖低优先，字段级浅合并）
 *
 * @param base - 基础角色定义
 * @param override - 覆盖角色定义
 * @returns 合并后的角色定义
 */
export function mergeRoles(
  base: RolesDefinition,
  override: RolesDefinition
): RolesDefinition {
  const merged: RolesDefinition = { ...base };
  for (const [roleId, roleDef] of Object.entries(override)) {
    merged[roleId] = { ...merged[roleId], ...roleDef } as RoleDefinition;
  }
  return merged;
}

/**
 * 带优先级的角色定义加载
 *
 * 按优先级从低到高加载：
 * 1. 内置默认（兜底）
 * 2. 用户级 `~/.wasteland/roles.json`
 * 3. 项目级 `<cwd>/.wasteland/roles.json`
 *
 * @param userDir - 用户级目录（~/.wasteland）
 * @param projectDir - 项目级目录（<cwd>/.wasteland）
 * @returns 合并后的角色定义
 */
export async function loadRolesWithPriority(
  userDir?: string,
  projectDir?: string
): Promise<LoadedRoles> {
  // 1. 内置默认
  let roles: RolesDefinition = { ...DEFAULT_ROLES };

  // 2. 用户级覆盖
  if (userDir) {
    const userRoles = await loadRolesFile(userDir);
    if (userRoles) roles = mergeRoles(roles, userRoles);
  }

  // 3. 项目级覆盖（最高优先）
  if (projectDir) {
    const projectRoles = await loadRolesFile(projectDir);
    if (projectRoles) roles = mergeRoles(roles, projectRoles);
  }

  return { roles };
}