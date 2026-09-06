/**
 * pre-dispatch-hook.ts - 工具预调度 hook 接口
 *
 * 工具可在 dispatch 进入主路径前注册 hook：
 * - 接口：`PreDispatchHook = (params, requested$) => Observable<RuntimeEvent> | null`
 *   - `null` → 不接管，走通用 path
 *   - `Observable` → 接管 dispatch，替代通用 path
 * - 注册表：`preDispatchHooks: Map<string, PreDispatchHook>`（全局）
 * - 注册：`registerPreDispatchHook(toolName, hook)`
 * - 查询：`getPreDispatchHook(toolName)`
 *
 * ## 为什么独立成模块
 *
 * tool-dispatch.ts 框架不直接 import 任何特殊 tool 的实现（避免了
 * 'spawn_agent' / 'ask-user' 等字符串字面在 dispatch 逻辑里）。各 tool
 * 在初始化时通过 `registerPreDispatchHook` 自我注册。
 *
 * ## 调用方契约
 *
 * 注册方：tool 实现所在模块（如 spawn-agent 子目录）在 import 时顶层调用
 * `registerPreDispatchHook(toolName, handler)`，handler 返回 Observable 接管
 * 该 tool 的全部 dispatch 流程。返回 null 时退回通用 path。
 *
 * 消费方：tool-dispatch.ts 在 dispatchToolCall 顶部查 `getPreDispatchHook`，
 * 命中就调 handler 接管；不命中走通用 path（permission gate + executeToolCall）。
 */

import type { Observable } from 'rxjs';

import type { ToolCall } from '@tools/tool-types.js';
import type { RuntimeEvent, HistoryRecord } from '../runtime/event-types.js';
import type { PermissionGate } from './permission-gate.js';
import type { SessionManager, SessionMetadata } from '../session/session-manager.js';
import type { TurnState } from './turn-state.js';
import type { ToolRegistry } from '@tools/tool-registry.js';
import type { UserInputBridge } from './user-input-bridge.js';
import type { AgentProvider } from '@providers/provider-types.js';
import type { ProviderRegistry } from '@providers/provider-registry.js';
import type { ProviderSettings, LoadedWastelandSettings } from '@config/settings-types.js';
import type { SessionMessageRecord } from '../runtime/event-types.js';

/**
 * PreDispatchHook 参数集（dispatchToolCall 入参 + 已生成的 requested$ 事件流）
 *
 * 与 dispatchToolCall 入参保持一致 + 额外提供 requested$（tool_call_requested 事件）。
 */
export type PreDispatchHookParams = {
  session: SessionMetadata;
  sessionManager: SessionManager;
  turn: number;
  call: ToolCall;
  registry: ToolRegistry;
  permissionGate: PermissionGate;
  cwd: string;
  turnState: TurnState;
  /** 多 Agent 支持：Provider 实例 */
  provider?: AgentProvider;
  /** 多 Agent 支持：历史消息 */
  history?: HistoryRecord[];
  /** 多 Agent 支持：Provider 注册表 */
  providerRegistry?: ProviderRegistry;
  /** 多 Agent 支持：Provider 配置 */
  providerSettings?: ProviderSettings;
  /** 可选：完整 loadedSettings，用于读 multiAgent 配置 */
  loadedSettings?: LoadedWastelandSettings;
  /** 子 Agent 执行超时（毫秒） */
  childAgentTimeout?: number;
  /** 用户输入桥接器 */
  userInputBridge?: UserInputBridge;
  /** 当前 spawn 嵌套深度 */
  spawnDepth?: number;
  /** hook 接管时由 dispatch 框架生成的 tool_call_requested 事件流 */
  requested$: Observable<RuntimeEvent>;
};

/**
 * PreDispatchHook 接口
 *
 * 返回值：
 * - `Observable<RuntimeEvent>` → 接管 dispatch，调度框架不再走通用 path
 * - `null` → 不接管，让调度框架继续走通用 path（permission gate + executeToolCall）
 */
export type PreDispatchHook = (
  params: PreDispatchHookParams
) => Observable<RuntimeEvent> | null;

/**
 * 全局 PreDispatchHook 注册表（进程级 singleton）
 *
 * 工具实现模块在 import 时通过 registerPreDispatchHook 自我注册。
 */
const preDispatchHooks = new Map<string, PreDispatchHook>();

/**
 * 注册一个 PreDispatchHook
 *
 * 后注册的同名 hook 会覆盖前者（允许测试或插件动态覆盖）。
 *
 * @param toolName - 工具名（如 'spawn_agent'）
 * @param hook - hook 实现
 */
export function registerPreDispatchHook(
  toolName: string,
  hook: PreDispatchHook
): void {
  preDispatchHooks.set(toolName, hook);
}

/**
 * 查询指定 toolName 的 PreDispatchHook
 *
 * @param toolName - 工具名
 * @returns 注册的 hook 或 undefined（dispatch 继续走通用 path）
 */
export function getPreDispatchHook(toolName: string): PreDispatchHook | undefined {
  return preDispatchHooks.get(toolName);
}

/**
 * 移除已注册的 PreDispatchHook（主要用于测试清理）
 */
export function unregisterPreDispatchHook(toolName: string): boolean {
  return preDispatchHooks.delete(toolName);
}

/**
 * 列出现有注册的 toolName（测试 + debug 用）
 */
export function listRegisteredPreDispatchHooks(): string[] {
  return [...preDispatchHooks.keys()];
}

/* 重新导出工具实现模块常用类型，供 handler 共享从一处 import */
export type {
  PermissionGate,
  ToolRegistry,
  SessionMetadata,
  SessionManager,
  TurnState,
  UserInputBridge,
  AgentProvider,
  ProviderRegistry,
  ProviderSettings,
  LoadedWastelandSettings,
  SessionMessageRecord,
  ToolCall,
  RuntimeEvent,
};
