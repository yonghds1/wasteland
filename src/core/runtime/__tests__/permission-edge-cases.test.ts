/**
 * permission-edge-cases.test.ts - PermissionGate 边界情况测试
 *
 * 覆盖范围：
 * - deny/ask/bypass 全局模式
 * - 混合模式（多规则冲突、规则与模式交互）
 * - 并发调用一致性
 * - 边界：空工具名、特殊风险级别组合、规则覆盖链
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
  type PermissionMode,
  type PermissionRule,
  type PermissionDecision
} from '../../engine/permission-gate.js';
import type { ToolCall, ToolRiskLevel } from '@tools/core/tool-types.js';

// ============================================================
// Helpers
// ============================================================

function makeCall(toolName = 'test-tool', input: Record<string, unknown> = {}): ToolCall {
  return { id: 'call-1', toolName, input };
}

const ALL_RISK_LEVELS: ToolRiskLevel[] = ['read', 'write', 'execute'];

// ============================================================
// Tests
// ============================================================

describe('permission-edge-cases', () => {
  // ----------------------------------------------------------
  // 全局 deny 模式
  // ----------------------------------------------------------

  describe('global deny mode', () => {
    it('should deny all risk levels when global deny rule is set', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [{ decision: 'deny' }],
      });

      for (const risk of ALL_RISK_LEVELS) {
        const result = gate.evaluate(makeCall(), risk);
        expect(result.decision).toBe('deny');
      }
    });

    it('should deny all risk levels with bypass mode when deny rule overrides', () => {
      const gate = createPermissionGate({
        mode: 'bypass_permissions',
        rules: [{ decision: 'deny' }],
      });

      for (const risk of ALL_RISK_LEVELS) {
        const result = gate.evaluate(makeCall(), risk);
        expect(result.decision).toBe('deny');
      }
    });

    it('should deny all risk levels with accept_edits mode when deny rule overrides', () => {
      const gate = createPermissionGate({
        mode: 'accept_edits',
        rules: [{ decision: 'deny' }],
      });

      for (const risk of ALL_RISK_LEVELS) {
        const result = gate.evaluate(makeCall(), risk);
        expect(result.decision).toBe('deny');
      }
    });

    it('should deny even read operations when global deny rule is set', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [{ decision: 'deny' }],
      });

      const result = gate.evaluate(makeCall(), 'read');
      expect(result.decision).toBe('deny');
      expect(result.mode).toBe('default');
    });
  });

  // ----------------------------------------------------------
  // 全局 ask 模式
  // ----------------------------------------------------------

  describe('global ask mode', () => {
    it('should ask all risk levels when global ask rule is set', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [{ decision: 'ask' }],
      });

      for (const risk of ALL_RISK_LEVELS) {
        const result = gate.evaluate(makeCall(), risk);
        expect(result.decision).toBe('ask');
      }
    });

    it('should ask even read operations when global ask rule is set', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [{ decision: 'ask' }],
      });

      const result = gate.evaluate(makeCall(), 'read');
      expect(result.decision).toBe('ask');
    });

    it('should ask with bypass mode when ask rule overrides', () => {
      const gate = createPermissionGate({
        mode: 'bypass_permissions',
        rules: [{ decision: 'ask' }],
      });

      for (const risk of ALL_RISK_LEVELS) {
        const result = gate.evaluate(makeCall(), risk);
        expect(result.decision).toBe('ask');
        expect(result.mode).toBe('bypass_permissions');
      }
    });
  });

  // ----------------------------------------------------------
  // 全局 bypass 模式（无规则）
  // ----------------------------------------------------------

  describe('global bypass mode (no rules)', () => {
    it('should allow all risk levels in bypass mode', () => {
      const gate = createPermissionGate({ mode: 'bypass_permissions' });

      for (const risk of ALL_RISK_LEVELS) {
        const result = gate.evaluate(makeCall(), risk);
        expect(result.decision).toBe('allow');
        expect(result.mode).toBe('bypass_permissions');
      }
    });

    it('should return bypass reason for all risk levels', () => {
      const gate = createPermissionGate({ mode: 'bypass_permissions' });

      for (const risk of ALL_RISK_LEVELS) {
        const result = gate.evaluate(makeCall(), risk);
        expect(result.reason).toContain('permissionBypass');
      }
    });
  });

  // ----------------------------------------------------------
  // 混合模式：多规则冲突
  // ----------------------------------------------------------

  describe('mixed rules conflicts', () => {
    it('should use first matching rule when multiple rules match same call', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [
          { toolName: 'bash', decision: 'deny' },
          { toolName: 'bash', decision: 'allow' },
          { toolName: 'bash', decision: 'ask' },
        ],
      });

      const result = gate.evaluate(makeCall('bash'), 'execute');
      expect(result.decision).toBe('deny');
    });

    it('should resolve conflicting rules by order, not by decision kind', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [
          { decision: 'allow' },
          { decision: 'deny' },
        ],
      });

      // First rule matches (allow), so all calls are allowed
      const result = gate.evaluate(makeCall('any-tool'), 'write');
      expect(result.decision).toBe('allow');
    });

    it('should apply narrow rule before broad rule when narrow comes first', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [
          { toolName: 'bash', riskLevel: 'execute', decision: 'deny' },
          { decision: 'allow' },
        ],
      });

      // Narrow rule matches
      const r1 = gate.evaluate(makeCall('bash'), 'execute');
      expect(r1.decision).toBe('deny');

      // Broad rule matches for other calls
      const r2 = gate.evaluate(makeCall('bash'), 'read');
      expect(r2.decision).toBe('allow');

      const r3 = gate.evaluate(makeCall('other'), 'execute');
      expect(r3.decision).toBe('allow');
    });

    it('should apply broad rule before narrow rule when broad comes first', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [
          { decision: 'allow' },
          { toolName: 'bash', riskLevel: 'execute', decision: 'deny' },
        ],
      });

      // Broad rule matches first for everything
      const r1 = gate.evaluate(makeCall('bash'), 'execute');
      expect(r1.decision).toBe('allow');

      const r2 = gate.evaluate(makeCall('bash'), 'read');
      expect(r2.decision).toBe('allow');
    });
  });

  // ----------------------------------------------------------
  // 混合模式：规则与模式交互
  // ----------------------------------------------------------

  describe('rules and mode interaction', () => {
    it('should override default mode with deny rule', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [{ riskLevel: 'read', decision: 'deny' }],
      });

      const result = gate.evaluate(makeCall(), 'read');
      expect(result.decision).toBe('deny');
      expect(result.mode).toBe('default');
    });

    it('should override accept_edits mode with deny rule', () => {
      const gate = createPermissionGate({
        mode: 'accept_edits',
        rules: [{ riskLevel: 'write', decision: 'deny' }],
      });

      const result = gate.evaluate(makeCall(), 'write');
      expect(result.decision).toBe('deny');
      expect(result.mode).toBe('accept_edits');
    });

    it('should override bypass mode with ask rule', () => {
      const gate = createPermissionGate({
        mode: 'bypass_permissions',
        rules: [{ toolName: 'dangerous-tool', decision: 'ask' }],
      });

      const result = gate.evaluate(makeCall('dangerous-tool'), 'execute');
      expect(result.decision).toBe('ask');
      expect(result.mode).toBe('bypass_permissions');
    });

    it('should override bypass mode with deny rule', () => {
      const gate = createPermissionGate({
        mode: 'bypass_permissions',
        rules: [{ toolName: 'blocked-tool', decision: 'deny' }],
      });

      const result = gate.evaluate(makeCall('blocked-tool'), 'write');
      expect(result.decision).toBe('deny');
      expect(result.mode).toBe('bypass_permissions');
    });

    it('should let mode handle non-matching rules', () => {
      const gate = createPermissionGate({
        mode: 'accept_edits',
        rules: [{ toolName: 'bash', decision: 'deny' }],
      });

      // bash gets deny from rule
      const r1 = gate.evaluate(makeCall('bash'), 'execute');
      expect(r1.decision).toBe('deny');

      // other tool falls through to accept_edits mode
      const r2 = gate.evaluate(makeCall('read-file'), 'write');
      expect(r2.decision).toBe('allow');
    });
  });

  // ----------------------------------------------------------
  // 混合模式：所有风险级别 x 所有决策组合
  // ----------------------------------------------------------

  describe('risk level x decision matrix', () => {
    it('should handle allow rule for all risk levels', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [{ decision: 'allow' }],
      });

      for (const risk of ALL_RISK_LEVELS) {
        expect(gate.evaluate(makeCall(), risk).decision).toBe('allow');
      }
    });

    it('should handle ask rule for all risk levels', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [{ decision: 'ask' }],
      });

      for (const risk of ALL_RISK_LEVELS) {
        expect(gate.evaluate(makeCall(), risk).decision).toBe('ask');
      }
    });

    it('should handle deny rule for all risk levels', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [{ decision: 'deny' }],
      });

      for (const risk of ALL_RISK_LEVELS) {
        expect(gate.evaluate(makeCall(), risk).decision).toBe('deny');
      }
    });

    it('should handle per-risk-level rules correctly', () => {
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

  // ----------------------------------------------------------
  // 并发调用：一致性
  // ----------------------------------------------------------

  describe('concurrent calls consistency', () => {
    it('should produce consistent results for identical concurrent calls', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [{ toolName: 'bash', decision: 'deny' }],
      });

      const results: PermissionDecision[] = [];
      // Simulate 100 concurrent evaluations
      for (let i = 0; i < 100; i++) {
        results.push(gate.evaluate(makeCall('bash'), 'execute'));
      }

      // All results should be identical
      const firstResult = results[0];
      for (const result of results) {
        expect(result.decision).toBe(firstResult.decision);
        expect(result.mode).toBe(firstResult.mode);
        expect(result.reason).toBe(firstResult.reason);
      }
    });

    it('should handle interleaved calls to different tools consistently', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [
          { toolName: 'bash', decision: 'deny' },
          { toolName: 'read-file', decision: 'allow' },
        ],
      });

      // Simulate interleaved calls
      const tools = ['bash', 'read-file', 'bash', 'read-file', 'bash'];
      const results = tools.map((tool) => gate.evaluate(makeCall(tool), 'execute'));

      expect(results[0].decision).toBe('deny');   // bash
      expect(results[1].decision).toBe('allow');  // read-file (rule matches: allow)
      expect(results[2].decision).toBe('deny');   // bash
      expect(results[3].decision).toBe('allow');  // read-file
      expect(results[4].decision).toBe('deny');   // bash
    });

    it('should handle multiple gate instances independently', () => {
      const gate1 = createPermissionGate({
        mode: 'default',
        rules: [{ decision: 'deny' }],
      });

      const gate2 = createPermissionGate({
        mode: 'bypass_permissions',
      });

      // gate1 denies everything
      expect(gate1.evaluate(makeCall(), 'read').decision).toBe('deny');
      expect(gate1.evaluate(makeCall(), 'write').decision).toBe('deny');

      // gate2 allows everything (bypass mode, no rules)
      expect(gate2.evaluate(makeCall(), 'read').decision).toBe('allow');
      expect(gate2.evaluate(makeCall(), 'write').decision).toBe('allow');

      // Verify gate1 is still independent
      expect(gate1.evaluate(makeCall(), 'execute').decision).toBe('deny');
    });

    it('should handle rapid repeated evaluations on same gate without state mutation', () => {
      const gate = createPermissionGate({
        mode: 'accept_edits',
        rules: [{ riskLevel: 'execute', decision: 'ask' }],
      });

      const call = makeCall('bash');
      // Evaluate 50 times rapidly
      for (let i = 0; i < 50; i++) {
        const result = gate.evaluate(call, 'execute');
        expect(result.decision).toBe('ask');
        expect(result.mode).toBe('accept_edits');
      }
    });
  });

  // ----------------------------------------------------------
  // 并发调用：不同风险级别混合
  // ----------------------------------------------------------

  describe('concurrent mixed risk levels', () => {
    it('should handle alternating risk levels consistently', () => {
      const gate = createPermissionGate({ mode: 'default' });

      const riskPattern: ToolRiskLevel[] = ['read', 'write', 'execute', 'read', 'write', 'execute'];
      const expectedDecisions = ['allow', 'ask', 'ask', 'allow', 'ask', 'ask'];

      riskPattern.forEach((risk, i) => {
        const result = gate.evaluate(makeCall(), risk);
        expect(result.decision).toBe(expectedDecisions[i]);
      });
    });

    it('should maintain decision boundaries across risk level transitions', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [
          { riskLevel: 'read', decision: 'allow' },
          { riskLevel: 'write', decision: 'deny' },
          { riskLevel: 'execute', decision: 'ask' },
        ],
      });

      // Rapidly alternate between risk levels
      const sequence: ToolRiskLevel[] = ['read', 'write', 'execute', 'read', 'write', 'execute', 'read'];
      const results = sequence.map((risk) => gate.evaluate(makeCall(), risk));

      expect(results[0].decision).toBe('allow');   // read
      expect(results[1].decision).toBe('deny');    // write
      expect(results[2].decision).toBe('ask');     // execute
      expect(results[3].decision).toBe('allow');   // read
      expect(results[4].decision).toBe('deny');    // write
      expect(results[5].decision).toBe('ask');     // execute
      expect(results[6].decision).toBe('allow');   // read
    });
  });

  // ----------------------------------------------------------
  // 特殊边界：空输入和工具名
  // ----------------------------------------------------------

  describe('special edge cases', () => {
    it('should handle empty tool name', () => {
      const gate = createPermissionGate({ mode: 'default' });
      const result = gate.evaluate(makeCall(''), 'read');
      expect(result.decision).toBe('allow');
      expect(result.mode).toBe('default');
    });

    it('should handle tool name with special characters', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [{ toolName: 'my-tool_v2.0', decision: 'deny' }],
      });

      const r1 = gate.evaluate(makeCall('my-tool_v2.0'), 'write');
      expect(r1.decision).toBe('deny');

      const r2 = gate.evaluate(makeCall('my-tool_v2'), 'write');
      expect(r2.decision).toBe('ask');
    });

    it('should handle very long tool name', () => {
      const longName = 'a'.repeat(1000);
      const gate = createPermissionGate({
        mode: 'default',
        rules: [{ toolName: longName, decision: 'allow' }],
      });

      const result = gate.evaluate(makeCall(longName), 'execute');
      expect(result.decision).toBe('allow');
    });

    it('should handle rule with empty reason string', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [{ toolName: 'bash', decision: 'deny', reason: '' }],
      });

      const result = gate.evaluate(makeCall('bash'), 'execute');
      expect(result.decision).toBe('deny');
      expect(result.reason).toBe('');
    });

    it('should include toolName in default reason when no custom reason', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [{ toolName: 'special-tool', decision: 'deny' }],
      });

      const result = gate.evaluate(makeCall('special-tool'), 'execute');
      expect(result.reason).toContain('special-tool');
    });
  });

  // ----------------------------------------------------------
  // 边界：规则数量
  // ----------------------------------------------------------

  describe('rule count boundaries', () => {
    it('should work with exactly one rule', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [{ decision: 'deny' }],
      });

      expect(gate.evaluate(makeCall(), 'read').decision).toBe('deny');
    });

    it('should work with many rules and apply first match', () => {
      const rules: PermissionRule[] = [];
      // Add 10 non-matching rules
      for (let i = 0; i < 10; i++) {
        rules.push({ toolName: `tool-${i}`, decision: 'allow' });
      }
      // Add matching rule at end
      rules.push({ decision: 'deny' });

      const gate = createPermissionGate({ mode: 'default', rules });
      // Should fall through all non-matching rules and hit the last one
      expect(gate.evaluate(makeCall('unmatched-tool'), 'read').decision).toBe('deny');
    });

    it('should handle rules that partially match different tools', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [
          { toolName: 'tool-a', riskLevel: 'read', decision: 'deny' },
          { toolName: 'tool-b', riskLevel: 'read', decision: 'ask' },
          { toolName: 'tool-c', riskLevel: 'read', decision: 'allow' },
        ],
      });

      expect(gate.evaluate(makeCall('tool-a'), 'read').decision).toBe('deny');
      expect(gate.evaluate(makeCall('tool-b'), 'read').decision).toBe('ask');
      expect(gate.evaluate(makeCall('tool-c'), 'read').decision).toBe('allow');
      // Non-matching tools fall through to mode
      expect(gate.evaluate(makeCall('tool-d'), 'read').decision).toBe('allow');
    });
  });

  // ----------------------------------------------------------
  // 边界：模式切换语义
  // ----------------------------------------------------------

  describe('mode switching semantics', () => {
    it('should reflect mode in result for all modes', () => {
      const modes: PermissionMode[] = ['default', 'accept_edits', 'bypass_permissions'];

      for (const mode of modes) {
        const gate = createPermissionGate({ mode });
        const result = gate.evaluate(makeCall(), 'read');
        expect(result.mode).toBe(mode);
      }
    });

    it('should use mode for non-matching rules', () => {
      const gateDefault = createPermissionGate({
        mode: 'default',
        rules: [{ toolName: 'other', decision: 'deny' }],
      });

      const gateAcceptEdits = createPermissionGate({
        mode: 'accept_edits',
        rules: [{ toolName: 'other', decision: 'deny' }],
      });

      const gateBypass = createPermissionGate({
        mode: 'bypass_permissions',
        rules: [{ toolName: 'other', decision: 'deny' }],
      });

      const call = makeCall('bash');

      // default: execute -> ask
      expect(gateDefault.evaluate(call, 'execute').decision).toBe('ask');
      // accept_edits: execute -> ask
      expect(gateAcceptEdits.evaluate(call, 'execute').decision).toBe('ask');
      // bypass: execute -> allow
      expect(gateBypass.evaluate(call, 'execute').decision).toBe('allow');
    });
  });
});
