/**
 * openai-permission.test.ts - OpenAI Provider 与权限系统集成测试
 *
 * 测试权限系统在 OpenAI Provider 工具调用场景下的行为：
 * - 权限通过（allow）：读取工具自动放行
 * - 权限拒绝（deny）：自定义规则拒绝特定工具
 * - 权限询问（ask）：写入/执行工具需要确认
 * - bypass 模式：跳过所有权限检查
 */

import { describe, it, expect } from 'vitest';
import { createPermissionGate } from '../../core/engine/permission-gate.js';
import type { ToolCall, ToolRiskLevel } from '@tools/core/tool-types.js';
import type { PermissionGate, PermissionDecision } from '../../core/engine/permission-gate.js';

// ============================================================
// 测试辅助
// ============================================================

/** 创建测试用的 ToolCall */
function createToolCall(
  id: string,
  toolName: string,
  input: Record<string, unknown> = {}
): ToolCall {
  return { id, toolName, input };
}

/** 收集 evaluate 结果并断言结构 */
function evaluateAndAssert(
  gate: PermissionGate,
  call: ToolCall,
  riskLevel: ToolRiskLevel,
  expected: Partial<PermissionDecision>
): PermissionDecision {
  const decision = gate.evaluate(call, riskLevel);
  expect(decision).toHaveProperty('decision');
  expect(decision).toHaveProperty('mode');
  expect(decision).toHaveProperty('reason');
  if (expected.decision) expect(decision.decision).toBe(expected.decision);
  if (expected.mode) expect(decision.mode).toBe(expected.mode);
  return decision;
}

// ============================================================
// 测试用例
// ============================================================

