/**
 * useRuntimeEvents - 事件订阅和状态转换 Hook
 *
 * 订阅 events$ 和 debug$ 流，将 RuntimeEvent 转换为 AppState 更新。
 */

import { useEffect, useRef } from "react";
import type { Subscription } from "rxjs";
import type { RuntimeEvent, DebugTraceEvent } from "../types.js";
import type {
  AppState,
  AgentNode,
  Message,
  ToolCall,
  TraceEvent,
} from "../context/AppContext.js";

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
    name: "Main Agent",
    depth: 0,
    status: "running",
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
    isStreaming: boolean;
    streamingContent: string;
    streamingMessageId: string | null;
  },
  chunkAccumulator: { current: string },
  toolStartTimes: Map<string, number>,
): EventProcessResult {
  const agents = [...currentState.agents];
  const messages = [...currentState.messages];
  const tools = [...currentState.tools];
  let { isStreaming } = currentState;
  let { streamingContent, streamingMessageId } = currentState;

  switch (event.type) {
    case "session_started": {
      // 创建主 Agent
      const mainAgent = createMainAgent(event.sessionId);
      agents.push(mainAgent);
      isStreaming = true;
      break;
    }

    case "user_turn": {
      // 添加用户消息
      messages.push({
        id: `msg-user-${event.turn}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        agentId: event.sessionId,
        type: "user",
        content: event.content,
      });
      break;
    }

    case "assistant_chunk": {
      // 此分支现在不会被调用（在 subscribe 中直接处理）
      // 但保留以兼容其他调用路径
      chunkAccumulator.current += event.chunk;
      streamingContent = chunkAccumulator.current;
      if (!streamingMessageId) {
        streamingMessageId = `msg-streaming-${event.turn}-${Date.now()}`;
      }
      break;
    }

    case "assistant_message": {
      // 创建 assistant 消息（使用累积的 chunks 或直接 content）
      const content = chunkAccumulator.current || event.content;
      messages.push({
        id: `msg-assistant-${event.turn}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        agentId: event.sessionId,
        type: "assistant",
        content,
      });
      // 重置 chunk 累积器和流式状态
      chunkAccumulator.current = "";
      streamingContent = "";
      streamingMessageId = null;
      break;
    }

    case "tool_call_requested": {
      // 创建 pending 状态的 ToolCall
      tools.push({
        id: event.callId,
        name: event.toolName,
        status: "pending",
      });
      break;
    }

    case "tool_started": {
      // 更新为 running 状态
      const toolIndex = tools.findIndex((t) => t.id === event.callId);
      if (toolIndex >= 0) {
        tools[toolIndex] = {
          ...tools[toolIndex],
          status: "running",
        };
        toolStartTimes.set(event.callId, Date.now());
      }
      break;
    }

    case "tool_result": {
      // 更新为 success 状态
      const toolIndex = tools.findIndex((t) => t.id === event.callId);
      const startTime = toolStartTimes.get(event.callId);
      const duration = startTime ? Date.now() - startTime : undefined;

      if (toolIndex >= 0) {
        tools[toolIndex] = {
          ...tools[toolIndex],
          status: "success",
          duration,
        };
      }

      // 添加 tool 消息
      messages.push({
        id: `msg-tool-${event.callId}`,
        timestamp: new Date().toISOString(),
        agentId: event.sessionId,
        type: "tool",
        content: event.output,
      });

      toolStartTimes.delete(event.callId);
      break;
    }

    case "tool_failed": {
      // 更新为 error 状态
      const toolIndex = tools.findIndex((t) => t.id === event.callId);
      const startTime = toolStartTimes.get(event.callId);
      const duration = startTime ? Date.now() - startTime : undefined;

      if (toolIndex >= 0) {
        tools[toolIndex] = {
          ...tools[toolIndex],
          status: "error",
          duration,
        };
      }

      // 添加 tool 错误消息
      messages.push({
        id: `msg-tool-${event.callId}`,
        timestamp: new Date().toISOString(),
        agentId: event.sessionId,
        type: "tool",
        content: `Error: ${event.error}`,
      });

      toolStartTimes.delete(event.callId);
      break;
    }

    case "agent_spawned": {
      // 添加子 Agent
      agents.push({
        id: event.childId,
        name: event.name,
        depth: inferAgentDepth(event.childId) + 1,
        status: "running",
        startTime: Date.now(),
      });
      break;
    }

    case "agent_completed": {
      // 更新 Agent 状态
      const agentIndex = agents.findIndex((a) => a.id === event.childId);
      if (agentIndex >= 0) {
        agents[agentIndex] = {
          ...agents[agentIndex],
          status: event.status === "success" ? "completed"
            : event.status === "timeout" ? "timeout"
            : "failed",
          endTime: Date.now(),
        };
      }
      break;
    }

    case "session_ended": {
      isStreaming = false;
      break;
    }
  }

  return { agents, messages, tools, isStreaming, streamingContent, streamingMessageId };
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
  setState: React.Dispatch<React.SetStateAction<AppState>>,
): void {
  // Chunk 累积器（使用 ref 避免触发重新渲染）
  const chunkAccumulator = useRef<string>("");
  // 流式内容缓冲区（用于批量渲染）
  const streamingBuffer = useRef<string>("");
  // 流式消息 ID
  const streamingMsgId = useRef<string | null>(null);
  // 渲染定时器
  const renderTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Tool 开始时间（用于计算耗时）
  const toolStartTimes = useRef<Map<string, number>>(new Map());
  // 订阅引用
  const subscriptionRef = useRef<Subscription | null>(null);

  // 处理 events$ 流
  useEffect(() => {
    if (!events$) {
      return;
    }

    // 启动渲染定时器（每 16ms 刷新一次，约 60fps）
    renderTimerRef.current = setInterval(() => {
      if (streamingBuffer.current) {
        const content = streamingBuffer.current;
        const msgId = streamingMsgId.current;
        streamingBuffer.current = "";  // 清空缓冲区

        setState((prev) => ({
          ...prev,
          session: {
            ...prev.session,
            streamingContent: content,
            streamingMessageId: msgId,
          },
        }));
      }
    }, 16);

    // 订阅事件流
    subscriptionRef.current = events$.subscribe({
      next: (event) => {
        // 对于 assistant_chunk，累积到缓冲区而不是立即更新状态
        if (event.type === "assistant_chunk") {
          chunkAccumulator.current += event.chunk;
          streamingBuffer.current = chunkAccumulator.current;
          if (!streamingMsgId.current) {
            streamingMsgId.current = `msg-streaming-${event.turn}-${Date.now()}`;
          }
        } else {
          // 其他事件直接处理
          setState((prev) => {
            const result = processRuntimeEvent(
              event,
              prev.session,
              chunkAccumulator,
              toolStartTimes.current,
            );

            // 如果是 assistant_message，清空流式状态
            if (event.type === "assistant_message") {
              streamingBuffer.current = "";
              streamingMsgId.current = null;
            }

            return {
              ...prev,
              session: result,
            };
          });
        }
      },
      error: (error) => {
        console.error("Runtime event stream error:", error);
        streamingBuffer.current = "";
        streamingMsgId.current = null;
        setState((prev) => ({
          ...prev,
          session: {
            ...prev.session,
            isStreaming: false,
            streamingContent: "",
            streamingMessageId: null,
          },
        }));
      },
      complete: () => {
        streamingBuffer.current = "";
        streamingMsgId.current = null;
        setState((prev) => ({
          ...prev,
          session: {
            ...prev.session,
            isStreaming: false,
            streamingContent: "",
            streamingMessageId: null,
          },
        }));
      },
    });

    return () => {
      // 清理定时器
      if (renderTimerRef.current) {
        clearInterval(renderTimerRef.current);
        renderTimerRef.current = null;
      }
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
        console.error("Debug trace stream error:", error);
      },
    });

    return () => {
      debugSubscription.unsubscribe();
    };
  }, [debug$, setState]);
}

// 类型别名，避免循环导入
type TuiRuntimeEvents = import("rxjs").Observable<RuntimeEvent>;
type TuiRuntimeDebug = import("rxjs").Observable<DebugTraceEvent>;
