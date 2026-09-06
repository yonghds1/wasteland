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

(async () => {
  enableDebugLog();

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'typewriter-test-'));
  const sessionManager = new SessionManager(path.join(tempRoot, 'sessions'));
  await sessionManager.startSession({ cwd: tempRoot, mode: 'single', providerId: 'minimax' });

  const registry = createDefaultProviderRegistry();
  const provider = registry.resolve('minimax', {
    type: 'openai-compatible',
    baseUrl: 'https://api.minimaxi.com/v1',
    apiKey: 'sk-cp-KxUYDKe08VsjuORSWiotmwStWne7diQ7UqXeIRHTLBuXpOuAsE_IuQiyIfwViKCT1I9nvu2Yom9IL4uOtm1U6Hb6YOGqAVJ6lnriTSTYF7sgRT-AqgWGcM0',
    model: 'MiniMax-M3',
  });

  const eventTypes: Array<{ type: string; ms: number; len?: number }> = [];
  const start = Date.now();

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
      tap((e: { type: string; chunk?: string; content?: string }) =>
        eventTypes.push({ type: e.type, ms: Date.now() - start, len: e.chunk?.length })
      ),
      toArray()
    )
  );

  console.log('\n=== events$ 流式接收情况 ===');
  const grouped: Record<string, number> = {};
  eventTypes.forEach((e) => (grouped[e.type] = (grouped[e.type] || 0) + 1));
  console.log('事件统计:', grouped);

  console.log('\n=== 详细时间线 ===');
  eventTypes.forEach((e, i) => {
    const len = e.len ? ` len=${e.len}` : '';
    console.log(`  #${i + 1}  +${e.ms}ms  ${e.type}${len}`);
  });

  await sessionManager.closeAll();
  await rm(tempRoot, { recursive: true, force: true });
})();