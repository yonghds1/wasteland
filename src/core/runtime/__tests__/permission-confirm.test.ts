/**
 * permission-confirm.test.ts - requestPermissionConfirmation 回答语义
 *
 * 覆盖：'yes' 放行、'always' 同样放行本次（规则注册由 UI 侧完成）、
 * 其他回答拒绝；非 ask 决策直接透传不经过 bridge。
 */

import { describe, it, expect } from 'vitest';
import { lastValueFrom } from 'rxjs';

import { requestPermissionConfirmation } from '../../engine/dispatch-utils.js';
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
