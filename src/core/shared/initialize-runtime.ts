/**
 * initialize-runtime.ts - 运行时初始化
 *
 * 提取 CLI 和 TUI 共享的运行时初始化逻辑，消除重复代码。
 * 返回 RuntimeEnvironment，包含所有初始化好的组件。
 */

import { homedir } from 'node:os';

import { loadWastelandSettings } from '../../config/load-settings.js';
import { resolveDefaultSessionDir } from '../../config/paths.js';
import { resolveChatRuntime } from '../../config/resolve-chat-runtime.js';
import type { ResolvedChatRuntime } from '../../config/resolve-chat-runtime.js';
import type { LoadedWastelandSettings } from '../../config/settings-types.js';
import {
  createDefaultProviderRegistry,
  type ProviderRegistry,
} from '../../providers/provider-registry.js';
import type { AgentProvider } from '../../providers/provider-types.js';
import { createPermissionGate, type PermissionGate } from '../runtime/permission-gate.js';
import { SessionManager } from '../runtime/session-manager.js';
import { createDefaultToolRegistry } from '../../tools/default-registry.js';
import { ToolRegistry } from '../../tools/tool-registry.js';
import { createSkillRegistry } from '../../skills/skill-discovery.js';
import { SkillExecutor } from '../../skills/skill-executor.js';

// ============================================================
// Types
// ============================================================

/**
 * 运行时环境 - 包含所有初始化好的组件
 */
export type RuntimeEnvironment = {
  /** 会话管理器 */
  sessionManager: SessionManager;
  /** 技能执行器 */
  skillExecutor: SkillExecutor;
  /** Provider 注册表 */
  providerRegistry: ProviderRegistry;
  /** 已解析的 Provider */
  provider: AgentProvider;
  /** 工具注册表 */
  toolRegistry: ToolRegistry;
  /** 权限闸门 */
  permissionGate: PermissionGate;
  /** 已解析的运行时配置 */
  resolvedRuntime: ResolvedChatRuntime;
  /** MCP 管理器（启动/停止） */
  mcpManager: {
    startMCP: () => Promise<void>;
    stopMCP: () => Promise<void>;
  };
  /** 加载的配置 */
  loadedSettings: LoadedWastelandSettings;
};

/**
 * initializeRuntime 参数
 */
export type InitializeRuntimeParams = {
  /** 当前工作目录 */
  cwd: string;
  /** 角色名称（可选） */
  roleName?: string;
  /** Provider 名称（可选） */
  providerName?: string;
  /** 环境变量（默认 process.env） */
  env?: NodeJS.ProcessEnv;
};

// ============================================================
// Main Function
// ============================================================

/**
 * 初始化运行时环境
 *
 * 统一 CLI 和 TUI 的运行时初始化逻辑，包括：
 * - 加载配置
 * - 解析运行时（provider, model, role）
 * - 创建 Provider
 * - 创建 SessionManager
 * - 创建 PermissionGate
 * - 创建 ToolRegistry（含 MCP）
 * - 创建 SkillExecutor
 *
 * @param params - 初始化参数
 * @returns RuntimeEnvironment - 包含所有初始化好的组件
 */
export async function initializeRuntime(
  params: InitializeRuntimeParams
): Promise<RuntimeEnvironment> {
  const { cwd, roleName, providerName, env = process.env } = params;

  // 1. 加载配置
  const loadedSettings = await loadWastelandSettings({ cwd, env });

  // 2. 解析运行时配置
  const resolvedRuntime = resolveChatRuntime({
    settings: loadedSettings.settings,
    roleName,
    providerName,
    cwd,
  });

  // 3. 创建 Provider 注册表并解析 Provider
  const providerRegistry = createDefaultProviderRegistry();
  const provider = providerRegistry.resolve(
    resolvedRuntime.providerName,
    resolvedRuntime.providerConfig
  );

  // 4. 创建 SessionManager
  const sessionDir = resolveDefaultSessionDir({
    cwd,
    projectConfigDir: loadedSettings.projectConfigDir,
    env,
  });
  const sessionManager = new SessionManager(sessionDir);

  // 5. 创建 PermissionGate
  const permissionGate = createPermissionGate({
    mode: resolvedRuntime.permissionMode,
  });

  // 6. 创建 ToolRegistry（含 MCP）
  const mcpServers = loadedSettings.settings.mcpServers;
  const { toolRegistry, startMCP, stopMCP } = createDefaultToolRegistry(mcpServers);

  // 7. 创建 SkillExecutor
  const skillRegistry = await createSkillRegistry({
    projectSkillsDir: loadedSettings.projectConfigDir
      ? `${loadedSettings.projectConfigDir}/skills`
      : undefined,
    userSkillsDir: `${homedir()}/.wasteland/skills`,
  });
  const skillExecutor = new SkillExecutor(skillRegistry);

  // 8. 启动 MCP（可选，失败不阻塞）
  try {
    await startMCP();
  } catch (error) {
    // MCP 启动失败不阻塞运行时初始化
    console.warn(
      `MCP startup failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return {
    sessionManager,
    skillExecutor,
    providerRegistry,
    provider,
    toolRegistry,
    permissionGate,
    resolvedRuntime,
    mcpManager: { startMCP, stopMCP },
    loadedSettings,
  };
}
