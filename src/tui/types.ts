/**
 * TUI 类型定义
 *
 * 定义 TUI 运行时上下文和配置类型
 */

import type { Observable, Subject } from "rxjs";
import type {
  RuntimeEvent,
  InputSource,
  ChatInputTurn,
} from "../runtime/event-types.js";
import type { DebugTraceEvent } from "../runtime/debug-events.js";
import type { SessionMetadata } from "../runtime/session-manager.js";

/**
 * TUI 运行时上下文
 *
 * 包含 TUI 运行所需的所有运行时资源：
 * - events$: 运行时事件流（用户输入、AI 响应、工具调用等）
 * - debug$: 调试追踪流（用于调试页面）
 * - input$: 用户输入流（用于发送消息到 runtime）
 * - session: 当前会话元数据
 * - config: TUI 配置
 */
export interface TuiRuntimeContext {
  events$: Observable<RuntimeEvent>;
  debug$: Observable<DebugTraceEvent>;
  input$: Subject<ChatInputTurn>;
  session: SessionMetadata;
  config: TuiConfig;
  /** Provider ID（用于显示） */
  providerId: string;
}

/**
 * TUI 配置
 *
 * 显示在配置页面的运行时配置
 */
export interface TuiConfig {
  provider: string;
  model: string;
  permissionMode: string;
  maxTurns: number;
  maxSteps: number;
}

// 导出 runtime 类型供 TUI 使用
export type {
  RuntimeEvent,
  DebugTraceEvent,
  SessionMetadata,
  InputSource,
  ChatInputTurn,
};
