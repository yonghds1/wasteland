import type { ToolCall, ToolRiskLevel } from "../tools/tool-types.js";

export type PermissionMode = "default" | "accept_edits" | "bypass_permissions";
export type PermissionDecisionKind = "allow" | "ask" | "deny";

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
  if (mode === "bypass_permissions") {
    return {
      decision: "allow",
      mode,
      reason: "模式 bypass_permissions 允许所有工具调用。",
    };
  }

  if (mode === "accept_edits") {
    if (riskLevel === "execute") {
      return {
        decision: "ask",
        mode,
        reason: "模式 accept_edits 对 execute 工具要求确认。",
      };
    }

    return {
      decision: "allow",
      mode,
      reason: `模式 accept_edits 允许 ${riskLevel} 工具。`,
    };
  }

  if (riskLevel === "read") {
    return {
      decision: "allow",
      mode,
      reason: "模式 default 允许 read 工具。",
    };
  }

  return {
    decision: "ask",
    mode,
    reason: `模式 default 对 ${riskLevel} 工具要求确认。`,
  };
}

export function createPermissionGate(params?: {
  mode?: PermissionMode;
  rules?: PermissionRule[];
}): PermissionGate {
  const mode = params?.mode ?? "default";
  const rules = params?.rules ?? [];

  return {
    evaluate(call, riskLevel) {
      const matchedRule = rules.find((rule) => matchesRule(rule, call, riskLevel));

      if (matchedRule) {
        return {
          decision: matchedRule.decision,
          mode,
          reason: matchedRule.reason ?? `工具规则命中：${call.toolName}`,
        };
      }

      return decideByMode(mode, riskLevel);
    },
  };
}
