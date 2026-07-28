import type { RoleSkin } from '../types.js';
import { immortanJoePersona } from './persona.js';
import { immortanJoeRoleUi } from './roleUi.js';

/** Immortan Joe 角色 skin。 */
export const immortanJoeSkin: RoleSkin = {
  id: 'immortan-joe',
  persona: immortanJoePersona,
  roleUi: immortanJoeRoleUi,
};

export { immortanJoePersona } from './persona.js';
export { immortanJoeRoleUi } from './roleUi.js';
