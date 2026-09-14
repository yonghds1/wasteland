/**
 * use-runtime-unified.ts - 统一的 TUI Runtime Hook
 *
 * 使用 initializeRuntime() 和 TuiInputAdapter，
 * 替换原来的重复初始化代码。
 */

import { Subject } from 'rxjs';

import { initializeRuntime } from '@core/shared/initialize-runtime.js';
import type { AgentMode } from '@config/resolve-chat-runtime.js';
import {
  startAgentLoop,
} from '@core/shared/run-agent-helpers.js';
import { enableDebugLog, ensureFileSink } from '@core/runtime/debug-logger.js';
import { UserInputBridge } from '@core/engine/user-input-bridge.js';
import { composeAgentPrompt } from '@config/roles/index.js';
import { getAgentMode } from '@config/agent-mode-state.js';
import { resolveChatRuntime } from '@config/resolve-chat-runtime.js';
import { initI18n } from '@locales/index.js';
import type { PermissionMode } from '@core/engine/permission-gate.js';
import type { TuiRuntimeContext, TuiConfig, TuiFullConfig } from '../types.js';
import type { ChatInputTurn } from '@core/runtime/event-types.js';

/**
 * TUI 运行时上下文（扩展版，包含清理资源）
 */
interface InternalTuiRuntimeContext extends TuiRuntimeContext {
  stopMCP?: () => Promise<void>;
  userInputBridge?: UserInputBridge;
}

/**
 * 创建 TUI 运行时上下文
 *
 * 使用 initializeRuntime() 统一初始化逻辑。
 *
 * @param cwd - 当前工作目录
 * @param roleName - 角色名称（可选）
 * @param providerName - Provider 名称（可选，对应 --provider 选项）
 * @param mode - Agent 运行模式覆盖（可选，对应 --mode 选项；single/multi）
 * @returns TUI 运行时上下文
 */
export async function createTuiRuntime(
  cwd: string,
  roleName?: string,
  providerName?: string,
  mode?: AgentMode,
  permissionMode?: PermissionMode
): Promise<TuiRuntimeContext> {
  // 1. 使用 initializeRuntime() 统一初始化
  const runtime = await initializeRuntime({
    cwd,
    roleName,
    providerName,
    mode,
    permissionMode,
  });

  // 2. 初始化 i18n（TUI 特有）
  const language = runtime.loadedSettings.settings.runtime.language;
  await initI18n(language);

  // 3. 创建 input$ Subject（用于接收用户输入）
  const input$ = new Subject<ChatInputTurn>();
  const abort$ = new Subject<void>();

  // 4. 启动会话（TUI 需要显式创建）
  const session = await runtime.sessionManager.startSession({
    cwd,
    mode: 'interactive', // TUI 始终使用交互模式
    providerId: runtime.provider.id,
  });

  // 5. 创建用户输入桥接器（用于 ask-user 工具）
  const userInputBridge = new UserInputBridge();

  // 日志总线与落盘：TUI 始终装配 FileSink（保证 /logs 有数据与 Live tail 可用），
  // debug=true 时额外提升为 debug 级别，否则保持 info 级别（按 env 覆盖）。
  ensureFileSink();
  if (runtime.loadedSettings.settings.runtime.debug) {
    enableDebugLog();
  }

  // 主 Agent 默认挂载全量工具注册表（具备直接操作与 spawn_agent 协同能力）
  // 6. 启动 Agent 循环（公共实参由 startAgentLoop 统一装配）
  const run = startAgentLoop({
    input$,
    runtime,
    cwd,
    mode: 'interactive',
    maxStepsPerTurn: runtime.loadedSettings.settings.runtime.maxStepsPerTurn,
    doomLoopThreshold: runtime.loadedSettings.settings.runtime.doomLoopThreshold,
    prompt: runtime.resolvedRuntime.prompt,
    debug: runtime.loadedSettings.settings.runtime.debug,
    userInputBridge,
    abort$,
    existingSession: session,
    // 动态 prompt：支持 /mode 实时切换，每 turn 重新解析
    resolvePrompt: () => {
      const currentMode = getAgentMode();
      const resolved = resolveChatRuntime({
        settings: runtime.loadedSettings.settings,
        roleName: runtime.resolvedRuntime.role?.name,
        cwd,
        agentMode: currentMode,
        memory: runtime.loadedSettings.memory,
      });
      return composeAgentPrompt(resolved.role?.name ?? 'orchestrator', resolved.prompt);
    },
  });

  // 6. 构建 TUI 配置
  const config: TuiConfig = {
    provider: runtime.resolvedRuntime.providerName,
    model: runtime.resolvedRuntime.model?.config.model ?? runtime.resolvedRuntime.model?.name ?? '',
    mode: runtime.agentMode,
    permissionMode: runtime.resolvedRuntime.permissionMode,
    maxSteps: runtime.loadedSettings.settings.runtime.maxStepsPerTurn,
    defaultRole: runtime.loadedSettings.settings.runtime.defaultRole ?? '',
    childAgentTimeout: runtime.loadedSettings.settings.runtime.childAgentTimeout,
    debug: runtime.loadedSettings.settings.runtime.debug,
  };

  // 7. 构建完整配置信息
  const fullConfig: TuiFullConfig = {
    providers: runtime.loadedSettings.settings.providers,
    models: runtime.loadedSettings.settings.models,
    multiAgent: runtime.loadedSettings.settings.multiAgent,
    sources: runtime.loadedSettings.sources,
    defaultProvider: runtime.loadedSettings.settings.defaultProvider,
  };

  // 8. 使用 initializeRuntime 已选择的角色 skin
  const skin = runtime.skin;

  // 返回扩展的上下文（包含 runtime 用于清理）
  return {
    events$: run.events$,
    debug$: run.debug$,
    input$,
    abort$,
    session,
    config,
    fullConfig,
    sessionManager: runtime.sessionManager,
    providerId: runtime.provider.id,
    stopMCP: runtime.mcpManager.stopMCP,
    skin,
    userInputBridge,
    permissionGate: runtime.permissionGate,
    showThinking: runtime.loadedSettings.settings.runtime.showThinking,
    spinnerIntervalMs: runtime.loadedSettings.settings.runtime.spinnerIntervalMs,
    typewriterRateMs: runtime.loadedSettings.settings.runtime.typewriterRateMs,
  } as InternalTuiRuntimeContext;
}

/**
 * 清理 TUI 运行时资源
 *
 * @param runtime - TUI 运行时上下文
 */
export async function cleanupTuiRuntime(runtime: TuiRuntimeContext): Promise<void> {
  // 完成 input$ 流
  runtime.input$.complete();

  // 清理用户输入桥接器
  const internal = runtime as InternalTuiRuntimeContext;
  if (internal.userInputBridge) {
    internal.userInputBridge.destroy();
  }

  // 停止 MCP 服务器
  if (internal.stopMCP) {
    await internal.stopMCP();
  }

  // 关闭所有会话
  if (internal.sessionManager) {
    await internal.sessionManager.closeAll();
  }
}
