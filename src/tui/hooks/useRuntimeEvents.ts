/**
 * useRuntimeEvents - 事件订阅和状态转换 Hook
 *
 * 订阅 events$ 和 debug$ 流，将 RuntimeEvent 转换为 AppState 更新。
 *
 * ## 流式状态管理
 *
 * 直接在 processRuntimeEvent 中管理流式显示状态：
 * - isThinking: 等待第一个 chunk（session_started 后到第一个 chunk 之间）
 * - isStreaming: 正在接收流式数据（收到 chunk 后）
 * - streamingContent: 累积的流式内容
 */

import { useEffect, useRef } from 'react';
import type { Subscription } from 'rxjs';
import type { RuntimeEvent, DebugTraceEvent } from '../types.js';
import type { AppState, AgentNode, Message, ToolCall, TraceEvent, PermissionCard } from '../context/AppContext.js';
import type { SubAgentSettings } from '@config/settings-types.js';
import { t } from '@locales/index.js';
import type { EventDraft, ReducerShared } from './runtime-reducers/types.js';
import { reduceSessionEvent } from './runtime-reducers/session-reducer.js';
import { reduceAgentEvent } from './runtime-reducers/agent-reducer.js';
import { reduceToolEvent } from './runtime-reducers/tool-reducer.js';
import { reduceUsageEvent } from './runtime-reducers/usage-reducer.js';

/**
 * 事件处理结果
 */
type EventProcessResult = {
  agents: AgentNode[];
  messages: Message[];
  tools: ToolCall[];
  isThinking: boolean;
  isStreaming: boolean;
  streamingContent: string;
  streamingMessageId: string | null;
  permission: { pending: PermissionCard | null; queue: PermissionCard[]; history: PermissionCard[] };
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens: number;
  };
  context: {
    isCompacting: boolean;
    lastCompaction?: {
      removedCount: number;
      tokensSaved: number;
      timestamp: string;
    };
  };
};

/**
 * 处理单个 RuntimeEvent，返回状态更新
 */
function processRuntimeEvent(
  event: RuntimeEvent,
  currentState: {
    agents: AgentNode[];
    messages: Message[];
    tools: ToolCall[];
    isThinking: boolean;
    isStreaming: boolean;
    streamingContent: string;
    streamingMessageId: string | null;
    permission: { pending: PermissionCard | null; queue: PermissionCard[]; history: PermissionCard[] };
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      cachedTokens: number;
    };
    context: {
      isCompacting: boolean;
      lastCompaction?: {
        removedCount: number;
        tokensSaved: number;
        timestamp: string;
      };
    };
  },
  chunkAccumulator: { current: string },
  toolStartTimes: Map<string, number>,
  multiAgent: Record<string, SubAgentSettings>
): EventProcessResult {
  // 建可变草稿：数组浅拷贝 + flow/permission/usage 快照，context 原样透传。
  // 各域 reducer 只改草稿，由此统一组装返回（与原逐 case 返回等价）。
  const draft: EventDraft = {
    agents: [...currentState.agents],
    messages: [...currentState.messages],
    tools: [...currentState.tools],
    flow: {
      isThinking: currentState.isThinking,
      isStreaming: currentState.isStreaming,
      streamingContent: currentState.streamingContent,
      streamingMessageId: currentState.streamingMessageId,
    },
    permission: { pending: currentState.permission.pending, queue: [...currentState.permission.queue], history: [...currentState.permission.history] },
    usage: { ...currentState.usage },
    context: currentState.context,
  };
  const shared: ReducerShared = { chunkAccumulator, toolStartTimes, multiAgent };

  switch (event.type) {
    case 'session_started':
    case 'user_turn':
    case 'assistant_chunk':
    case 'assistant_message':
    case 'session_ended':
      reduceSessionEvent(draft, shared, event);
      break;
    case 'agent_spawned':
    case 'agent_completed':
    case 'agent_progress':
    case 'agent_thinking':
    case 'agent_tool_use':
      reduceAgentEvent(draft, shared, event);
      break;
    case 'tool_call_requested':
    case 'tool_started':
    case 'tool_result':
    case 'tool_failed':
    case 'user_input_requested':
    case 'user_input_received':
      reduceToolEvent(draft, shared, event);
      break;
    case 'usage_update':
    case 'context_compacted':
    case 'context_budget_warning':
      reduceUsageEvent(draft, shared, event);
      break;
  }

  return {
    agents: draft.agents,
    messages: draft.messages,
    tools: draft.tools,
    isThinking: draft.flow.isThinking,
    isStreaming: draft.flow.isStreaming,
    streamingContent: draft.flow.streamingContent,
    streamingMessageId: draft.flow.streamingMessageId,
    permission: draft.permission,
    usage: draft.usage,
    context: draft.context,
  };
}

/**
 * debug traces 环形缓冲上限（与 agent-loop 侧 ReplaySubject(200) 对齐）。
 */
