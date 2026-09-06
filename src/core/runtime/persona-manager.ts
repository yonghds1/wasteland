/**
 * persona-manager.ts - 角色与皮肤的动态缝合层 (Hydration Layer)
 */
import { DEFAULT_ROLES } from '../../config/roles/default-roles.js';
import { tryAcquire } from './skin-occupancy.js';
import { Logger } from '../logger/index.js';

export type AgentProfile = {
  roleId: string;
  skinId: string;
};

export function hydratePersona(roleId: string, sessionId: string): AgentProfile {
  const roleDef = DEFAULT_ROLES[roleId];
  
  if (!roleDef) {
    Logger.warn({
      sessionId,
      scope: 'session',
      message: 'persona_hydration_failed',
      data: { reason: `Role ${roleId} not found, falling back to orchestrator` }
    });
    return { roleId: 'orchestrator', skinId: 'warlord-immortal' };
  }

  const candidateSkins = roleDef.skins || [];
  for (const skinId of candidateSkins) {
    if (tryAcquire(skinId, sessionId)) {
      return { roleId, skinId };
    }
  }

  const fallbackSkin = candidateSkins[0] || 'road-nomad';
  tryAcquire(fallbackSkin, sessionId);
  return { roleId, skinId: fallbackSkin };
}
