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
        args: event.input ? JSON.stringify(event.input) : undefined,
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
      // 统一 pending：解析 toolName/command 供卡片展示；
      // toolName/input 优先取事件结构化字段（dispatch 侧填写），回退 question 正则。
      const q = event.question;
      const m = q.match(/是否允许执行\s*([^\s(?]+)(?:\s*\(([^)]+)\))?/);
      const card: PermissionCard = {
        callId: event.callId,
        toolName: event.toolName ?? m?.[1] ?? 'ask-user',
        command: m?.[2],
        input: event.input ? { ...event.input } : undefined,
        question: q,
        status: 'pending',
        timestamp: new Date().toISOString(),
      };
      // FIFO：无队头直接上位；否则排队等待，回答时按 callId 对号。
      if (!permission.pending) {
        permission.pending = card;
      } else {
        permission.queue.push(card);
      }
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
      const ans = event.answer.trim().toLowerCase();
      const decision: PermissionCard['decision'] =
        ans === 'always'
          ? 'allow_always'
          : ans === 'yes' || ans === 'y' || ans === '是'
            ? 'allow'
            : 'deny';
      const resolvedAt = new Date().toISOString();

      if (permission.pending && permission.pending.callId === event.callId) {
        permission.history = [
          ...permission.history,
          { ...permission.pending, status: 'resolved', decision, timestamp: resolvedAt },
        ];
        // 队头出队：后续等待上位（bridge 侧同 tick 已把答案路由给正确的等待者）。
        permission.pending = permission.queue.shift() ?? null;
      } else {
        // 被回答的不是队头：卡片 FIFO 与 bridge 等待者 FIFO 若发生背离，就会出现这种情况。
        // 仍必须把这张卡从队列里摘掉——否则它会永久滞留，后续每次回答都对不上队头，
        // 卡片区长期显示旧内容而真正的等待者无人应答（09-14-subagent-permission-hang）。
        const qi = permission.queue.findIndex((c) => c.callId === event.callId);
        if (qi >= 0) {
          const [resolved] = permission.queue.splice(qi, 1);
          if (resolved) {
            permission.history = [
              ...permission.history,
              { ...resolved, status: 'resolved', decision, timestamp: resolvedAt },
            ];
          }
        }
      }
      break;
    }
  }
}
