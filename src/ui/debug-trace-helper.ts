/**
 * debug-trace-helper.ts - CLI 侧 debug 追踪装配
 *
 * 从 `core/shared/run-agent-helpers.ts` 迁出：该逻辑调用 UI 渲染器
 *（`renderDebugTrace` 写 stderr / 落盘 traceDir），按分层只能住在 UI 层。
 * chat / resume 的 `runAgentLoop` 公共装配仍在 core，此处只负责追踪输出。
 */

import { resolveDefaultTraceDir } from '@config/paths.js';
import { renderDebugTrace, type DebugFormat } from './debug-renderer.js';
import type { AgentRunResult } from '@core/shared/run-agent-helpers.js';

/**
 * debug 追踪装配块（chat / resume 曾逐字重复）。
 * debug 关闭时 no-op；`jsonl` 格式才需要 traceDir 落盘。
 */
export function attachDebugTrace(
  work: Promise<void>[],
  debug$: AgentRunResult['debug$'],
  opts: {
    debug: boolean;
    debugFormat: DebugFormat;
    cwd: string;
    projectConfigDir: string | null;
  }
): void {
  if (!opts.debug) return;
  const traceDir =
    opts.debugFormat === 'jsonl'
      ? resolveDefaultTraceDir({
          cwd: opts.cwd,
          projectConfigDir: opts.projectConfigDir,
        })
      : undefined;

  work.unshift(
    renderDebugTrace(debug$, {
      output: process.stderr,
      format: opts.debugFormat,
      traceDir,
    })
  );
}
