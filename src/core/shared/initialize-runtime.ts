/**
 * initialize-runtime.ts - 运行时初始化
 *
 * 提取 CLI 和 TUI 共享的运行时初始化逻辑，消除重复代码。
 * 返回 RuntimeEnvironment，包含所有初始化好的组件。
 */

import { homedir } from 'node:os';

import { loadWastelandSettings } from '@config/load-settings.js';
import { getLoadedSettings } from '@config/loaded-settings.js';
import { resolveDefaultSessionDir, resolveProjectIdForCwd, resolveDefaultDataDir } from '@config/paths.js';
import { ensureDataRoot, writeProjectMeta, classifyProjectId } from '@core/logger/data-store.js';
import { resolveChatRuntime } from '@config/resolve-chat-runtime.js';
import type { AgentMode, ResolvedChatRuntime } from '@config/resolve-chat-runtime.js';
import { setAgentMode } from '@config/agent-mode-state.js';
import type { LoadedWastelandSettings } from '@config/settings-types.js';
import { t, initI18n } from '@locales/index.js';
import {
  createDefaultProviderRegistry,
  type ProviderRegistry,
} from '@providers/provider-registry.js';
import type { AgentProvider } from '@providers/provider-types.js';
import { createPermissionGate, type PermissionGate, type PermissionMode } from '@core/engine/permission-gate.js';
import { SessionManager } from '@core/session/session-manager.js';
import { createDefaultToolRegistry } from '@tools/core/default-registry.js';
import { ToolRegistry } from '@tools/core/tool-registry.js';
import { createSkillRegistry } from '@core/skills/skill-discovery.js';
import { SkillExecutor } from '@core/skills/skill-executor.js';
import { registerBuiltinCommands } from '@core/shared/command-manager.js';
import { getSkin, initSkinRegistry, type Skin } from '@skins/index.js';

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
  /**
   * 生效的 Agent 运行模式（single/multi）。
   * 来源优先级：--mode 启动参数 > settings.runtime.mode > 'single'。
   * 区别于 RuntimeMode（'single'|'interactive'，由输入来源推导）。
   */
  agentMode: AgentMode;
  /** 当前主 Agent 的 TUI 皮肤 */
  skin: Skin;
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
  /**
   * Agent 运行模式覆盖（single/multi），来自 --mode 启动参数。
   * 优先于 settings.runtime.mode；缺省时回退配置再回退 'single'。
   * 注意区别于 RuntimeMode（'single'|'interactive'，由输入来源推导）。
   */
  mode?: AgentMode;
  /**
   * 权限模式覆盖，来自 --dangerously-skip-permissions 或 --permission-mode 启动参数。
   * 优先于 settings.runtime.permissionMode。
   */
  permissionMode?: PermissionMode;
};

/**
 * 解析 --mode 启动参数为严格类型化的 agentMode
 *
 * 命令行传入的是任意字符串，这里收窄为 'single' | 'multi'，
 * 非法值在进入运行时之前抛错（与 resolvePermissionMode 一致）。
 *
 * @param value - 命令行 --mode 原始值（undefined 表示未传）
 * @returns 类型化的 agentMode，或 undefined（未传时由配置/默认值兜底）
 */
export function resolveAgentMode(value: string | undefined): AgentMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'single' || value === 'multi') {
    return value;
  }
  throw new Error(`${t('commands.chat.errors.mode')} ${value}`);
}

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
 * - 创建 ToolRegistry（含 MCP 与 ACP 直接工具）
 * - 创建 SkillExecutor
 *
 * @param params - 初始化参数
 * @returns RuntimeEnvironment - 包含所有初始化好的组件
 */
