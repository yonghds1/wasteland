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
import type { AppState, AgentNode, Message, ToolCall, TraceEvent } from '../context/AppContext.js';
import { t, tArray } from '../../locales/index.js';

/**
 * 从 sessionId 推断 Agent 深度
 *
 * 深度通过统计 `-child-` 出现次数来确定。
 * 例如：主 Agent 的 sessionId 不含 `-child-`，深度为 0；
 *       子 Agent 的 sessionId 为 `xxx-child-name`，深度为 1。
 */
function inferAgentDepth(sessionId: string): number {
  return (sessionId.match(/-child-/g) || []).length;
}

/**
 * 创建主 Agent 节点
 */
function createMainAgent(sessionId: string): AgentNode {
  return {
    id: sessionId,
    name: 'Main Agent',
    depth: 0,
    status: 'running',
    startTime: Date.now(),
  };
}

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
  },
  chunkAccumulator: { current: string },
  toolStartTimes: Map<string, number>
): EventProcessResult {
  const agents = [...currentState.agents];
  const messages = [...currentState.messages];
  const tools = [...currentState.tools];
  let { isThinking, isStreaming } = currentState;
  let { streamingContent, streamingMessageId } = currentState;

  switch (event.type) {
    case 'session_started': {
      // 创建主 Agent
      const mainAgent = createMainAgent(event.sessionId);
      agents.push(mainAgent);
      // 开始思考状态（等待第一个 chunk）
      isThinking = true;
      isStreaming = false;
      break;
    }

    case 'user_turn': {
      // 添加用户消息
      messages.push({
        id: `msg-user-${event.turn}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        agentId: event.sessionId,
        type: 'user',
        content: event.content,
      });
      break;
    }

    case 'assistant_chunk': {
      // 收到第一个 chunk，从思考状态切换到流式状态
      if (isThinking) {
        isThinking = false;
        isStreaming = true;
      }
      // 累积 chunk 到 streamingContent，触发 UI 更新实现打字机效果
      chunkAccumulator.current += event.chunk;
      streamingContent = chunkAccumulator.current;
      if (!streamingMessageId) {
        streamingMessageId = `msg-streaming-${event.turn}-${Date.now()}`;
      }
      break;
    }

    case 'assistant_message': {
      // 创建 assistant 消息（使用累积的 chunks 或直接 content）
      const content = chunkAccumulator.current || event.content;
      messages.push({
        id: `msg-assistant-${event.turn}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        agentId: event.sessionId,
        type: 'assistant',
        content,
      });
      // 主角色编排完成反应（有子角色参与时显示废土 success 文案）
      if (agents.some((a) => a.id !== event.sessionId)) {
        messages.push({
          id: `msg-success-${event.turn}-${Date.now()}`,
          timestamp: new Date().toISOString(),
          agentId: event.sessionId,
          type: 'system',
          content: t('skin.ui.messages.success'),
        });
      }
      // 重置 chunk 累积器和流式状态
      chunkAccumulator.current = '';
      streamingContent = '';
      streamingMessageId = null;
      isStreaming = false;
      isThinking = false;
      break;
    }

    case 'tool_call_requested': {
      // 创建 pending 状态的 ToolCall
      tools.push({
        id: event.callId,
        name: event.toolName,
        status: 'pending',
      });
      break;
    }

    case 'tool_started': {
      // 更新为 running 状态
      const toolIndex = tools.findIndex((t) => t.id === event.callId);
      if (toolIndex >= 0) {
        tools[toolIndex] = {
          ...tools[toolIndex],
          status: 'running',
        };
        toolStartTimes.set(event.callId, Date.now());
      }
      break;
    }

    case 'tool_result': {
      // 更新为 success 状态
      const toolIndex = tools.findIndex((t) => t.id === event.callId);
      const startTime = toolStartTimes.get(event.callId);
      const duration = startTime ? Date.now() - startTime : undefined;

      if (toolIndex >= 0) {
        tools[toolIndex] = {
          ...tools[toolIndex],
          status: 'success',
          duration,
        };
      }

      // 添加 tool 消息
      messages.push({
        id: `msg-tool-${event.callId}`,
        timestamp: new Date().toISOString(),
        agentId: event.sessionId,
        type: 'tool',
        content: event.output,
      });

      toolStartTimes.delete(event.callId);
      break;
    }

    case 'tool_failed': {
      // 更新为 error 状态
      const toolIndex = tools.findIndex((t) => t.id === event.callId);
      const startTime = toolStartTimes.get(event.callId);
      const duration = startTime ? Date.now() - startTime : undefined;

      if (toolIndex >= 0) {
        tools[toolIndex] = {
          ...tools[toolIndex],
          status: 'error',
          duration,
        };
      }

      // 添加 tool 错误消息
      messages.push({
        id: `msg-tool-${event.callId}`,
        timestamp: new Date().toISOString(),
        agentId: event.sessionId,
        type: 'tool',
        content: t('tui.toolError', { error: event.error }),
      });
      // 主角色失败反应（废土 error 文案）
      messages.push({
        id: `msg-error-${event.callId}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        agentId: event.sessionId,
        type: 'system',
        content: t('skin.ui.messages.error'),
      });

      toolStartTimes.delete(event.callId);
      break;
    }

    case 'agent_spawned': {
      // 添加子 Agent
      agents.push({
        id: event.childId,
        name: event.name,
        depth: inferAgentDepth(event.childId) + 1,
        status: 'running',
        startTime: Date.now(),
      });
      // 子角色（War Boys）问候
      const greetingKey = `skin.roles.workers.${event.name}.greeting`;
      const greeting = t(greetingKey);
      if (greeting && greeting !== greetingKey) {
        messages.push({
          id: `msg-agent-greeting-${event.childId}`,
          timestamp: new Date().toISOString(),
          agentId: event.childId,
          type: 'system',
          content: `[${event.name}] ${greeting}`,
        });
      }
      break;
    }

    case 'agent_completed': {
      // 更新 Agent 状态
      const agentIndex = agents.findIndex((a) => a.id === event.childId);
      if (agentIndex >= 0) {
        agents[agentIndex] = {
          ...agents[agentIndex],
          status:
            event.status === 'success'
              ? 'completed'
              : event.status === 'timeout'
                ? 'timeout'
                : 'failed',
          endTime: Date.now(),
        };
        // 子角色（War Boys）完成口号（仅成功时，随机）
        if (event.status === 'success') {
          const agentName = agents[agentIndex].name;
          const catchphrases = tArray(`skin.roles.workers.${agentName}.catchphrases`);
          if (catchphrases.length > 0) {
            const phrase = catchphrases[Math.floor(Math.random() * catchphrases.length)];
            messages.push({
              id: `msg-agent-phrase-${event.childId}-${Date.now()}`,
              timestamp: new Date().toISOString(),
              agentId: event.childId,
              type: 'system',
              content: `[${agentName}] ${phrase}`,
            });
          }
        }
      }
      break;
    }

    case 'agent_progress': {
      // 更新 Agent 状态和消息
      const progressAgentIndex = agents.findIndex((a) => a.id === event.childId);
      if (progressAgentIndex >= 0) {
        agents[progressAgentIndex] = {
          ...agents[progressAgentIndex],
          status: 'running',
        };
      }
      // 添加进度消息
      if (event.message) {
        messages.push({
          id: `agent-progress-${event.childId}-${Date.now()}`,
          timestamp: new Date().toISOString(),
          agentId: event.childId,
          type: 'system',
          content: `[${event.childName}] ${event.message}`,
        });
      }
      break;
    }

    case 'agent_thinking': {
      // 添加思考消息
      messages.push({
        id: `agent-thinking-${event.childId}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        agentId: event.childId,
        type: 'assistant',
        content: event.content,
      });
      break;
    }

    case 'agent_tool_use': {
      // 添加工具调用消息
      messages.push({
        id: `agent-tool-${event.childId}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        agentId: event.childId,
        type: 'tool',
        content: `🔧 ${event.toolName}`,
      });
      break;
    }

    case 'session_ended': {
      isStreaming = false;
      isThinking = false;
      break;
    }
  }

  return { agents, messages, tools, isThinking, isStreaming, streamingContent, streamingMessageId };
}

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
  setState: React.Dispatch<React.SetStateAction<AppState>>
): void {
  // Chunk 累积器（使用 ref 避免触发重新渲染）
  const chunkAccumulator = useRef<string>('');
  // Tool 开始时间（用于计算耗时）
  const toolStartTimes = useRef<Map<string, number>>(new Map());
  // 订阅引用
  const subscriptionRef = useRef<Subscription | null>(null);

  // 处理 events$ 流
  useEffect(() => {
    if (!events$) {
      return;
    }

    // 订阅事件流
    // 订阅事件流，Provider 层直接发送 chunk，UI 层负责显示效果
    subscriptionRef.current = events$.subscribe({
      next: (event) => {
        setState((prev) => {
          const result = processRuntimeEvent(
            event,
            prev.session,
            chunkAccumulator,
            toolStartTimes.current
          );

          return {
            ...prev,
            session: result,
          };
        });
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
    };
  }, [events$, setState]);

  // 处理 debug$ 流
  useEffect(() => {
    if (!debug$) {
      return;
    }

    const debugSubscription = debug$.subscribe({
      next: (event) => {
        setState((prev) => ({
          ...prev,
          debug: {
            ...prev.debug,
            traces: [...prev.debug.traces, toTraceEvent(event)],
          },
        }));
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
