/**
 * useRuntime - Runtime 初始化 Hook
 *
 * 加载配置、创建 Provider、SessionManager、PermissionGate，
 * 并启动 runAgentLoop 获取事件流。
 */

import { Subject } from "rxjs";

import { loadWastelandSettings } from "../../config/load-settings.js";
import {
  resolveDefaultSessionDir,
} from "../../config/paths.js";
import { resolveChatRuntime } from "../../config/resolve-chat-runtime.js";
import { runAgentLoop } from "../../runtime/agent-loop.js";
import { createPermissionGate } from "../../runtime/permission-gate.js";
import { SessionManager } from "../../runtime/session-manager.js";
import { createDefaultProviderRegistry } from "../../providers/provider-registry.js";
import { createDefaultToolRegistry } from "../../tools/default-registry.js";
import { loadSkin } from "../../skins/index.js";
import { initI18n, t } from "../../locales/index.js";
import type { TuiRuntimeContext, TuiConfig, TuiFullConfig } from "../types.js";
import type { ChatInputTurn } from "../../runtime/event-types.js";
import type { ProviderRegistry } from "../../providers/provider-registry.js";
import type { Skin } from "../../skins/index.js";

/**
 * TUI 运行时上下文（扩展版，包含清理资源）
 *
 * 内部使用的类型，包含需要清理的资源引用。
 */
interface InternalTuiRuntimeContext extends TuiRuntimeContext {
  sessionManager: SessionManager;
  stopMCP?: () => Promise<void>;
}

/**
 * 创建 TUI 运行时上下文
 *
 * 此函数执行以下步骤：
 * 1. 加载配置（复用 loadWastelandSettings）
 * 2. 创建 SessionManager
 * 3. 创建 Provider（使用 resolveChatRuntime）
 * 4. 创建 PermissionGate
 * 5. 创建 input$ Subject
 * 6. 调用 runAgentLoop 获取 events$ 和 debug$
 *
 * @param cwd - 当前工作目录
 * @returns TUI 运行时上下文
 */
export async function createTuiRuntime(cwd: string): Promise<TuiRuntimeContext> {
  // 1. 加载配置
  const loadedSettings = await loadWastelandSettings({
    cwd,
    env: process.env,
  });

  // 2. 初始化 i18n
  const language = loadedSettings.settings.runtime.language;
  await initI18n(language);

  // 2. 解析运行时配置
  const resolvedRuntime = resolveChatRuntime({
    settings: loadedSettings.settings,
    roleName: undefined, // TUI 暂不支持 --role 参数
    providerName: undefined,
    cwd,
  });

  // 3. 创建 Provider
  const providerRegistry = createDefaultProviderRegistry();
  const provider = providerRegistry.resolve(
    resolvedRuntime.providerName,
    resolvedRuntime.providerConfig,
  );

  // 4. 创建 SessionManager
  const sessionDir = resolveDefaultSessionDir({
    cwd,
    projectConfigDir: loadedSettings.projectConfigDir,
    env: process.env,
  });
  const sessionManager = new SessionManager(sessionDir);

  // 5. 创建 PermissionGate
  const permissionGate = createPermissionGate({
    mode: resolvedRuntime.permissionMode,
  });

  // 6. 创建 ToolRegistry（包含 MCP）
  const mcpServers = loadedSettings.settings.mcpServers;
  const { toolRegistry, startMCP, stopMCP } = createDefaultToolRegistry(mcpServers);

  // 启动 MCP 服务器
  try {
    await startMCP();
  } catch (error) {
    console.warn(t("mcp.startupFailed"), error instanceof Error ? error.message : String(error));
  }

  // 7. 创建 input$ Subject（用于接收用户输入）
  const input$ = new Subject<ChatInputTurn>();

  // 8. 启动会话
  const session = await sessionManager.startSession({
    cwd,
    mode: "interactive", // TUI 始终使用交互模式
    providerId: provider.id,
  });

  // 9. 启动 Agent 循环
  const run = runAgentLoop({
    input$,
    provider,
    sessionManager,
    toolRegistry,
    permissionGate,
    cwd,
    mode: "interactive",
    maxStepsPerTurn: loadedSettings.settings.runtime.maxStepsPerTurn,
    existingSession: session,
    prompt: resolvedRuntime.prompt,
    providerRegistry,
    providerSettings: resolvedRuntime.providerConfig,
    childAgentTimeout: loadedSettings.settings.runtime.childAgentTimeout,
  });

  // 10. 构建 TUI 配置
  const config: TuiConfig = {
    provider: resolvedRuntime.providerName,
    model: resolvedRuntime.model?.name ?? "",
    permissionMode: resolvedRuntime.permissionMode,
    maxTurns: loadedSettings.settings.runtime.maxTurns,
    maxSteps: loadedSettings.settings.runtime.maxStepsPerTurn,
    defaultRole: loadedSettings.settings.runtime.defaultRole ?? "",
    childAgentTimeout: loadedSettings.settings.runtime.childAgentTimeout,
    debug: loadedSettings.settings.runtime.debug,
  };

  // 11. 构建完整配置信息
  const fullConfig: TuiFullConfig = {
    providers: loadedSettings.settings.providers,
    models: loadedSettings.settings.models,
    subAgents: loadedSettings.settings.subAgents,
    sources: loadedSettings.sources,
    defaultProvider: loadedSettings.settings.defaultProvider,
  };

  // 12. 加载皮肤配置（从 defaultRole 推导，根据 language 参数选择语言）
  let skin: Skin | null = null;
  try {
    const skinId = loadedSettings.settings.runtime.defaultRole ?? "immortan-joe";
    const language = loadedSettings.settings.runtime.language;
    skin = await loadSkin(skinId, undefined, language);
  } catch (error) {
    console.warn(t("tui.failedToLoadSkin"), error instanceof Error ? error.message : String(error));
  }

  // 返回扩展的上下文（包含 sessionManager 用于清理）
  return {
    events$: run.events$,
    debug$: run.debug$,
    input$,
    session,
    config,
    fullConfig,
    sessionManager,
    providerId: provider.id,
    stopMCP,
    skin,
  } as InternalTuiRuntimeContext;
}

/**
 * 清理 TUI 运行时资源
 *
 * @param runtime - TUI 运行时上下文
 */
export async function cleanupTuiRuntime(
  runtime: TuiRuntimeContext,
): Promise<void> {
  // 完成 input$ 流
  runtime.input$.complete();

  // 停止 MCP 服务器
  const internal = runtime as InternalTuiRuntimeContext;
  if (internal.stopMCP) {
    await internal.stopMCP();
  }

  // 关闭所有会话
  if (internal.sessionManager) {
    await internal.sessionManager.closeAll();
  }
}
