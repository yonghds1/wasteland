/**
 * TUI 类型定义
 *
 * 定义 TUI 运行时上下文和配置类型
 */

import type { Observable, Subject } from 'rxjs';
import type { RuntimeEvent, InputSource, ChatInputTurn } from '../core/runtime/event-types.js';
import type { DebugTraceEvent } from '../core/runtime/debug-events.js';
import type { SessionManager, SessionMetadata } from '../core/runtime/session-manager.js';
import type {
  ProviderSettings,
  ModelSettings,
  SubAgentSettings,
} from '../config/settings-types.js';
import type { RoleSkin } from '../skins/index.js';

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
  /** 完整配置信息（用于配置页面） */
  fullConfig: TuiFullConfig;
  /** 会话管理器 */
  sessionManager: SessionManager;
  /** 皮肤配置 */
  skin: RoleSkin;
  /** 是否在 UI 上展示模型的思考块（minimax/DeepSeek R1 等把 <think> 拼到 content） */
  showThinking: boolean;
  /** Spinner 帧切换间隔（毫秒），默认 80 */
  spinnerIntervalMs: number;
  /** 打字机逐字符揭示间隔（毫秒），默认 30 */
  typewriterRateMs: number;
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
  // 扩展字段
  defaultRole: string;
  childAgentTimeout: number;
  debug: boolean;
}

/**
 * 配置源信息
 */
export interface TuiConfigSources {
  user?: string;
  project?: string;
  userAuth?: string;
  projectAuth?: string;
}

/**
 * 完整配置信息（用于配置页面显示）
 */
export interface TuiFullConfig {
  providers: Record<string, ProviderSettings>;
  models: Record<string, ModelSettings>;
  subAgents: Record<string, SubAgentSettings>;
  sources: TuiConfigSources;
  defaultProvider: string;
}

// 导出 runtime 类型供 TUI 使用
export type { RuntimeEvent, DebugTraceEvent, SessionMetadata, InputSource, ChatInputTurn };
