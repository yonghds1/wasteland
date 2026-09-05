import type { ToolCall, ToolInput, ToolRiskLevel } from '@tools/tool-types.js';

import { t } from '@locales/index.js';

export type PermissionMode = 'default' | 'accept_edits' | 'bypass_permissions';
export type PermissionDecisionKind = 'allow' | 'ask' | 'deny';

export type PermissionRule = {
  toolName?: string;
  riskLevel?: ToolRiskLevel;
  decision: PermissionDecisionKind;
  reason?: string;
  /**
   * 输入前缀匹配（once/always 记住的模式，如 bash 的 command 以 "git status" 开头）。
   * 命中要求 input[key] 为字符串且以 prefix 开头；不填则只按 toolName/riskLevel 匹配。
   */
  inputPrefix?: {
    key: string;
    prefix: string;
  };
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
  /**
   * 注册 session 级内存规则（once/always 的 always 落点）。
   *
   * - 只活在当前进程/会话：不落盘，进程结束即焚，不继承给跨 session（见 memory 决策）。
   * - 子 agent 与父共享同一 gate 实例，同 session 内自动跟进（spawn-agent/types.ts:78）。
   */
  addSessionRule?(rule: PermissionRule): void;
  /** 清空 session 级内存规则（预留：未来若支持单进程多 session 切换时调用）。 */
  clearSessionRules?(): void;
}

/**
 * always 可记住的模式描述。
 */
export type AllowPattern = {
  /** 匹配的输入字段（如 bash 的 command、edit 系的 path）。 */
  key: string;
  /** 前缀（-packed 命令取首 token，如 "git status"）。 */
  prefix: string;
  /** 展示给用户确认的文案（如 "bash git status*"）。 */
  label: string;
};

/**
 * 工具输入字段映射：哪些工具的 always 可归纳为"字段前缀"模式。
 *
 * 保守正确：不在表里的工具返回 null（UI 不提供 always，只给 once），
 * 漏了再补，不提前放宽。
 */
const ALLOW_PATTERN_FIELDS: Readonly<Record<string, string>> = {
  bash: 'command',
  edit_file: 'path',
  'edit-file': 'path',
  write_file: 'path',
  'write-file': 'path',
  read_file: 'path',
  'read-file': 'path',
};

/**
 * 推导指定工具调用可记住的 always 模式。
 *
 * - bash 类：command 首 token（如 "git status"），展示为 `bash git status*`。
 * - 路径类（edit/write/read）：path 完整值，展示为 `edit-file /abs/path*`。
 * - 无映射或字段非字符串/空 → null（UI 只给 once，不提供 always）。
 */
export function describeAllowPattern(
  toolName: string,
  input: ToolInput | undefined
): AllowPattern | null {
  const key = ALLOW_PATTERN_FIELDS[toolName];
  if (!key) return null;
  const raw = input?.[key];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // 命令取首 token（`git status --porcelain` → `git status`），路径取完整值
  const prefix = key === 'command' ? trimmed.split(/\s+/).slice(0, 2).join(' ') : trimmed;
  if (prefix.length === 0) return null;
  return { key, prefix, label: `${toolName} ${prefix}*` };
}

function matchesRule(rule: PermissionRule, call: ToolCall, riskLevel: ToolRiskLevel): boolean {
  if (rule.toolName && rule.toolName !== call.toolName) {
    return false;
  }

  if (rule.riskLevel && rule.riskLevel !== riskLevel) {
    return false;
  }

  if (rule.inputPrefix) {
    const value = call.input?.[rule.inputPrefix.key];
    if (typeof value !== 'string' || !value.startsWith(rule.inputPrefix.prefix)) {
      return false;
    }
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
  /** session 级内存规则（addSessionRule 注册，clearSessionRules 清空）。 */
  const sessionRules: PermissionRule[] = [];

  return {
    getMode() {
      return currentMode;
    },
    setMode(newMode: PermissionMode) {
      currentMode = newMode;
    },
    addSessionRule(rule: PermissionRule) {
      sessionRules.push(rule);
    },
    clearSessionRules() {
      sessionRules.length = 0;
    },
    evaluate(call, riskLevel) {
      // 优先级：静态 deny > session 放行 > 静态 ask/allow > 模式默认。
      // session 级 always 永远盖不过显式 deny（防静默提权）。
      const staticMatched = rules.find((rule) => matchesRule(rule, call, riskLevel));
      if (staticMatched && staticMatched.decision === 'deny') {
        return {
          decision: staticMatched.decision,
          mode: currentMode,
          reason: staticMatched.reason ?? `${t('runtime.permissionRuleHit')}${call.toolName}`,
        };
      }
      const sessionMatched = sessionRules.find((rule) => matchesRule(rule, call, riskLevel));
      const matchedRule = sessionMatched ?? staticMatched;
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