describe('OpenAI Provider 权限系统集成', () => {
  describe('权限通过（allow）', () => {
    it('read 工具在 default 模式下自动放行', () => {
      const gate = createPermissionGate({ mode: 'default' });
      const call = createToolCall('call-1', 'read-file', { path: '/tmp/test.txt' });
      evaluateAndAssert(gate, call, 'read', {
        decision: 'allow',
        mode: 'default',
      });
    });

    it('write 工具在 bypass_permissions 模式下自动放行', () => {
      const gate = createPermissionGate({ mode: 'bypass_permissions' });
      const call = createToolCall('call-2', 'write-file', { path: '/tmp/out.txt', content: 'data' });
      evaluateAndAssert(gate, call, 'write', {
        decision: 'allow',
        mode: 'bypass_permissions',
      });
    });

    it('execute 工具在 bypass_permissions 模式下自动放行', () => {
      const gate = createPermissionGate({ mode: 'bypass_permissions' });
      const call = createToolCall('call-3', 'bash', { command: 'ls -la' });
      evaluateAndAssert(gate, call, 'execute', {
        decision: 'allow',
        mode: 'bypass_permissions',
      });
    });

    it('read 和 write 工具在 accept_edits 模式下自动放行', () => {
      const gate = createPermissionGate({ mode: 'accept_edits' });
      const readCall = createToolCall('call-4', 'read-file', { path: '/tmp/test.txt' });
      const writeCall = createToolCall('call-5', 'write-file', { path: '/tmp/out.txt' });
      evaluateAndAssert(gate, readCall, 'read', {
        decision: 'allow',
        mode: 'accept_edits',
      });
      evaluateAndAssert(gate, writeCall, 'write', {
        decision: 'allow',
        mode: 'accept_edits',
      });
    });
  });

  describe('权限拒绝（deny）', () => {
    it('自定义规则拒绝特定工具', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [
          {
            toolName: 'bash',
            decision: 'deny',
            reason: 'shell 执行被禁用',
          },
        ],
      });
      const call = createToolCall('call-6', 'bash', { command: 'rm -rf /' });
      evaluateAndAssert(gate, call, 'execute', {
        decision: 'deny',
        mode: 'default',
      });
    });

    it('按风险等级拒绝规则', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [
          {
            riskLevel: 'execute',
            decision: 'deny',
            reason: '所有执行操作被禁止',
          },
        ],
      });
      const call = createToolCall('call-7', 'bash', { command: 'echo hello' });
      evaluateAndAssert(gate, call, 'execute', {
        decision: 'deny',
        mode: 'default',
      });
    });

    it('拒绝规则的 reason 被保留', () => {
      const reason = '企业安全策略禁止此操作';
      const gate = createPermissionGate({
        mode: 'bypass_permissions',
        rules: [
          {
            toolName: 'git-push',
            decision: 'deny',
            reason,
          },
        ],
      });
      const call = createToolCall('call-8', 'git-push', { branch: 'main' });
      const decision = gate.evaluate(call, 'execute');
      expect(decision.reason).toBe(reason);
    });
  });

  describe('权限询问（ask）', () => {
    it('execute 工具在 default 模式下需要确认', () => {
      const gate = createPermissionGate({ mode: 'default' });
      const call = createToolCall('call-9', 'bash', { command: 'npm test' });
      evaluateAndAssert(gate, call, 'execute', {
        decision: 'ask',
        mode: 'default',
      });
    });

    it('execute 工具在 accept_edits 模式下需要确认', () => {
      const gate = createPermissionGate({ mode: 'accept_edits' });
      const call = createToolCall('call-10', 'bash', { command: 'npm run build' });
      evaluateAndAssert(gate, call, 'execute', {
        decision: 'ask',
        mode: 'accept_edits',
      });
    });

    it('write 工具在 default 模式下需要确认', () => {
      const gate = createPermissionGate({ mode: 'default' });
      const call = createToolCall('call-11', 'write-file', { path: '/tmp/output.txt' });
      evaluateAndAssert(gate, call, 'write', {
        decision: 'ask',
        mode: 'default',
      });
    });

    it('自定义规则可以强制 ask', () => {
      const gate = createPermissionGate({
        mode: 'bypass_permissions',
        rules: [
          {
            toolName: 'git-push',
            decision: 'ask',
            reason: '推送前需要确认',
          },
        ],
      });
      const call = createToolCall('call-12', 'git-push', { branch: 'main' });
      evaluateAndAssert(gate, call, 'execute', {
        decision: 'ask',
        mode: 'bypass_permissions',
      });
    });
  });

  describe('bypass 模式', () => {
    it('所有风险等级在 bypass 模式下自动放行', () => {
      const gate = createPermissionGate({ mode: 'bypass_permissions' });
      const riskLevels: ToolRiskLevel[] = ['read', 'write', 'execute'];

      for (const riskLevel of riskLevels) {
        const call = createToolCall(`call-bypass-${riskLevel}`, 'test-tool', {});
        evaluateAndAssert(gate, call, riskLevel, {
          decision: 'allow',
          mode: 'bypass_permissions',
        });
      }
    });

    it('bypass 模式覆盖所有工具名称', () => {
      const gate = createPermissionGate({ mode: 'bypass_permissions' });
      const toolNames = ['bash', 'write-file', 'git-push', 'spawn_agent'];

      for (const toolName of toolNames) {
        const call = createToolCall(`call-tool-${toolName}`, toolName, {});
        evaluateAndAssert(gate, call, 'execute', {
          decision: 'allow',
          mode: 'bypass_permissions',
        });
      }
    });

    it('bypass 模式下 reason 包含 permissionBypass 键', () => {
      const gate = createPermissionGate({ mode: 'bypass_permissions' });
      const call = createToolCall('call-reason', 'bash', { command: 'ls' });
      const decision = gate.evaluate(call, 'execute');
      expect(decision.reason).toContain('permissionBypass');
    });
  });

  describe('自定义规则优先级', () => {
    it('自定义规则优先于默认模式', () => {
      const gate = createPermissionGate({
        mode: 'bypass_permissions',
        rules: [
          {
            toolName: 'bash',
            decision: 'deny',
            reason: '自定义拒绝',
          },
        ],
      });
      const call = createToolCall('call-priority', 'bash', { command: 'ls' });
      // 自定义规则优先，即使 bypass 模式通常会放行
      evaluateAndAssert(gate, call, 'execute', {
        decision: 'deny',
        mode: 'bypass_permissions',
      });
    });

    it('第一个匹配的规则生效', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [
          {
            toolName: 'bash',
            decision: 'deny',
            reason: '第一条规则',
          },
          {
            toolName: 'bash',
            decision: 'allow',
            reason: '第二条规则',
          },
        ],
      });
      const call = createToolCall('call-first', 'bash', { command: 'ls' });
      const decision = gate.evaluate(call, 'execute');
      expect(decision.decision).toBe('deny');
      expect(decision.reason).toBe('第一条规则');
    });

    it('规则匹配时使用规则的 mode', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [
          {
            toolName: 'read-file',
            decision: 'allow',
          },
        ],
      });
      const call = createToolCall('call-mode', 'read-file', { path: '/tmp.txt' });
      const decision = gate.evaluate(call, 'read');
      expect(decision.mode).toBe('default');
    });
  });

  describe('边界情况', () => {
    it('无参数创建的 gate 使用 default 模式', () => {
      const gate = createPermissionGate();
      const call = createToolCall('call-default', 'read-file', {});
      const decision = gate.evaluate(call, 'read');
      expect(decision.mode).toBe('default');
      expect(decision.decision).toBe('allow');
    });

    it('空规则数组等同于无规则', () => {
      const gate = createPermissionGate({ mode: 'default', rules: [] });
      const call = createToolCall('call-empty', 'bash', {});
      const decision = gate.evaluate(call, 'execute');
      expect(decision.decision).toBe('ask');
      expect(decision.mode).toBe('default');
    });

    it('规则只匹配 toolName 时 riskLevel 不影响匹配', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [
          {
            toolName: 'bash',
            decision: 'deny',
          },
        ],
      });
      // bash 是 execute 风险，但规则只按 toolName 匹配
      const call = createToolCall('call-match', 'bash', { command: 'echo' });
      const decision = gate.evaluate(call, 'execute');
      expect(decision.decision).toBe('deny');
    });

    it('规则只匹配 riskLevel 时 toolName 不影响匹配', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [
          {
            riskLevel: 'write',
            decision: 'allow',
          },
        ],
      });
      const call = createToolCall('call-risk', 'write-file', { path: '/tmp.txt' });
      const decision = gate.evaluate(call, 'write');
      expect(decision.decision).toBe('allow');
    });

    it('不匹配的规则不影响默认行为', () => {
      const gate = createPermissionGate({
        mode: 'default',
        rules: [
          {
            toolName: 'bash',
            decision: 'deny',
          },
        ],
      });
      // read-file 不匹配 bash 规则，走默认模式
      const call = createToolCall('call-no-match', 'read-file', { path: '/tmp.txt' });
      const decision = gate.evaluate(call, 'read');
      expect(decision.decision).toBe('allow');
    });
  });

  describe('OpenAI Provider 场景模拟', () => {
    it('模拟 read-file 工具调用：default 模式允许', () => {
      const gate = createPermissionGate({ mode: 'default' });
      const call = createToolCall('openai-read', 'read-file', {
        path: '/workspace/src/index.ts',
      });
      evaluateAndAssert(gate, call, 'read', {
        decision: 'allow',
      });
    });

    it('模拟 edit-file 工具调用：default 模式需要确认', () => {
      const gate = createPermissionGate({ mode: 'default' });
      const call = createToolCall('openai-edit', 'edit-file', {
        path: '/workspace/src/index.ts',
        oldString: 'old code',
        newString: 'new code',
      });
      evaluateAndAssert(gate, call, 'write', {
        decision: 'ask',
      });
    });

    it('模拟 bash 工具调用：bypass 模式自动放行', () => {
      const gate = createPermissionGate({ mode: 'bypass_permissions' });
      const call = createToolCall('openai-bash', 'bash', {
        command: 'npm test',
      });
      evaluateAndAssert(gate, call, 'execute', {
        decision: 'allow',
      });
    });

    it('模拟 spawn_agent 工具调用：accept_edits 模式需要确认', () => {
      const gate = createPermissionGate({ mode: 'accept_edits' });
      const call = createToolCall('openai-spawn', 'spawn_agent', {
        task: 'refactor module',
      });
      evaluateAndAssert(gate, call, 'execute', {
        decision: 'ask',
      });
    });
  });
});
