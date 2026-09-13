/**
 * acp-client.test.ts - AcpClient 单元测试
 *
 * 假 agent = `node -e <script>`：脚本化 stdio ndjson 应答，模拟
 * initialize / session/new / session/prompt / session/update 流。
 * 不触网、不依赖真实 claude-agent-acp。
 */

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcpClient, sanitizeChildEnv, type AcpAgentLaunchConfig, type AcpStreamEvent } from '../acp-client.js';

// ============================================================
// 假 agent fixture（stdio ndjson echo）
// ============================================================

/** 指向测试用假 ACP agent 脚本 */
export const FAKE_AGENT = fileURLToPath(new URL('./fake-acp-agent.mjs', import.meta.url));

function fakeConfig(scriptMode: string, extra: Partial<AcpAgentLaunchConfig> = {}): AcpAgentLaunchConfig {
  return {
    name: 'fake',
    command: process.execPath, // node
    args: [FAKE_AGENT, scriptMode],
    startupTimeoutMs: 15_000,
    promptTimeoutMs: 15_000,
    ...extra,
  };
}

// ============================================================
// 环境净化
// ============================================================

describe('sanitizeChildEnv', () => {
  it('剔除 CLAUDECODE / CLAUDE_CODE_* / CLAUDE_PID，保留其余与 extra', () => {
    const out = sanitizeChildEnv(
      {
        PATH: '/bin',
        CLAUDECODE: '1',
        CLAUDE_CODE_SESSION_ID: 'abc',
        CLAUDE_CODE_ENTRYPOINT: 'cli',
        CLAUDE_PID: '42',
        ANTHROPIC_API_KEY: 'sk-secret',
      },
      { MY_VAR: 'x' }
    );
    expect(out.CLAUDECODE).toBeUndefined();
    expect(out.CLAUDE_CODE_SESSION_ID).toBeUndefined();
    expect(out.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(out.CLAUDE_PID).toBeUndefined();
    expect(out.PATH).toBe('/bin');
    expect(out.ANTHROPIC_API_KEY).toBe('sk-secret');
    expect(out.MY_VAR).toBe('x');
  });
});

// ============================================================
// AcpClient
// ============================================================

describe('AcpClient', () => {
  it('spawn→prompt  happy path：聚合 agent_message_chunk，stopReason=end_turn', async () => {
    const client = await AcpClient.spawn(fakeConfig('happy'));
    const events: AcpStreamEvent[] = [];
    const result = await client.prompt('hello', (ev) => events.push(ev));

    expect(result.stopReason).toBe('end_turn');
    expect(result.text).toBe('Hi there!');
    // thought 聚合但不进 text
    expect(result.thought).toBe('thinking...');
    const chunks = events.filter((e) => e.kind === 'chunk');
    expect(chunks).toHaveLength(2); // 'Hi ' + 'there!'
    expect(events.at(-1)).toEqual({ kind: 'done', stopReason: 'end_turn', text: 'Hi there!' });

    await client.dispose();
  });

  it('requestPermission：自动选择 allow_once 并记录 toolCall', async () => {
    const client = await AcpClient.spawn(fakeConfig('permission'));
    const result = await client.prompt('run it');
    // 假 agent 在收到 prompt 后反向 requestPermission，拿到 allow_once 才会回 done
    expect(result.stopReason).toBe('end_turn');
    expect(result.text).toContain('PERMISSION_GRANTED:allow_once_1');
    await client.dispose();
  });

  it('stopReason=refusal 原样透出', async () => {
    const client = await AcpClient.spawn(fakeConfig('refuse'));
    const result = await client.prompt('bad task');
    expect(result.stopReason).toBe('refusal');
    await client.dispose();
  });

  it('子进程启动失败 → AcpClientError(SPAWN_ERROR)', async () => {
    await expect(
      AcpClient.spawn({ name: 'ghost', command: '/nonexistent/acp-agent-xyz' })
    ).rejects.toMatchObject({ name: 'AcpClientError' });
  });

  it('prompt 超时 → TIMEOUT 且 dispose 后子进程退出', async () => {
    const client = await AcpClient.spawn(fakeConfig('hang', { promptTimeoutMs: 800 }));
    await expect(client.prompt('forever')).rejects.toThrow(/timed out/);
    await client.dispose();
    expect(client.dispose).toBeDefined(); // 幂等可再调
    await client.dispose();
  });

  it('agent 中途退出 → PROCESS_EXITED（带 stderr 尾部）', async () => {
    const client = await AcpClient.spawn(fakeConfig('crash'));
    await expect(client.prompt('die')).rejects.toThrow(/exited|PROCESS/i);
    await client.dispose();
  });

  it('dispose 回收整个进程组（wrapper 派生的孙进程不泄漏）', async () => {
    // 模拟 `npx → node fake-agent` 两级结构：/bin/sh 是直接子进程（wrapper），
    // node fake-agent 是孙进程；fake agent 启动时把自身 PID 写入 pidFile。
    const pidFile = join(tmpdir(), `acp-pgtest-${Date.now()}.pid`);
    const client = await AcpClient.spawn(
      fakeConfig('pidfile', {
        command: '/bin/sh',
        args: ['-c', `${process.execPath} ${FAKE_AGENT} pidfile`],
        env: { ACP_PID_FILE: pidFile },
      })
    );
    const result = await client.prompt('hello');
    expect(result.stopReason).toBe('end_turn');

    const grandchildPid = parseInt(await readFile(pidFile, 'utf8'), 10);
    expect(Number.isFinite(grandchildPid)).toBe(true);
    // 生前可探测
    expect(() => process.kill(grandchildPid, 0)).not.toThrow();

    await client.dispose();
    await new Promise((r) => setTimeout(r, 400)); // 组信号传播

    // 孙进程必须随进程组一起被回收（ESRCH）
    let alive = true;
    try {
      process.kill(grandchildPid, 0);
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);
    await rm(pidFile, { force: true });
  });
});