const MAX_DEBUG_TRACES = 200;

/**
 * 将 DebugTraceEvent 转换为 TraceEvent
 */
function toTraceEvent(event: DebugTraceEvent): TraceEvent {
  return {
    timestamp: event.timestamp,
    sessionId: event.sessionId,
    turn: event.turn,
    step: event.step,
    scope: event.scope,
    phase: event.phase,
    message: event.message,
    data: event.data,
  };
}

/**
 * useRuntimeEvents Hook
 *
 * 订阅 events$ 和 debug$ 流，更新应用状态。
 *
 * @param events$ - 运行时事件流
 * @param debug$ - 调试追踪流
 * @param setState - 应用状态更新函数
 */
export function useRuntimeEvents(
  events$: TuiRuntimeEvents | null,
  debug$: TuiRuntimeDebug | null,
  setState: React.Dispatch<React.SetStateAction<AppState>>,
  multiAgent: Record<string, SubAgentSettings> = {}
): void {
  // Chunk 累积器（使用 ref 避免触发重新渲染）
  const chunkAccumulator = useRef<string>('');
  // Tool 开始时间（用于计算耗时）
  const toolStartTimes = useRef<Map<string, number>>(new Map());
  // 订阅引用
  const subscriptionRef = useRef<Subscription | null>(null);

  // 事件缓冲队列
  const bufferRef = useRef<RuntimeEvent[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 处理 events$ 流
  useEffect(() => {
    if (!events$) {
      return;
    }

    // 订阅事件流，Provider 层直接发送 chunk，UI 层负责显示效果
    // 引入 50ms 窗口缓冲，避免高频 token 触发过多 setState 导致 CPU 飙升
    subscriptionRef.current = events$.subscribe({
      next: (event) => {
        bufferRef.current.push(event);
        
        if (!timerRef.current) {
          timerRef.current = setTimeout(() => {
            const batch = bufferRef.current;
            bufferRef.current = [];
            timerRef.current = null;
            
            setState((prev) => {
              let nextSession = prev.session;
              for (const ev of batch) {
                nextSession = processRuntimeEvent(
                  ev,
                  nextSession,
                  chunkAccumulator,
                  toolStartTimes.current,
                  multiAgent
                );
              }
              const hadPending = !!prev.session.permission?.pending;
              const hasPending = !!nextSession.permission?.pending;
              const shouldForceInput = !hadPending && hasPending;
              // 队头变化（新问询上位 / 答完推进到下一个）→ 选项索引归零，
              // 避免上一张的光标位置被带到下一张造成误选。
              const prevHead = prev.session.permission?.pending?.callId ?? null;
              const nextHead = nextSession.permission?.pending?.callId ?? null;

              return {
                ...prev,
                session: nextSession,
                // 同步顶层 permission 保持兼容
                permission: nextSession.permission ?? prev.permission,
                ...(shouldForceInput ? { inputMode: true, focusArea: 'inputBar' as const } : {}),
                ...(prevHead !== nextHead ? { permissionSelection: 0 } : {}),
              };
            });
          }, 50);
        }
      },
      error: (error) => {
        console.error(t('tui.runtimeEventStreamError'), error);
        setState((prev) => ({
          ...prev,
          session: {
            ...prev.session,
            isThinking: false,
            isStreaming: false,
            streamingContent: '',
            streamingMessageId: null,
          },
        }));
      },
      complete: () => {
        setState((prev) => ({
          ...prev,
          session: {
            ...prev.session,
            isThinking: false,
            isStreaming: false,
            streamingContent: '',
            streamingMessageId: null,
          },
        }));
      },
    });

    return () => {
      // 清理订阅
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
        subscriptionRef.current = null;
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [events$, setState, multiAgent]);

  // 处理 debug$ 流
  // 环形缓冲：只保留最近 MAX_DEBUG_TRACES 条，避免长会话无界增长
  // （与 agent-loop 侧 ReplaySubject(200) 对齐；旧 trace 本就只用于近期排查）
  useEffect(() => {
    if (!debug$) {
      return;
    }

    const debugSubscription = debug$.subscribe({
      next: (event) => {
        setState((prev) => {
          const next = [...prev.debug.traces, toTraceEvent(event)];
          return {
            ...prev,
            debug: {
              ...prev.debug,
              traces:
                next.length > MAX_DEBUG_TRACES
                  ? next.slice(next.length - MAX_DEBUG_TRACES)
                  : next,
            },
          };
        });
      },
      error: (error) => {
        console.error(t('tui.debugTraceStreamError'), error);
      },
    });

    return () => {
      debugSubscription.unsubscribe();
    };
  }, [debug$, setState]);
}

// 类型别名，避免循环导入
type TuiRuntimeEvents = import('rxjs').Observable<RuntimeEvent>;
type TuiRuntimeDebug = import('rxjs').Observable<DebugTraceEvent>;
