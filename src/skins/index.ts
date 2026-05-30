/**
 * skins/index.ts - 皮肤系统公共导出
 */

export {
  loadSkin,
  getCurrentSkin,
  getDefaultSkin,
  listSkins,
  getRoleGreeting,
  getRoleCatchphrase,
  DEFAULT_SKIN_ID,
} from './skin-loader.js';

export type {
  Skin,
  SkinCLIConfig,
  SkinUIConfig,
  SkinRolesConfig,
  SkinRoleConfig,
} from './skin-loader.js';
