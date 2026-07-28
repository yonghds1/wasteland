import type { RoleSkin } from '../types.js';
import { furiosaPersona } from './persona.js';
import { furiosaRoleUi } from './roleUi.js';

/** Furiosa 角色 skin。 */
export const furiosaSkin: RoleSkin = {
  id: 'furiosa',
  persona: furiosaPersona,
  roleUi: furiosaRoleUi,
};

export { furiosaPersona } from './persona.js';
export { furiosaRoleUi } from './roleUi.js';
