/**
 * permission-gate.test.ts - PermissionGate 单元测试
 *
 * 覆盖范围：
 * - createPermissionGate 工厂函数
 * - 三种模式：default / accept_edits / bypass_permissions
 * - 三种风险级别：read / write / execute
 * - 规则匹配：toolName 过滤、riskLevel 过滤、规则优先于模式
 * - 边界情况：无参数、空规则、规则不匹配
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@locales/index.js', () => ({
  t: vi.fn((key: string, params?: Record<string, unknown>) => {
    if (params) return `${key}:${JSON.stringify(params)}`;
    return key;
  }),
}));

import {
  createPermissionGate,
  describeAllowPattern,
} from '../permission-gate.js';
import type { ToolCall } from '@tools/core/tool-types.js';

// ============================================================
// Helpers
// ============================================================

function makeCall(toolName = 'test-tool'): ToolCall {
  return { id: 'call-1', toolName, input: {} };
}

// ============================================================
// Tests
// ============================================================

describe('createPermissionGate', () => {
  // ----------------------------------------------------------
  // Factory & interface
  // ----------------------------------------------------------

  it('should return a PermissionGate object with evaluate method', () => {
    const gate = createPermissionGate();
    expect(gate).toBeDefined();
    expect(typeof gate.evaluate).toBe('function');
  });

  it('should use default mode when no params provided', () => {
    const gate = createPermissionGate();
    const result = gate.evaluate(makeCall(), 'read');
    expect(result.mode).toBe('default');
  });

  // ----------------------------------------------------------
  // Mode: default
  // ----------------------------------------------------------

  describe('mode=default', () => {
    it('should allow read operations', () => {
      const gate = createPermissionGate({ mode: 'default' });
      const result = gate.evaluate(makeCall(), 'read');
      expect(result.decision).toBe('allow');
      expect(result.mode).toBe('default');
    });

    it('should ask for write operations', () => {
      const gate = createPermissionGate({ mode: 'default' });
      const result = gate.evaluate(makeCall(), 'write');
      expect(result.decision).toBe('ask');
    });

    it('should ask for execute operations', () => {
      const gate = createPermissionGate({ mode: 'default' });
      const result = gate.evaluate(makeCall(), 'execute');
      expect(result.decision).toBe('ask');
    });
  });

  // ----------------------------------------------------------
  // Mode: accept_edits
  // ----------------------------------------------------------

  describe('mode=accept_edits', () => {
    it('should allow read operations', () => {
      const gate = createPermissionGate({ mode: 'accept_edits' });
      const result = gate.evaluate(makeCall(), 'read');
      expect(result.decision).toBe('allow');
    });

    it('should allow write operations', () => {
      const gate = createPermissionGate({ mode: 'accept_edits' });
      const result = gate.evaluate(makeCall(), 'write');
      expect(result.decision).toBe('allow');
    });

    it('should ask for execute operations', () => {
      const gate = createPermissionGate({ mode: 'accept_edits' });
      const result = gate.evaluate(makeCall(), 'execute');
      expect(result.decision).toBe('ask');
    });
  });

  // ----------------------------------------------------------
  // Mode: bypass_permissions
  // ----------------------------------------------------------

  describe('mode=bypass_permissions', () => {
    it('should allow read operations', () => {
      const gate = createPermissionGate({ mode: 'bypass_permissions' });
      const result = gate.evaluate(makeCall(), 'read');
      expect(result.decision).toBe('allow');
    });

    it('should allow write operations', () => {
      const gate = createPermissionGate({ mode: 'bypass_permissions' });
      const result = gate.evaluate(makeCall(), 'write');
      expect(result.decision).toBe('allow');
    });

    it('should allow execute operations', () => {
      const gate = createPermissionGate({ mode: 'bypass_permissions' });
      const result = gate.evaluate(makeCall(), 'execute');
      expect(result.decision).toBe('allow');
    });
  });

  // ----------------------------------------------------------
  // Rules: toolName matching
  // ----------------------------------------------------------

  describe('rules: toolName matching', () => {
    it('should apply rule when toolName matches', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [{ toolName: 'bash', decision: 'deny' }],
      });
      const result = gate.evaluate(makeCall('bash'), 'execute');
      expect(result.decision).toBe('deny');
    });

    it('should not apply rule when toolName does not match', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [{ toolName: 'bash', decision: 'deny' }],
      });
      const result = gate.evaluate(makeCall('read_file'), 'read');
      expect(result.decision).toBe('allow');
    });

    it('should apply rule with wildcard toolName (no toolName filter)', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [{ decision: 'deny' }],
      });
      const result = gate.evaluate(makeCall('any-tool'), 'read');
      expect(result.decision).toBe('deny');
    });
  });

  // ----------------------------------------------------------
  // Rules: riskLevel matching
  // ----------------------------------------------------------

  describe('rules: riskLevel matching', () => {
    it('should apply rule when riskLevel matches', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [{ riskLevel: 'write', decision: 'deny' }],
      });
      const result = gate.evaluate(makeCall(), 'write');
      expect(result.decision).toBe('deny');
    });

    it('should not apply rule when riskLevel does not match', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [{ riskLevel: 'write', decision: 'deny' }],
      });
      const result = gate.evaluate(makeCall(), 'read');
      expect(result.decision).toBe('allow');
    });
  });

  // ----------------------------------------------------------
  // Rules: combined matching
  // ----------------------------------------------------------

  describe('rules: combined toolName + riskLevel', () => {
    it('should apply rule only when both toolName and riskLevel match', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [{ toolName: 'bash', riskLevel: 'execute', decision: 'deny' }],
      });

      // Both match
      const r1 = gate.evaluate(makeCall('bash'), 'execute');
      expect(r1.decision).toBe('deny');

      // toolName matches but riskLevel does not
      const r2 = gate.evaluate(makeCall('bash'), 'read');
      expect(r2.decision).toBe('allow');

      // riskLevel matches but toolName does not
      const r3 = gate.evaluate(makeCall('read_file'), 'execute');
      expect(r3.decision).toBe('ask');
    });
  });

  // ----------------------------------------------------------
  // Rules: priority & order
  // ----------------------------------------------------------

  describe('rules: priority & order', () => {
    it('should use the first matching rule', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [
          { toolName: 'bash', decision: 'deny' },
          { toolName: 'bash', decision: 'allow' },
        ],
      });
      const result = gate.evaluate(makeCall('bash'), 'execute');
      expect(result.decision).toBe('deny');
    });

    it('should fall through to mode decision when no rule matches', () => {
      const gate = createPermissionGate({
        mode: 'accept_edits',
        rules: [{ toolName: 'bash', decision: 'deny' }],
      });
      const result = gate.evaluate(makeCall('write_file'), 'write');
      expect(result.decision).toBe('allow'); // accept_edits allows write
    });

    it('should override mode with matching rule', () => {
      const gate = createPermissionGate({
        mode: 'bypass_permissions',
        rules: [{ toolName: 'bash', decision: 'ask' }],
      });
      const result = gate.evaluate(makeCall('bash'), 'execute');
      expect(result.decision).toBe('ask');
      expect(result.mode).toBe('bypass_permissions');
    });
  });

  // ----------------------------------------------------------
  // Rules: reason field
  // ----------------------------------------------------------

  describe('rules: reason field', () => {
    it('should use rule reason when provided', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [{ toolName: 'bash', decision: 'deny', reason: 'Blocked by policy' }],
      });
      const result = gate.evaluate(makeCall('bash'), 'execute');
      expect(result.reason).toBe('Blocked by policy');
    });

    it('should use default reason when rule has no reason', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [{ toolName: 'bash', decision: 'deny' }],
      });
      const result = gate.evaluate(makeCall('bash'), 'execute');
      // The default reason includes the tool name from runtime.permissionRuleHit
      expect(result.reason).toContain('bash');
    });
  });

  // ----------------------------------------------------------
  // Edge cases
  // ----------------------------------------------------------

  describe('edge cases', () => {
    it('should work with empty rules array', () => {
      const gate = createPermissionGate({ mode: 'default', rules: [] });
      const result = gate.evaluate(makeCall(), 'read');
      expect(result.decision).toBe('allow');
    });

    it('should accept all three decision kinds (allow/ask/deny) as rule decisions', () => {
      const allowGate = createPermissionGate({
        mode: 'default',
        rules: [{ decision: 'allow' }],
      });
      expect(allowGate.evaluate(makeCall(), 'write').decision).toBe('allow');

      const askGate = createPermissionGate({
        mode: 'default',
        rules: [{ decision: 'ask' }],
      });
      expect(askGate.evaluate(makeCall(), 'read').decision).toBe('ask');

      const denyGate = createPermissionGate({
        mode: 'default',
        rules: [{ decision: 'deny' }],
      });
      expect(denyGate.evaluate(makeCall(), 'read').decision).toBe('deny');
    });

    it('should always include mode in the result', () => {
      const gate = createPermissionGate({ mode: 'accept_edits' });
      const result = gate.evaluate(makeCall(), 'write');
      expect(result).toHaveProperty('mode', 'accept_edits');
      expect(result).toHaveProperty('decision');
      expect(result).toHaveProperty('reason');
    });

    it('should evaluate the same call multiple times with consistent results', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [{ toolName: 'bash', decision: 'deny' }],
      });
      const call = makeCall('bash');
      const r1 = gate.evaluate(call, 'execute');
      const r2 = gate.evaluate(call, 'execute');
      expect(r1.decision).toBe(r2.decision);
      expect(r1.mode).toBe(r2.mode);
    });

    it('should handle multiple rules with different risk levels', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [
          { riskLevel: 'read', decision: 'allow' },
          { riskLevel: 'write', decision: 'ask' },
          { riskLevel: 'execute', decision: 'deny' },
        ],
      });

      expect(gate.evaluate(makeCall(), 'read').decision).toBe('allow');
      expect(gate.evaluate(makeCall(), 'write').decision).toBe('ask');
      expect(gate.evaluate(makeCall(), 'execute').decision).toBe('deny');
    });
  });
});

describe('session rules (once/always 内存级)', () => {
  function bashCall(command: string) {
    return { id: 'call-1', toolName: 'bash', input: { command } };
  }

  it('addSessionRule 注册后同 pattern 放行', () => {
    const gate = createPermissionGate({ mode: 'default' });
    expect(gate.evaluate(bashCall('git status'), 'execute').decision).toBe('ask');
    gate.addSessionRule?.({
      toolName: 'bash',
      decision: 'allow',
      inputPrefix: { key: 'command', prefix: 'git status' },
    });
    expect(gate.evaluate(bashCall('git status --porcelain'), 'execute').decision).toBe('allow');
  });

  it('前缀不匹配继续 ask', () => {
    const gate = createPermissionGate({ mode: 'default' });
    gate.addSessionRule?.({
      toolName: 'bash',
      decision: 'allow',
      inputPrefix: { key: 'command', prefix: 'git status' },
    });
    expect(gate.evaluate(bashCall('git push origin main'), 'execute').decision).toBe('ask');
    expect(gate.evaluate(bashCall('ls'), 'execute').decision).toBe('ask');
  });

  it('静态 deny 盖过 session 放行（防静默提权）', () => {
    const gate = createPermissionGate({
      mode: 'default',
      rules: [{ toolName: 'bash', decision: 'deny' }],
    });
    gate.addSessionRule?.({
      toolName: 'bash',
      decision: 'allow',
      inputPrefix: { key: 'command', prefix: 'git status' },
    });
    expect(gate.evaluate(bashCall('git status'), 'execute').decision).toBe('deny');
  });

  it('clearSessionRules 清空后恢复 ask', () => {
    const gate = createPermissionGate({ mode: 'default' });
    gate.addSessionRule?.({
      toolName: 'bash',
      decision: 'allow',
      inputPrefix: { key: 'command', prefix: 'git status' },
    });
    expect(gate.evaluate(bashCall('git status'), 'execute').decision).toBe('allow');
    gate.clearSessionRules?.();
    expect(gate.evaluate(bashCall('git status'), 'execute').decision).toBe('ask');
  });
});

describe('describeAllowPattern', () => {
  it('bash 取命令首两 token', () => {
    expect(describeAllowPattern('bash', { command: 'git status --porcelain' })).toEqual({
      key: 'command',
      prefix: 'git status',
      label: 'bash git status*',
    });
  });

  it('edit 系取完整 path', () => {
    expect(describeAllowPattern('edit-file', { path: '/a/b.ts' })).toEqual({
      key: 'path',
      prefix: '/a/b.ts',
      label: 'edit-file /a/b.ts*',
    });
  });

  it('无映射工具/空值/非字符串返回 null（UI 只给 once）', () => {
    expect(describeAllowPattern('spawn_agent', { task: 'x' })).toBeNull();
    expect(describeAllowPattern('ask-user', { question: 'x' })).toBeNull();
    expect(describeAllowPattern('bash', {})).toBeNull();
    expect(describeAllowPattern('bash', { command: '   ' })).toBeNull();
    expect(describeAllowPattern('bash', undefined)).toBeNull();
  });

  it('git 按 subcommand 记忆', () => {
    expect(describeAllowPattern('git', { subcommand: 'commit' })).toEqual({
      key: 'subcommand',
      prefix: 'commit',
      label: 'git commit*',
    });
    expect(describeAllowPattern('git', {})).toBeNull();
  });

  it('未知工具退回工具名级记忆（MCP 按服，其余按整工具名）', () => {
    expect(describeAllowPattern('myserver/mytool', { any: 1 })).toEqual({
      key: '__toolName',
      prefix: 'myserver/',
      label: 'myserver/*',
    });
    expect(describeAllowPattern('terminal', { action: 'send' })).toEqual({
      key: '__toolName',
      prefix: 'terminal',
      label: 'terminal*',
    });
    // 输入缺失也不影响工具名级推导
    expect(describeAllowPattern('terminal', undefined)).toEqual({
      key: '__toolName',
      prefix: 'terminal',
      label: 'terminal*',
    });
  });
  it('web-fetch 按工具维度记忆（一次 always 管所有 URL）', () => {
    expect(describeAllowPattern('web-fetch', { url: 'http://doc.zhoujusoft.com/docs/x' })).toEqual({
      key: '__toolName',
      prefix: 'web-fetch',
      label: 'web-fetch*',
    });
    // 输入内容不影响工具名级推导
    expect(describeAllowPattern('web-fetch', undefined)).toEqual({
      key: '__toolName',
      prefix: 'web-fetch',
      label: 'web-fetch*',
    });
  });

  it('web-fetch session 规则：跨站同样放行', () => {
    const gate = createPermissionGate({ mode: 'default' });
    const pattern = describeAllowPattern('web-fetch', {
      url: 'http://doc.zhoujusoft.com/docs/apaas/intro/',
    });
    expect(pattern).not.toBeNull();
    gate.addSessionRule?.({
      toolName: 'web-fetch',
      decision: 'allow',
      inputPrefix: { key: pattern!.key, prefix: pattern!.prefix },
      reason: 'test always',
    });
    for (const [id, url] of [
      ['c1', 'http://doc.zhoujusoft.com/docs/ai/intro/'],
      ['c2', 'http://bbs.zhoujusoft.com/x'],
      ['c3', 'https://gitee.com/zhoujusoft/jlcp'],
    ] as Array<[string, string]>) {
      expect(gate.evaluate({ id, toolName: 'web-fetch', input: { url } }, 'execute').decision, url).toBe(
        'allow'
      );
    }
  });
});

describe('always 规则匹配 hardening', () => {
  function bashGate(prefix: string) {
    const gate = createPermissionGate({ mode: 'default' });
    gate.addSessionRule?.({
      toolName: 'bash',
      decision: 'allow',
      inputPrefix: { key: 'command', prefix },
      reason: 'test always',
    });
    return gate;
  }

  function bashCall(command: string): ToolCall {
    return { id: 'c1', toolName: 'bash', input: { command } };
  }

  it('干净余部命中（精确/加参数）', () => {
    const gate = bashGate('git status');
    expect(gate.evaluate(bashCall('git status'), 'execute').decision).toBe('allow');
    expect(gate.evaluate(bashCall('git status --porcelain'), 'execute').decision).toBe('allow');
  });

  it('链式/替换/重定向/换行余部回落到问', () => {
    const gate = bashGate('git status');
    for (const cmd of [
      'git status && rm -rf ~',
      'git status; rm -rf ~',
      'git status || true',
      'git status | tee /tmp/x',
      'git status `id`',
      'git status $(id)',
      'git status > /tmp/x',
      'git status\nrm -rf ~',
      'git statuses',
    ]) {
      expect(gate.evaluate(bashCall(cmd), 'execute').decision, cmd).toBe('ask');
    }
  });

  it('git 规则按 subcommand 命中', () => {
    const gate = createPermissionGate({ mode: 'default' });
    gate.addSessionRule?.({
      toolName: 'git',
      decision: 'allow',
      inputPrefix: { key: 'subcommand', prefix: 'commit' },
      reason: 'test always',
    });
    expect(
      gate.evaluate({ id: 'c1', toolName: 'git', input: { subcommand: 'commit' } }, 'execute')
        .decision
    ).toBe('allow');
    expect(
      gate.evaluate({ id: 'c2', toolName: 'git', input: { subcommand: 'push' } }, 'execute')
        .decision
    ).toBe('ask');
  });

  it('工具名级规则：MCP 整服放行、异服仍问', () => {
    const gate = createPermissionGate({ mode: 'default' });
    gate.addSessionRule?.({
      toolName: 'myserver/mytool',
      decision: 'allow',
      inputPrefix: { key: '__toolName', prefix: 'myserver/' },
      reason: 'test always',
    });
    expect(
      gate.evaluate({ id: 'c1', toolName: 'myserver/other', input: {} }, 'execute').decision
    ).toBe('allow');
    expect(
      gate.evaluate({ id: 'c2', toolName: 'otherserver/mytool', input: {} }, 'execute').decision
    ).toBe('ask');
  });
});
