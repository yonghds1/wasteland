/**
 * runtime-reducers/tool-reducer.ts - 工具与权限交互事件归约
 *
 * 负责：tool_call_requested / tool_started / tool_result /
 * tool_failed / user_input_requested / user_input_received。
 * 纯搬运自 `processRuntimeEvent`，零逻辑改动。
 */

import type { RuntimeEvent } from '@core/runtime/event-types.js';
import { t } from '@locales/index.js';
import { systemCommon } from '@skins/index.js';
import type { PermissionCard } from '../../context/AppContext.js';
import type { EventDraft, ReducerShared } from './types.js';

type ToolEvent = Extract<
  RuntimeEvent,
  {
    type:
      | 'tool_call_requested'
      | 'tool_started'
      | 'tool_result'
      | 'tool_failed'
      | 'user_input_requested'
      | 'user_input_received';
  }
>;

export function reduceToolEvent(
  draft: EventDraft,
  shared: ReducerShared,
  event: ToolEvent
): void {
  const { messages, tools, flow, permission } = draft;
  const { toolStartTimes } = shared;

  switch (event.type) {
    case 'tool_call_requested': {
      // 创建 pending 状态的 ToolCall
      tools.push({
        id: event.callId,
        name: event.toolName,
        status: 'pending',
      });
      if (event.toolName === 'spawn_agent' && event.input && typeof event.input === 'object') {
        const childName = (event.input as Record<string, unknown>).name;
        if (childName) {
          messages.push({
            id: `msg-dispatch-${event.callId}`,
            timestamp: new Date().toISOString(),
            agentId: event.sessionId,
            type: 'system',
            content: `⏺ 正在调度子 Agent [${childName}] 执行专属分析任务...`,
          });
        }
      }
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
        content: t(systemCommon.messages.executionFailed),
      });

      toolStartTimes.delete(event.callId);
      break;
    }

    case 'user_input_requested': {
      flow.isThinking = false;
      flow.isStreaming = false;
      messages.push({
        id: `ask-${event.callId}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        agentId: event.sessionId,
        type: 'system',
        content: `? ${event.question}`,
      });
      // 统一 pending：解析 toolName/command 供卡片展示
      const q = event.question;
      const m = q.match(/是否允许执行\s*([^\s(?]+)(?:\s*\(([^)]+)\))?/);
      permission.pending = {
        callId: event.callId,
        toolName: m?.[1] ?? 'ask-user',
        command: m?.[2],
        question: q,
        status: 'pending',
        timestamp: new Date().toISOString(),
      };
      break;
    }

    case 'user_input_received': {
      flow.isThinking = true;
      messages.push({
        id: `answer-${event.callId}-${Date.now()}`,
        timestamp: new Date().toISOString(),
        agentId: event.sessionId,
        type: 'user',
        content: event.answer,
      });
      if (permission.pending && permission.pending.callId === event.callId) {
        const ans = event.answer.trim().toLowerCase();
        const decision: PermissionCard['decision'] = ans === 'yes' || ans === 'y' || ans === '是' ? 'allow' : 'deny';
        permission.history = [
          ...permission.history,
          { ...permission.pending, status: 'resolved', decision, timestamp: new Date().toISOString() },
        ];
        permission.pending = null;
      }
      break;
    }
  }
}
