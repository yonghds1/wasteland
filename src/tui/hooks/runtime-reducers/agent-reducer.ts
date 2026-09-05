/**
 * runtime-reducers/agent-reducer.ts - 子 Agent 事件归约
 *
 * 负责：agent_spawned / agent_completed / agent_progress /
 * agent_thinking / agent_tool_use。
 * 纯搬运自 `processRuntimeEvent`，零逻辑改动。
 */

import type { RuntimeEvent } from '@core/runtime/event-types.js';
import { getSkin } from '@skins/index.js';
import type { EventDraft, ReducerShared } from './types.js';

type AgentEvent = Extract<
  RuntimeEvent,
  {
    type:
      | 'agent_spawned'
      | 'agent_completed'
      | 'agent_progress'
      | 'agent_thinking'
      | 'agent_tool_use';
  }
>;

const SUB_AGENT_SKIN_CANDIDATES = [
  'fury-vanguard',   // 独臂弗莎 (Imperator Fuza)
  'road-nomad',      // 疯子麦克 (Madd Mack)
  'sand-scout',      // 暴走纳克斯 (Nuxx)
  'v8-mechanic',     // 巨汉瑞克 (Rikktus)
  'bullet-tester',   // 弹头麦哲 (Majer)
  'doof-analyst',    // 电音杜夫 (Dooff)
];

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

