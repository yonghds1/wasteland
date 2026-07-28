/**
 * skins/index.ts - 内容 skin 公共入口
 *
 * Skin 只包含系统/角色内容；所有视觉值由 theme 层提供。
 */
import { t } from '../locales/index.js';
import {
  composeAgentPrompt,
  defaultRoleSkin,
  getRoleSkin,
  isRoleSkinId,
  listRoleSkins,
  roles,
  type RoleSkin,
} from './roles/index.js';

let currentSkin: RoleSkin = getRoleSkin(defaultRoleSkin);

/** 严格加载一个内置角色 skin，并将其设为当前 skin。 */
export async function loadSkin(skinId: string = defaultRoleSkin): Promise<RoleSkin> {
  if (!isRoleSkinId(skinId)) {
    throw new Error(
      t('skins.notFound', {
        skinId,
        skinPath: `(builtin: ${Object.keys(roles).join(', ')})`,
      })
    );
  }
  currentSkin = roles[skinId];
  return currentSkin;
}

/** 获取当前角色 skin。 */
export function getCurrentSkin(): RoleSkin {
  return currentSkin;
}

/** 获取默认角色 skin。 */
export async function getDefaultSkin(): Promise<RoleSkin> {
  return loadSkin(defaultRoleSkin);
}

/** 列出全部内置角色 skin。 */
export async function listSkins(): Promise<RoleSkin[]> {
  return listRoleSkins();
}

/** 旧名称兼容常量；新代码应使用 defaultRoleSkin。 */
export const DEFAULT_SKIN_ID = defaultRoleSkin;

export { systemCommon } from './system/common.js';
export { composeAgentPrompt, defaultRoleSkin, getRoleSkin, isRoleSkinId, listRoleSkins, roles };
export type { RolePersona, RoleSkin, RoleSkinId, RoleUi } from './roles/index.js';