export async function initializeRuntime(
  params: InitializeRuntimeParams
): Promise<RuntimeEnvironment> {
  const { cwd, roleName, providerName, env = process.env, mode } = params;

  // 1. 加载配置（优先使用已加载的配置，避免重复加载）
  const preloadedSettings = getLoadedSettings();
  const loadedSettings = preloadedSettings
    ? preloadedSettings
    : await loadWastelandSettings({ cwd, env });

  // 1b. 初始化 i18n（幂等）：headless/直调 initializeRuntime 的调用方
  // （测试脚本、单测外的运行时）此前拿不到翻译，全走 raw key + warning。
  // TUI/CLI 入口会再次以同样语言初始化，无副作用。
  await initI18n(loadedSettings.settings.runtime.language ?? 'en');

  // agentMode：--mode 启动参数 > settings.runtime.mode > 'single'
  // 注意区别于 RuntimeMode（'single'|'interactive'，由输入来源推导）
  const agentMode: AgentMode = mode ?? loadedSettings.settings.runtime.mode ?? 'single';
  setAgentMode(agentMode);

  // 2. 解析运行时配置（mode-aware：single 取 singleAgent.model/promptTemplate、去掉多角色清单）
  const resolvedRuntime = resolveChatRuntime({
    settings: loadedSettings.settings,
    roleName,
    providerName,
    cwd,
    agentMode,
    memory: loadedSettings.memory,
  });

  // 3. 初始化皮肤注册表（带优先级加载）
  const userConfigDir = `${process.env.HOME ?? '~'}/.wasteland`;
  const projectConfigDir = loadedSettings.projectConfigDir ?? undefined;
  await initSkinRegistry(userConfigDir, projectConfigDir);

  // 4. 获取主 Agent 皮肤（single → singleAgent.skin，multi → multiAgent.main.skin）
  const singleAgentConfig = loadedSettings.settings.singleAgent;
  const multiAgent = loadedSettings.settings.multiAgent;
  const skinId = agentMode === 'single'
    ? singleAgentConfig?.skin
    : multiAgent?.main?.skin;
  const skin = getSkin(skinId);

  // 5. 创建 Provider 注册表并解析 Provider
  const providerRegistry = createDefaultProviderRegistry();
  const provider = providerRegistry.resolve(
    resolvedRuntime.providerName,
    resolvedRuntime.providerConfig
  );

  // 5b. 解析当前项目 ID（中央数据根命名空间；git root hash 优先，失败回退路径 hash）。
  // 必须在 SessionManager/FileSink 建之前完成，同步解析器读此缓存。
  // 随后初始化数据根骨架 + 项目元数据（展示标签用）。
  const projectId = await resolveProjectIdForCwd(cwd);
  const dataRoot = resolveDefaultDataDir({ cwd, env });
  await ensureDataRoot(dataRoot);
  await writeProjectMeta(dataRoot, {
    id: projectId,
    vcs: classifyProjectId(projectId),
    worktree: cwd,
  });

  // 6. 创建 SessionManager
  const sessionDir = resolveDefaultSessionDir({
    cwd,
    projectConfigDir: loadedSettings.projectConfigDir,
    env,
  });
  const sessionManager = new SessionManager(sessionDir);

  // 7. 创建 PermissionGate（支持 params.permissionMode 启动参数覆盖）
  const effectivePermissionMode = params.permissionMode ?? resolvedRuntime.permissionMode;
  resolvedRuntime.permissionMode = effectivePermissionMode;
  const permissionGate = createPermissionGate({
    mode: effectivePermissionMode,
  });

  // 8. 创建 ToolRegistry（含 MCP 与 ACP 直接工具）
  // 远程 agent 统一为 ACP：acp.agents 每个成为工具 `acp_<name>`（stdio 子进程，
  // 按工具调用起停；旧 A2A 协议栈与本机 HTTP 托管链路已整体移除）。
  const mcpServers = loadedSettings.settings.mcpServers;
  const { toolRegistry, startMCP, stopMCP } = createDefaultToolRegistry({
    mcpServers,
    acp: loadedSettings.settings.acp,
  });

  // 9. 创建 SkillExecutor
  const skillRegistry = await createSkillRegistry({
    projectSkillsDir: loadedSettings.projectConfigDir
      ? `${loadedSettings.projectConfigDir}/skills`
      : undefined,
    userSkillsDir: `${homedir()}/.wasteland/skills`,
  });
  const skillExecutor = new SkillExecutor(skillRegistry);

  // 9.5 注册内置命令（/help /clear /exit 等）
  // 修复：之前 registerBuiltinCommands 已 export 但从未被调用，
  // 导致 / 命令在 chat 模式下被错误地路由到 agent skill 系统
  // 必须使用全局 CommandManager 单例（executeCommandSync / isLocalCommandSync 走它）
  const { getCommandManager } = await import('@core/shared/command-manager.js');
  await registerBuiltinCommands(getCommandManager());

  // 10. 启动 MCP（可选，失败不阻塞）
  try {
    await startMCP();
  } catch (error) {
    // MCP 启动失败不阻塞运行时初始化
    console.warn(`MCP startup failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    sessionManager,
    skillExecutor,
    providerRegistry,
    provider,
    toolRegistry,
    permissionGate,
    resolvedRuntime,
    agentMode,
    skin,
    mcpManager: { startMCP, stopMCP },
    loadedSettings,
  };
}
