/**
 * agent-mode-state.ts - agentMode reactive state
 *
 * 提供全局可观察的 agentMode 状态，支持 /mode 命令实时切换。
 *
 * ## 设计
 *
 * 使用 RxJS BehaviorSubject 存储当前 agentMode（'single' | 'multi'）。
 * /mode 命令写入后，所有订阅者（runTurnLoop、TUI 渲染等）立即收到最新值。
 *
 * ## 数据流
 *
 * ```
 * /mode single → setAgentMode('single') → agentMode$.next('single')
 *                                              ↓
 * runTurnLoop 每 turn 读取 getAgentMode() → 按最新 mode 解析 provider/prompt
 * ```
 */

import { BehaviorSubject } from 'rxjs';
import type { AgentMode } from './resolve-chat-runtime.js';

// 默认 single 模式
const agentMode$ = new BehaviorSubject<AgentMode>('single');

/**
 * 获取当前 agentMode（同步读取 BehaviorSubject 当前值）
 *
 * 在 runTurnLoop 每 turn 开头调用，确保使用最新 mode 解析 provider/prompt。
 */
export function getAgentMode(): AgentMode {
  return agentMode$.getValue();
}

/**
 * 设置 agentMode（触发所有订阅者更新）
 *
 * /mode 命令调用此函数后，下一个 turn 会使用新 mode 解析配置。
 * 当前 turn 不受影响（concatMap 串行保证）。
 */
export function setAgentMode(mode: AgentMode): void {
  agentMode$.next(mode);
}

/**
 * 获取 agentMode Observable（供需要订阅变化的组件使用）
 *
 * TUI 渲染层可订阅此 Observable 来更新 skin。
 */
export function agentModeObservable() {
  return agentMode$.asObservable();
}
