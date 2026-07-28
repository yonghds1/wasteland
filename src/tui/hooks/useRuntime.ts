/**
 * use-runtime-unified.ts - 统一的 TUI Runtime Hook
 *
 * 使用 initializeRuntime() 和 TuiInputAdapter，
 * 替换原来的重复初始化代码。
 */

import { Subject } from 'rxjs';

import { initializeRuntime } from '@core/shared/initialize-runtime.js';
import {
  runAgentLoop,
  MAIN_AGENT_TOOL_NAMES,
  filterToolRegistry,
} from '@core/runtime/agent-loop.js';
import { enableDebugLog } from '@core/runtime/debug-logger.js';
import { UserInputBridge } from '@core/runtime/user-input-bridge.js';
import { composeAgentPrompt } from '../../skins/index.js';
import { initI18n } from '../../locales/index.js';
import type { TuiRuntimeContext, TuiConfig, TuiFullConfig } from '../types.js';
import type { ChatInputTurn } from '@core/runtime/event-types.js';

/**
 * TUI 运行时上下文（扩展版，包含清理资源）
 */
interface InternalTuiRuntimeContext extends TuiRuntimeContext {
  stopMCP?: () => Promise<void>;
  stopA2A?: () => Promise<void>;
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
 * @returns TUI 运行时上下文
 */
export async function createTuiRuntime(
  cwd: string,
  roleName?: string,
  providerName?: string
): Promise<TuiRuntimeContext> {
  // 1. 使用 initializeRuntime() 统一初始化
  const runtime = await initializeRuntime({
    cwd,
    roleName,
    providerName,
  });

  // 2. 初始化 i18n（TUI 特有）
  const language = runtime.loadedSettings.settings.runtime.language;
  await initI18n(language);

  // 3. 创建 input$ Subject（用于接收用户输入）
  const input$ = new Subject<ChatInputTurn>();

  // 4. 启动会话（TUI 需要显式创建）
  const session = await runtime.sessionManager.startSession({
    cwd,
    mode: 'interactive', // TUI 始终使用交互模式
    providerId: runtime.provider.id,
  });

  // 5. 创建用户输入桥接器（用于 ask-user 工具）
  const userInputBridge = new UserInputBridge();

  // 启用 debug 日志（如果配置开启）。必须在 runAgentLoop 之前调用，
  // 这样 trace callback 第一次触发时就能写入文件。
  if (runtime.loadedSettings.settings.runtime.debug) {
    enableDebugLog();
  }

  // ---- 主 agent 工具集最小化 ----
  // minimax 是小模型，工具越多决策越乱。
  // 这里把完整的 toolRegistry 过滤为 MAIN_AGENT_TOOL_NAMES
  // （spawn_agent / read-file / bash），让 minimax 只能看到核心工具。
  const mainAgentToolRegistry = runtime.toolRegistry
    ? filterToolRegistry(runtime.toolRegistry, MAIN_AGENT_TOOL_NAMES)
    : undefined;

  // 6. 启动 Agent 循环
  const run = runAgentLoop({
    input$,
    provider: runtime.provider,
    sessionManager: runtime.sessionManager,
    toolRegistry: mainAgentToolRegistry,
    permissionGate: runtime.permissionGate,
    cwd,
    mode: 'interactive',
    maxStepsPerTurn: runtime.loadedSettings.settings.runtime.maxStepsPerTurn,
    existingSession: session,
    prompt: composeAgentPrompt(runtime.skin, runtime.resolvedRuntime.prompt),
    providerRegistry: runtime.providerRegistry,
    providerSettings: runtime.resolvedRuntime.providerConfig,
    skillExecutor: runtime.skillExecutor,
    childAgentTimeout: runtime.loadedSettings.settings.runtime.childAgentTimeout,
    userInputBridge,
    debug: runtime.loadedSettings.settings.runtime.debug,
    // 透传给 dispatchToolCall → spawn-agent（读 subAgents 配置 + 重试参数）
    loadedSettings: runtime.loadedSettings,
  });

  // 6. 构建 TUI 配置
  const config: TuiConfig = {
    provider: runtime.resolvedRuntime.providerName,
    model: runtime.resolvedRuntime.model?.name ?? '',
    permissionMode: runtime.resolvedRuntime.permissionMode,
    maxTurns: runtime.loadedSettings.settings.runtime.maxTurns,
    maxSteps: runtime.loadedSettings.settings.runtime.maxStepsPerTurn,
    defaultRole: runtime.loadedSettings.settings.runtime.defaultRole ?? '',
    childAgentTimeout: runtime.loadedSettings.settings.runtime.childAgentTimeout,
    debug: runtime.loadedSettings.settings.runtime.debug,
  };

  // 7. 构建完整配置信息
  const fullConfig: TuiFullConfig = {
    providers: runtime.loadedSettings.settings.providers,
    models: runtime.loadedSettings.settings.models,
    subAgents: runtime.loadedSettings.settings.subAgents,
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
    session,
    config,
    fullConfig,
    sessionManager: runtime.sessionManager,
    providerId: runtime.provider.id,
    stopMCP: runtime.mcpManager.stopMCP,
    stopA2A: runtime.a2aManager.stopA2A,
    skin,
    userInputBridge,
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

  // 停止 A2A 服务器
  if (internal.stopA2A) {
    await internal.stopA2A();
  }

  // 关闭所有会话
  if (internal.sessionManager) {
    await internal.sessionManager.closeAll();
  }
}
