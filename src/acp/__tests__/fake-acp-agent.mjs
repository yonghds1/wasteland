#!/usr/bin/env node
/**
 * fake-acp-agent.mjs - 脚本化 ACP agent，供 acp-client.test.ts 使用
 *
 * 走真实 newline-delimited JSON-RPC over stdio（与 ACP 协议一致），
 * 按 argv[2] 的 mode 决定行为。只应答 initialize / session/new /
 * session/prompt，并在 prompt 期按需推 session/update 通知。
 *
 * mode:
 *   happy      → 2 个 agent_message_chunk + 1 thought，end_turn，文本 "Hi there!"
 *   permission → prompt 期反向 request_permission，拿到选项后再 end_turn
 *   refuse     → 直接 stopReason=refusal
 *   hang       → 收到 prompt 后永不响应（测超时）
 *   crash      → 收到 prompt 后 process.exit(3)（带 stderr）测中途退出
 */

import readline from 'node:readline';
import { writeFileSync } from 'node:fs';

const mode = process.argv[2] ?? 'happy';

// 进程组回收测试：把自身 PID 写到 env 指定文件，供测试断言 dispose 后已死
if (process.env.ACP_PID_FILE) {
  writeFileSync(process.env.ACP_PID_FILE, String(process.pid));
}
const out = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const sendNotify = (method, params) => out({ jsonrpc: '2.0', method, params });

let pendingPromptId;
let pendingSessionId;
let awaitingPermId;

const rl = readline.createInterface({ input: process.stdin });

const sendUpdate = (sessionId, update) =>
  sendNotify('session/update', { sessionId, update });

rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;

  if (method === 'initialize') {
    out({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: false,
          promptCapabilities: { image: false, embeddedContext: false },
        },
        agentInfo: { name: 'fake-acp-agent', version: '0.0.0' },
      },
    });
    return;
  }

  if (method === 'session/new') {
    out({ jsonrpc: '2.0', id, result: { sessionId: 'fake-session-1' } });
    return;
  }

  if (method === 'session/prompt') {
    const sessionId = params?.sessionId ?? 'fake-session-1';
    if (mode === 'happy') {
      sendUpdate(sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking...' } });
      sendUpdate(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hi ' } });
      sendUpdate(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'there!' } });
      out({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
      return;
    }
    if (mode === 'refuse') {
      out({ jsonrpc: '2.0', id, result: { stopReason: 'refusal' } });
      return;
    }
    if (mode === 'hang') {
      return; // 永不应答
    }
    if (mode === 'crash') {
      process.stderr.write('fake agent crashing\n');
      setTimeout(() => process.exit(3), 20);
      return;
    }
    if (mode === 'permission') {
      // 反向请求：client 应自动回 allow_once_1
      const reqId = Math.floor(Math.random() * 1e6) + 1;
      out({
        jsonrpc: '2.0',
        id: reqId,
        method: 'session/request_permission',
        params: {
          sessionId,
          toolCall: { toolCallId: 'tc1', title: 'Write file', kind: 'edit', status: 'pending' },
          options: [
            { optionId: 'allow_once_1', name: 'Allow once', kind: 'allow_once' },
            { optionId: 'reject_1', name: 'Reject', kind: 'reject_once' },
          ],
        },
      });
      // 记下 prompt 的 id，等收到 client 对 reqId 的响应再回 end_turn
      pendingPromptId = id;
      pendingSessionId = sessionId;
      awaitingPermId = reqId;
      return;
    }
    out({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
    return;
  }

  // client → agent 的响应（针对 request_permission）
  if (id !== undefined && awaitingPermId === id) {
    const chosen = msg?.result?.outcome?.optionId ?? 'none';
    sendUpdate(pendingSessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `PERMISSION_GRANTED:${chosen}` } });
    out({ jsonrpc: '2.0', id: pendingPromptId, result: { stopReason: 'end_turn' } });
    awaitingPermId = undefined;
    return;
  }
});
