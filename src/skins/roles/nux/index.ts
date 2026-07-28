import type { RoleSkin } from '../types.js';
import { nuxPersona } from './persona.js';
import { nuxRoleUi } from './roleUi.js';

/** Nux 角色 skin。 */
export const nuxSkin: RoleSkin = {
  id: 'nux',
  persona: nuxPersona,
  roleUi: nuxRoleUi,
};

export { nuxPersona } from './persona.js';
export { nuxRoleUi } from './roleUi.js';