export function reduceAgentEvent(
  draft: EventDraft,
  shared: ReducerShared,
  event: AgentEvent
): void {
  const { agents, messages } = draft;
  const { multiAgent } = shared;

  switch (event.type) {
    case 'agent_spawned': {
      // 动态分配合适的废土角色皮肤
      const configuredSkinId = multiAgent[event.name]?.skin;
      const subAgentsCount = agents.filter((a) => a.depth >= 1).length;
      const fallbackSkinId = SUB_AGENT_SKIN_CANDIDATES[subAgentsCount % SUB_AGENT_SKIN_CANDIDATES.length] ?? 'sand-scout';
      const agentSkin = getSkin(configuredSkinId || fallbackSkinId);
      const roleName = agentSkin.label;

      // 防重复：同一 childId 可能因 retry / 重发事件被多次触发
      // 检查 agents 与 messages，避免 React key 冲突警告
      const isDuplicateAgent = agents.some((a) => a.id === event.childId);
      if (!isDuplicateAgent) {
        const taskSummary = event.task ? event.task.split('\n')[0]?.trim() : event.name;
        // 添加子 Agent
        agents.push({
          id: event.childId,
          name: event.name,
          roleName,
          skinId: agentSkin.id,
          task: taskSummary,
          currentAction: '就绪，开始执行任务...',
          stepCount: 0,
          depth: inferAgentDepth(event.childId) + 1,
          status: 'running',
          startTime: Date.now(),
        });
      }
      // 防重复：greeting message 已存在则跳过（避免 React key 冲突）
      const greetingId = `msg-agent-greeting-${event.childId}`;
      const hasGreeting = messages.some((m) => m.id === greetingId);
      if (!hasGreeting) {
        const greeting = agentSkin.greeting[Math.floor(Math.random() * agentSkin.greeting.length)] ?? '';
        if (greeting) {
          messages.push({
            id: greetingId,
            timestamp: new Date().toISOString(),
            agentId: event.childId,
            type: 'system',
            content: `[${roleName}] ${greeting}`,
          });
        }
      }
      break;
    }

    case 'agent_completed': {
      // 更新 Agent 状态
      const agentIndex = agents.findIndex((a) => a.id === event.childId);
      if (agentIndex >= 0) {
        const duration = (Date.now() - agents[agentIndex].startTime) / 1000;
        agents[agentIndex] = {
          ...agents[agentIndex],
          status:
            event.status === 'success'
              ? 'completed'
              : event.status === 'timeout'
                ? 'timeout'
                : 'failed',
          endTime: Date.now(),
          duration,
          currentAction: event.status === 'success' ? `完成 (耗时 ${duration.toFixed(1)}s)` : '执行终止',
        };
        // 子角色完成口号（仅成功时，随机）
        if (event.status === 'success') {
          const agentName = agents[agentIndex].name;
          const agentSkin = getSkin(multiAgent[agentName]?.skin);
          const catchphrases = agentSkin.catchphrases;
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
      // 进度消息：find-or-update 累积到同一个 message（避免同 childId 重复 key warning）
      if (event.message) {
        const progressMsgId = `agent-progress-${event.childId}`;
        const progressMsgIdx = messages.findIndex((m) => m.id === progressMsgId);
        const content = `[${event.childName}] ${event.message}`;
        if (progressMsgIdx >= 0) {
          messages[progressMsgIdx] = {
            ...messages[progressMsgIdx],
            content: messages[progressMsgIdx].content + '\n' + content,
            timestamp: new Date().toISOString(),
          };
        } else {
          messages.push({
            id: progressMsgId,
            timestamp: new Date().toISOString(),
            agentId: event.childId,
            type: 'system',
            content,
          });
        }
      }
      break;
    }

    case 'agent_thinking': {
      // 思考消息：find-or-append 累积到同一个 message（子 agent thinking 持续 emit，
      // 避免同毫秒多次 emit 导致的 React duplicate key warning）
      const thinkingId = `agent-thinking-${event.childId}`;
      const thinkingIdx = messages.findIndex((m) => m.id === thinkingId);
      if (thinkingIdx >= 0) {
        messages[thinkingIdx] = {
          ...messages[thinkingIdx],
          content: messages[thinkingIdx].content + event.content,
          timestamp: new Date().toISOString(),
        };
      } else {
        messages.push({
          id: thinkingId,
          timestamp: new Date().toISOString(),
          agentId: event.childId,
          type: 'assistant',
          content: event.content,
        });
      }
      break;
    }

    case 'agent_tool_use': {
      // 更新子 Agent 节点实时动作
      const agentIndex = agents.findIndex((a) => a.id === event.childId);
      if (agentIndex >= 0) {
        const step = (agents[agentIndex].stepCount ?? 0) + 1;
        const inputObj = event.input && typeof event.input === 'object' ? (event.input as Record<string, unknown>) : null;
        const targetStr = inputObj ? (inputObj.path || inputObj.file_path || inputObj.command || inputObj.pattern || '') : '';
        const actionDesc = targetStr
          ? `正在执行 ${event.toolName} (${targetStr})`
          : `正在执行 ${event.toolName}...`;
        agents[agentIndex] = {
          ...agents[agentIndex],
          stepCount: step,
          currentAction: `${actionDesc} (第 ${step} 步)`,
        };
      }

      // 工具调用消息：find-or-update 累积到同一个 message，紧凑保留最新工具避免破坏终端布局
      const toolMsgId = `agent-tool-${event.childId}`;
      const toolMsgIdx = messages.findIndex((m) => m.id === toolMsgId);
      const targetAgent = agents.find((a) => a.id === event.childId);
      const displayChildName = targetAgent?.roleName ?? event.childName;

      if (toolMsgIdx >= 0) {
        const prev = messages[toolMsgIdx].content;
        const raw = prev.replace(/^\[[^\]]+\]\s*⏺\s*/, '').replace(/^⏺\s*/, '');
        const toolsList = raw.split(' / ').filter(Boolean);
        // 去重：同一工具调用（requested -> started -> result）不重复追加
        if (toolsList[toolsList.length - 1] !== event.toolName) {
          toolsList.push(event.toolName);
        }
        const displayTools =
          toolsList.length > 4
            ? `... / ${toolsList.slice(-3).join(' / ')} (${toolsList.length})`
            : toolsList.join(' / ');

        messages[toolMsgIdx] = {
          ...messages[toolMsgIdx],
          content: `[${displayChildName}] ⏺ ${displayTools}`,
          timestamp: new Date().toISOString(),
        };
      } else {
        messages.push({
          id: toolMsgId,
          timestamp: new Date().toISOString(),
          agentId: event.childId,
          type: 'tool',
          content: `[${displayChildName}] ⏺ ${event.toolName}`,
        });
      }
      break;
    }
  }
}
