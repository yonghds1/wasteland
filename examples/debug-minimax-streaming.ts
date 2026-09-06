/**
 * debug-minimax-streaming.ts - 用真实 minimax API 跑一次流式回复，
 * 触发 debug.log 写入，再分析 chunk 实际到达节奏。
 */

import { runAgentLoop } from '../src/core/runtime/agent-loop.js';
import { enableDebugLog } from '../src/core/runtime/debug-logger.js';
import { createDefaultProviderRegistry } from '../src/providers/provider-registry.js';
import { SessionManager } from '../src/core/runtime/session-manager.js';
import { createPermissionGate } from '../src/core/runtime/permission-gate.js';
import { ToolRegistry } from '../src/tools/core/tool-registry.js';
import { of, tap, toArray, lastValueFrom } from 'rxjs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

enableDebugLog();

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'minimax-stream-test-'));
const sessionDir = path.join(tempRoot, 'sessions');
const sessionManager = new SessionManager(sessionDir);
await sessionManager.startSession({ cwd: tempRoot, mode: 'single', providerId: 'minimax' });

const registry = createDefaultProviderRegistry();
const provider = registry.resolve('minimax', {
  type: 'openai-compatible',
  baseUrl: 'https://api.minimaxi.com/v1',
  apiKey: 'sk-cp-KxUYDKe08VsjuORSWiotmwStWne7diQ7UqXeIRHTLBuXpOuAsE_IuQiyIfwViKCT1I9nvu2Yom9IL4uOtm1U6Hb6YOGqAVJ6lnriTSTYF7sgRT-AqgWGcM0',
  model: 'MiniMax-M3',
});

const chunkTimes: Array<{ ms: number; len: number }> = [];
const startTime = Date.now();

await lastValueFrom(
  runAgentLoop({
    input$: of({ turn: 1, content: '用一句话介绍你自己', source: 'message' }),
    provider,
    sessionManager,
    toolRegistry: new ToolRegistry([]),
    permissionGate: createPermissionGate({ mode: 'bypass_permissions' }),
    cwd: tempRoot,
    mode: 'single',
    debug: true,
  }).events$.pipe(
    tap((e) => {
      if (e.type === 'assistant_chunk') {
        chunkTimes.push({ ms: Date.now() - startTime, len: e.chunk.length });
      }
    }),
    toArray()
  )
);

console.log('\n=== 内存中 events$ 收到的 chunk 时间 ===');
console.log(`总 chunk 数: ${chunkTimes.length}`);
chunkTimes.forEach((c, i) => console.log(`  #${i + 1}  t=${c.ms}ms  len=${c.len}`));

const span = chunkTimes.length > 1 ? chunkTimes[chunkTimes.length - 1].ms - chunkTimes[0].ms : 0;
console.log(`\n首末跨度: ${span}ms`);

await sessionManager.closeAll();
await rm(tempRoot, { recursive: true, force: true });