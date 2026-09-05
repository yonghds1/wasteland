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
  createPermissionGate
} from '../permission-gate.js';
import type { ToolCall } from '../../../tools/tool-types.js';

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
