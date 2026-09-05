import type { ToolCall, ToolRiskLevel } from '@tools/tool-types.js';

import { t } from '@locales/index.js';

export type PermissionMode = 'default' | 'accept_edits' | 'bypass_permissions';
export type PermissionDecisionKind = 'allow' | 'ask' | 'deny';

export type PermissionRule = {
  toolName?: string;
  riskLevel?: ToolRiskLevel;
  decision: PermissionDecisionKind;
  reason?: string;
};

export type PermissionDecision = {
  decision: PermissionDecisionKind;
  mode: PermissionMode;
  reason: string;
};

export interface PermissionGate {
  evaluate(call: ToolCall, riskLevel: ToolRiskLevel): PermissionDecision;
  setMode?(mode: PermissionMode): void;
  getMode?(): PermissionMode;
}

function matchesRule(rule: PermissionRule, call: ToolCall, riskLevel: ToolRiskLevel): boolean {
  if (rule.toolName && rule.toolName !== call.toolName) {
    return false;
  }

  if (rule.riskLevel && rule.riskLevel !== riskLevel) {
    return false;
  }

  return true;
}

function decideByMode(mode: PermissionMode, riskLevel: ToolRiskLevel): PermissionDecision {
  if (mode === 'bypass_permissions') {
    return {
      decision: 'allow',
      mode,
      reason: t('runtime.permissionBypass'),
    };
  }

  if (mode === 'accept_edits') {
    if (riskLevel === 'execute') {
      return {
        decision: 'ask',
        mode,
        reason: t('runtime.permissionAcceptEdits'),
      };
    }

    return {
      decision: 'allow',
      mode,
      reason: t('runtime.permissionAcceptEditsAllows', { count: riskLevel }),
    };
  }

  if (riskLevel === 'read') {
    return {
      decision: 'allow',
      mode,
      reason: t('runtime.permissionDefault'),
    };
  }

  return {
    decision: 'ask',
    mode,
    reason: t('runtime.permissionDefaultRequires', { count: riskLevel }),
  };
}

export function createPermissionGate(params?: {
  mode?: PermissionMode;
  rules?: PermissionRule[];
}): PermissionGate {
  let currentMode = params?.mode ?? 'default';
  const rules = params?.rules ?? [];

  return {
    getMode() {
      return currentMode;
    },
    setMode(newMode: PermissionMode) {
      currentMode = newMode;
    },
    evaluate(call, riskLevel) {
      const matchedRule = rules.find((rule) => matchesRule(rule, call, riskLevel));

      if (matchedRule) {
        return {
          decision: matchedRule.decision,
          mode: currentMode,
          reason: matchedRule.reason ?? `${t('runtime.permissionRuleHit')}${call.toolName}`,
        };
      }

      return decideByMode(currentMode, riskLevel);
    },
  };
}
