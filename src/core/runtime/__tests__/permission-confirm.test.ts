/**
 * permission-confirm.test.ts - requestPermissionConfirmation 回答语义
 *
 * 覆盖：'yes' 放行、'always' 同样放行本次（规则注册由 UI 侧完成）、
 * 其他回答拒绝；非 ask 决策直接透传不经过 bridge。
 * 另覆盖 resolveConfirmedDecision：allowed → 最终决策的映射（ask+允许 ⇒ allow）。
 */

import { describe, it, expect } from 'vitest';
import { lastValueFrom } from 'rxjs';

import {
  requestPermissionConfirmation,
  resolveConfirmedDecision,
} from '../../engine/dispatch-utils.js';
import type { PermissionDecision } from '../../engine/permission-gate.js';

const session = {
  id: 's',
  path: '/tmp/s.jsonl',
  cwd: '/tmp',
  mode: 'single' as const,
  providerId: 'local',
};
const call = { id: 'c1', toolName: 'bash', input: { command: 'git status' } };

function bridgeWith(answer: string) {
  return { requestInput: async () => answer };
}

const askDecision: PermissionDecision = { decision: 'ask', mode: 'default', reason: 'ask' };

describe('requestPermissionConfirmation', () => {
  it("'yes' → allowed", async () => {
    const result: any = await lastValueFrom(
      requestPermissionConfirmation(
        { session, turn: 1, call, userInputBridge: bridgeWith('yes') },
        askDecision
      )
    );
    expect((result as any).allowed).toBe(true);
  });

  it("'always' → allowed（本次放行；session 规则由 UI 侧注册）", async () => {
    const result: any = await lastValueFrom(
      requestPermissionConfirmation(
        { session, turn: 1, call, userInputBridge: bridgeWith('always') },
        askDecision
      )
    );
    expect((result as any).allowed).toBe(true);
    expect((result as any).askEvents[0]).toMatchObject({ type: 'user_input_received', answer: 'always' });
  });

  it("'no' → denied", async () => {
    const result: any = await lastValueFrom(
      requestPermissionConfirmation(
        { session, turn: 1, call, userInputBridge: bridgeWith('no') },
        askDecision
      )
    );
    expect((result as any).allowed).toBe(false);
  });

  it('非 ask 决策直接透传，不经过 bridge', async () => {
    const allowDecision: PermissionDecision = { decision: 'allow', mode: 'default', reason: 'ok' };
    const result: any = await lastValueFrom(
      requestPermissionConfirmation({ session, turn: 1, call }, allowDecision)
    );
    expect((result as any).allowed).toBe(true);
    expect((result as any).askEvents).toEqual([]);
  });
});

/**
 * resolveConfirmedDecision：allowed 标志 → 最终决策的映射。
 *
 * 这是「用户同意了却被 blocked」bug 的根因所在：ask + allowed 必须转 allow。
 */
describe('resolveConfirmedDecision', () => {
  it('ask + 允许 → allow（回归：曾经原样透传 ask 导致被拦）', () => {
    const decision = resolveConfirmedDecision(askDecision, true);
    expect(decision.decision).toBe('allow');
    expect(decision.mode).toBe('default');
  });

  it('ask + 拒绝 → deny，并在 reason 上标注用户拒绝', () => {
    const decision = resolveConfirmedDecision(askDecision, false);
    expect(decision.decision).toBe('deny');
    expect(decision.reason).toContain('用户拒绝');
  });

  it('本就 allow + 允许 → 原样透传，保留规则命中的 reason', () => {
    const ruleHit: PermissionDecision = {
      decision: 'allow',
      mode: 'default',
      reason: '工具规则命中：bash git status*',
    };
    expect(resolveConfirmedDecision(ruleHit, true)).toBe(ruleHit);
  });

  it('本就 deny 且拒绝 → 保持原 reason，不叠加「用户拒绝」', () => {
    const denied: PermissionDecision = { decision: 'deny', mode: 'default', reason: 'no write' };
    const decision = resolveConfirmedDecision(denied, false);
    expect(decision.decision).toBe('deny');
    expect(decision.reason).toBe('no write');
  });
});
