/**
 * run-agent-helpers.ts - runAgentLoop 调用点共享装配
 *
 * 收敛 `commands/chat.ts`、`commands/resume.ts`、`tui/hooks/useRuntime.ts`
 * 三处重复的 13 参数装配与退出清理。
 * 曾出现 resume 分支漏传 `loadedSettings`/`debug` 的不一致，由此统一消灭。
 *
 * 分层注意：本文件只依赖 core/config，不依赖任何 UI。
 * debug 追踪输出（renderDebugTrace 写 stderr/落盘）住在
 * `src/ui/debug-trace-helper.ts`，由 CLI 调用方自行装配。
 *
 * 规范依据：`.trellis/spec/backend/runtime-contracts.md`（runAgentLoop 调用契约）、
 * `.trellis/spec/backend/cli-tui-contracts.md`（CLI/TUI 共用 RuntimeContext）。
 */

import { composeAgentPrompt } from '@config/roles/index.js';
import { runAgentLoop } from '@core/engine/agent-loop.js';
import type { UserInputBridge } from '@core/engine/user-input-bridge.js';
import type { RuntimeEnvironment } from './initialize-runtime.js';

type LoopParams = Parameters<typeof runAgentLoop>[0];
export type AgentRunResult = ReturnType<typeof runAgentLoop>;

/**
 * 三调用点公共实参。调用方只关心差异项
 *（input$ / existingSession / initialHistory / abort$ / resolvePrompt）。
 */
export type BaseLoopArgs = {
  runtime: RuntimeEnvironment;
  cwd: string;
  mode: LoopParams['mode'];
  maxStepsPerTurn: number;
  /** 功能 prompt（会被 composeAgentPrompt 包上角色指令） */
  prompt?: string;
  /** CLI --debug 或 settings.runtime.debug（任一即开 runAgentLoop 落盘） */
  debug: boolean;
  userInputBridge?: UserInputBridge;
  abort$?: LoopParams['abort$'];
  existingSession?: LoopParams['existingSession'];
  initialHistory?: LoopParams['initialHistory'];
  resolvePrompt?: () => string;
};

/**
 * 装配公共实参并启动 runAgentLoop。
 * 主 Agent 默认挂载全量工具注册表（具备直接操作与 spawn_agent 协同能力）。
 */
export function startAgentLoop(
  args: BaseLoopArgs & { input$: LoopParams['input$'] }
): AgentRunResult {
  const { runtime } = args;
  return runAgentLoop({
    input$: args.input$,
    provider: runtime.provider,
    sessionManager: runtime.sessionManager,
    toolRegistry: runtime.toolRegistry,
    permissionGate: runtime.permissionGate,
    cwd: args.cwd,
    mode: args.mode,
    maxStepsPerTurn: args.maxStepsPerTurn,
    prompt: composeAgentPrompt(
      runtime.resolvedRuntime.role?.name ?? 'orchestrator',
      args.prompt
    ),
    providerRegistry: runtime.providerRegistry,
    providerSettings: runtime.resolvedRuntime.providerConfig,
    skillExecutor: runtime.skillExecutor,
    childAgentTimeout: runtime.loadedSettings.settings.runtime.childAgentTimeout,
    userInputBridge: args.userInputBridge,
    // debug 开启条件：settings.runtime.debug 或 CLI --debug flag
    debug: Boolean(args.debug || runtime.loadedSettings.settings.runtime.debug),
    // 透传给 dispatchToolCall → spawn-agent（读 multiAgent 配置 + 重试参数）
    loadedSettings: runtime.loadedSettings,
    abort$: args.abort$,
    existingSession: args.existingSession,
    initialHistory: args.initialHistory,
    resolvePrompt: args.resolvePrompt,
  });
}

/**
 * 退出清理：停止 MCP 服务器 + 本机托管的 A2A 服务器进程（避免进程泄漏）。
 */
export async function stopRuntimeAgents(
  runtime: Pick<RuntimeEnvironment, 'mcpManager' | 'a2aManager'>
): Promise<void> {
  await runtime.mcpManager.stopMCP();
  await runtime.a2aManager.stopA2AServers();
}
