import { furiosaSkin } from './furiosa/index.js';
import { immortanJoeSkin } from './immortan-joe/index.js';
import { nuxSkin } from './nux/index.js';
import type { RoleSkin } from './types.js';

/** 默认角色 skin ID。 */
export const defaultRoleSkin = 'immortan-joe';

/** 内置角色 skin 注册表。 */
export const roles = {
  'immortan-joe': immortanJoeSkin,
  nux: nuxSkin,
  furiosa: furiosaSkin,
} satisfies Record<string, RoleSkin>;

/** 内置角色 skin ID。 */
export type RoleSkinId = keyof typeof roles;

/**
 * 按 ID 获取角色 skin。
 *
 * 未配置或 ID 未注册时回退到 defaultRoleSkin，保证可选 skin 字段有稳定默认值。
 */
export function getRoleSkin(skinId?: string): RoleSkin {
  if (skinId && skinId in roles) {
    return roles[skinId as RoleSkinId];
  }
  return roles[defaultRoleSkin];
}

/** 判断 ID 是否对应内置角色 skin。 */
export function isRoleSkinId(skinId: string): skinId is RoleSkinId {
  return skinId in roles;
}

/** 列出全部内置角色 skin。 */
export function listRoleSkins(): RoleSkin[] {
  return Object.values(roles);
}

/**
 * 将英文 persona 放在功能提示词之前，形成最终 system prompt。
 */
export function composeAgentPrompt(skin: RoleSkin, functionalPrompt?: string): string {
  const trimmedPrompt = functionalPrompt?.trim();
  return trimmedPrompt ? `${skin.persona.fullPrompt}\n\n${trimmedPrompt}` : skin.persona.fullPrompt;
}

export type { RolePersona, RoleSkin, RoleUi } from './types.js';
export { furiosaSkin } from './furiosa/index.js';
export { immortanJoeSkin } from './immortan-joe/index.js';
export { nuxSkin } from './nux/index.js';
