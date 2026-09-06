/**
 * runtime-reducers/session-reducer.ts - 会话与对话流事件归约
 *
 * 负责：session_started / user_turn / assistant_chunk /
 * assistant_message / session_ended。
 * 纯搬运自 `processRuntimeEvent`，零逻辑改动。
 */

import type { RuntimeEvent } from '@core/runtime/event-types.js';
import { t } from '@locales/index.js';
import { systemCommon } from '@skins/index.js';
import type { AgentNode } from '../../context/AppContext.js';
import type { EventDraft, ReducerShared } from './types.js';

type SessionEvent = Extract<
  RuntimeEvent,
  {
    type:
      | 'session_started'
      | 'user_turn'
      | 'assistant_chunk'
      | 'assistant_message'
      | 'session_ended';
  }
>;

/**
 * 创建主 Agent 节点
 */
function createMainAgent(sessionId: string): AgentNode {
  return {
    id: sessionId,
    name: 'Main Agent',
    depth: 0,
    status: 'idle',
    startTime: Date.now(),
  };
}

export function reduceSessionEvent(
  draft: EventDraft,
  shared: ReducerShared,
  event: SessionEvent
): void {
  const { agents, messages, flow } = draft;
  const { chunkAccumulator } = shared;

  switch (event.type) {
    case 'session_started': {
      // 创建主 Agent
      const mainAgent = createMainAgent(event.sessionId);
      agents.push(mainAgent);
      // 不再设 isThinking=true:状态机语义应为"用户发了消息才开始等 agent"。
      // session_started 仅表示会话已建立,不表示在等响应。
      // (修复:进入 TUI 就显示"热沙总督在盘点筹码..."的边界 bug)
      break;
    }

    case 'user_turn': {
      // 乐观回显去重：App.sendMessage 已按 `msg-user-${turn}-` 前缀落本地消息，
      // 此处不再重复 push（isThinking 与主 Agent 状态照常推进）。
      const echoed = messages.some((m) => m.id.startsWith(`msg-user-${event.turn}-`));
      if (!echoed) {
        messages.push({
          id: `msg-user-${event.turn}-${Date.now()}`,
          timestamp: new Date().toISOString(),
          agentId: event.sessionId,
          type: 'user',
          content: event.content,
        });
      }
      // 用户发了消息:开始等 agent 第一个 chunk
      flow.isThinking = true;
      if (agents[0] && agents[0].depth === 0) {
        agents[0] = { ...agents[0], status: 'running' };
      }
      break;
    }

    case 'assistant_chunk': {
      // 收到第一个 chunk，从思考状态切换到流式状态
      if (flow.isThinking) {
        flow.isThinking = false;
        flow.isStreaming = true;
      }
      // 累积 chunk 到 streamingContent，触发 UI 更新实现打字机效果
      chunkAccumulator.current += event.chunk;
      flow.streamingContent = chunkAccumulator.current;
      if (!flow.streamingMessageId) {
        flow.streamingMessageId = `msg-streaming-${event.turn}-${Date.now()}`;
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
          content: t(systemCommon.messages.executionComplete),
        });
      }
      // 重置 chunk 累积器和流式状态
      chunkAccumulator.current = '';
      flow.streamingContent = '';
      flow.streamingMessageId = null;
      flow.isStreaming = false;
      flow.isThinking = false;
      if (agents[0] && agents[0].depth === 0) {
        agents[0] = { ...agents[0], status: 'idle' };
      }
      break;
    }

    case 'session_ended': {
      flow.isStreaming = false;
      flow.isThinking = false;
      flow.streamingContent = '';
      chunkAccumulator.current = '';
      flow.streamingMessageId = null;
      if (agents[0] && agents[0].depth === 0) {
        agents[0] = { ...agents[0], status: 'idle' };
      }
      break;
    }
  }
}
