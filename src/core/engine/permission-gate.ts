import type { ToolCall, ToolInput, ToolRiskLevel } from '@tools/core/tool-types.js';

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
  /**
   * 匹配的输入字段（bash 的 command、edit 系的 path、git 的 subcommand）；
   * 取 TOOL_NAME_SCOPE_KEY 时表示按工具名前缀匹配（无合适输入字段的工具用）。
   */
  key: string;
  /** 前缀（-packed 命令取首 token，如 "git status"）。 */
  prefix: string;
  /** 展示给用户确认的文案（如 "bash git status*"）。 */
  label: string;
};

/**
 * inputPrefix.key 取此值时，匹配语义切换为"工具名前缀"（-call.toolName.startsWith(prefix)），
 * 而不是输入字段前缀。用于无合适输入字段的工具（MCP 按 `server/` 记整服，其余记整工具）。
 */
export const TOOL_NAME_SCOPE_KEY = '__toolName';

/**
 * 工具输入字段映射：哪些工具的 always 可归纳为"字段前缀"模式。
 *
 * 无映射的工具退回工具名级记忆（见 describeAllowPattern），
 * spawn_agent / ask-user 例外（口子太大 / 从不询问），保持仅 once。
 */
const ALLOW_PATTERN_FIELDS: Readonly<Record<string, string>> = {
  bash: 'command',
  edit_file: 'path',
  'edit-file': 'path',
  write_file: 'path',
  'write-file': 'path',
  read_file: 'path',
  'read-file': 'path',
  // 版本控制写操作按子命令记（如 `git commit*`）
  git: 'subcommand',
  // 注：web-fetch 故意不在此表——按工具维度记住（一次 always 管所有 URL），
  // 退回下面的工具名级记忆。按站记意义不大：bash curl 同等出口能力已是整工具放行。
};

/**
 * 推导指定工具调用可记住的 always 模式。
 *
 * - bash 类：command 首 token（如 "git status"），展示为 `bash git status*`。
 * - 路径类（edit/write/read）：path 完整值，展示为 `edit-file /abs/path*`。
 * - git：subcommand 完整值（如 `git commit*`）。
 * - 其他工具（含 web-fetch、MCP `server/tool`、terminal）：工具名级记忆
 *   （MCP 按 `server/` 记整服，其余记整工具名，如 `web-fetch*`）；
 *   spawn_agent / ask-user 返回 null（UI 只给 once）。
 * - 字段非字符串/空 → null（UI 只给 once，不提供 always）。
 */
export function describeAllowPattern(
  toolName: string,
  input: ToolInput | undefined
): AllowPattern | null {
  const key = ALLOW_PATTERN_FIELDS[toolName];
  // 无字段映射的工具退回工具名级记忆（MCP 按 `server/` 记整服，其余记整工具名）；
  // 输入内容不参与推导（整工具/整服放行由用户显式确认）。
  // spawn_agent 例外：整工具免问口子太大，保持仅 once；ask-user 从不询问，无需记忆。
  if (!key) {
    if (toolName === 'spawn_agent' || toolName === 'ask-user') return null;
    const slash = toolName.indexOf('/');
    const prefix = slash > 0 ? toolName.slice(0, slash + 1) : toolName;
    return { key: TOOL_NAME_SCOPE_KEY, prefix, label: `${prefix}*` };
  }
  const raw = input?.[key];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // 命令取首 token（`git status --porcelain` → `git status`），其余字段取完整值
  const prefix = key === 'command' ? trimmed.split(/\s+/).slice(0, 2).join(' ') : trimmed;
  if (prefix.length === 0) return null;
  return { key, prefix, label: `${toolName} ${prefix}*` };
}

function matchesRule(rule: PermissionRule, call: ToolCall, riskLevel: ToolRiskLevel): boolean {
  // 工具名级规则（MCP 整服 / 小众工具整工具）跳过 toolName 精确匹配，
  // 由下面的前缀检查兜底——否则 `server/` 前缀永远只能命中当初注册的那一个工具。
  const isNameScope = rule.inputPrefix?.key === TOOL_NAME_SCOPE_KEY;
  if (!isNameScope && rule.toolName && rule.toolName !== call.toolName) {
    return false;
  }

  if (rule.riskLevel && rule.riskLevel !== riskLevel) {
    return false;
  }

  if (rule.inputPrefix) {
    // 工具名级规则：按工具名前缀匹配（MCP 整服 / 小众工具整工具）
    if (rule.inputPrefix.key === TOOL_NAME_SCOPE_KEY) {
      if (!call.toolName.startsWith(rule.inputPrefix.prefix)) return false;
    } else {
      const value = call.input?.[rule.inputPrefix.key];
      if (typeof value !== 'string' || !value.startsWith(rule.inputPrefix.prefix)) {
        return false;
      }
      // bash 命令规则：前缀之后须是"干净余部"，否则拒绝命中回落到问——
      // 防 `git status && evil` 蹭已记住的 `git status*`（链式/替换/重定向/换行）。
      if (rule.inputPrefix.key === 'command' && !isSafeCommandRemainder(value, rule.inputPrefix.prefix)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * 命令余部安全检查（bash always 规则用）。
 *
 * - 余部为空（精确命中）→ 安全。
 * - 余部必须以空白开头（token 边界：`git statuses` ≠ `git status`）。
 * - 余部不得含 shell 元字符（`; & | 反引号 $ < > ( )` 与换行），防链式绕过。
 * 不安全一律回落到问（fail-closed）；以前记住的带管道命令会重新开始问一次。
 */
function isSafeCommandRemainder(value: string, prefix: string): boolean {
  if (value.length === prefix.length) return true;
  const rest = value.slice(prefix.length);
  if (!/^\s/.test(rest)) return false;
  return !/[;&|`$<>()\n\r]/.test(rest);
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
