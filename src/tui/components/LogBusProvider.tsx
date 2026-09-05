/**
 * LogBusProvider - 把 LogBus 单例暴露到 React 组件树
 *
 * 设计要点：
 * - `LogBus` 来自 `src/core/logger`，运行时由 `debug-logger.ts` 通过
 *   `enableDebugLog()` / `Logger.setBus()` 注入。
 * - TUI 不在组件层构造 bus（避免双总线漂移），而是接收外部传入或使用
 *   `Logger.getBus()` 默认单例。
 * - 当 LogBus 尚未注入时（如 TUI debug 关闭），`useLogBus()` 返回 null，
 *   下游组件应做 graceful fallback（不订阅、显示空表）。
 */

import React, { createContext, useContext } from 'react';
import { Logger } from '@core/logger/index.js';
import type { LogBus } from '@core/logger/index.js';

// ============================================================
// Context
// ============================================================

/**
 * LogBusContext：承载当前 TUI 进程内的 LogBus 实例。
 *
 * 初始值为 null，意味着组件树可独立挂载到不依赖 LogBus 的场景。
 */
const LogBusContext = createContext<LogBus | null>(null);

// ============================================================
// Provider
// ============================================================

export interface LogBusProviderProps {
  /** 显式注入的 bus；缺省时使用 `Logger.getBus()`。 */
  bus?: LogBus | null;
  children: React.ReactNode;
}

/**
 * LogBusProvider - 在 App 根处 wrap 子树，让 LogsPage / useLogStream 共享 bus。
 *
 * 不在内部订阅 bus、不创建新 bus；仅做 context 透传。
 */
export function LogBusProvider({ bus, children }: LogBusProviderProps): React.ReactElement {
  const resolved = bus !== undefined ? bus : Logger.getBus();
  return <LogBusContext.Provider value={resolved}>{children}</LogBusContext.Provider>;
}

// ============================================================
// Hook
// ============================================================

/**
 * useLogBus - 在组件内获取当前 LogBus 实例。
 *
 * 未挂载 LogBusProvider 或 bus 尚未注入时返回 null，调用方须做 fallback。
 */
export function useLogBus(): LogBus | null {
  return useContext(LogBusContext);
}