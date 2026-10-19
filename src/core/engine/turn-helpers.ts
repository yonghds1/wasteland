/**
 * turn-helpers.ts - Turn 循环相关的纯辅助函数
 *
 * 主 Agent 工具白名单过滤、回退/限步消息构建、调试追踪发射器。
 * 这些函数无副作用状态，从 agent-loop 中抽取以保持核心循环精简。
 */

import { Subject } from 'rxjs';

import { t } from '@locales/index.js';

import type { AgentTool } from '@tools/core/tool-types.js';
import { ToolRegistry } from '@tools/core/tool-registry.js';
import { ACP_TOOL_PREFIX } from '@tools/agent/acp-agent-tool.js';
import { createDebugTraceEvent, type DebugTraceEvent } from '../runtime/debug-events.js';
import type { TurnState } from './turn-state.js';

/** 调试追踪事件的输入参数（不含时间戳） */
export type DebugTraceInput = Omit<DebugTraceEvent, 'timestamp'>;

/** 主 Agent 可见的工具白名单（核心决策与调研工具集） */
export const MAIN_AGENT_TOOL_NAMES = [
  'spawn_agent',
  'read-file',
  'list-directory',
  'glob',
  'grep',
  'find-symbol',
  'bash',
  'tui_update_panel',
] as const;

/**
 * 根据白名单过滤 toolRegistry，构造一个新的 ToolRegistry。
 *
 * 用于 main agent 入口（chat / resume / tui）把完整 toolRegistry 过滤为
 * minimax 可见的子集。Sub-agents 不需要此过滤（它们的 toolRegistry 已由
 * spawn-agent 根据 multiAgent.tools 自行限定）。
 *
 * 放行规则：
 * 1. 白名单 `allowedNames` 中存在的工具
 * 2. 所有 `acp_` 前缀工具（ACP 远程 agent 直接工具，用户显式配置，
 *    主 agent 与子 agent 经继承都应能调用）
 *
 * @param registry - 完整工具注册表
 * @param allowedNames - 允许的工具名数组
 * @returns 新的 ToolRegistry（白名单 + acp_ 前缀工具，去重）
 */
export function filterToolRegistry(
  registry: ToolRegistry,
  allowedNames: readonly string[]
): ToolRegistry {
  const filtered: AgentTool[] = [];
  const included = new Set<string>();

  // 1. 显式白名单工具
  for (const name of allowedNames) {
    if (included.has(name)) continue;
    const tool = registry.get(name);
    if (tool) {
      filtered.push(tool);
      included.add(name);
    }
  }

  // 2. acp_ 前缀工具默认放行（远程 agent 直接工具，用户显式配置）
  for (const name of registry.list()) {
    if (!name.startsWith(ACP_TOOL_PREFIX)) continue;
    if (included.has(name)) continue;
    const tool = registry.get(name);
    if (tool) {
      filtered.push(tool);
      included.add(name);
    }
  }

  return new ToolRegistry(filtered);
}

/**
 * 创建调试追踪发射器
 * @param subject - 用于发射调试事件的 Subject
 * @returns 发射调试事件的函数
 */
export function createTraceEmitter(subject: Subject<DebugTraceEvent>) {
  return (event: DebugTraceInput): void => {
    subject.next(createDebugTraceEvent(event));
  };
}

/**
 * 构建 Provider 未返回最终消息时的回退内容
 * @param state - 当前 turn 状态
 * @returns 用于显示的回退消息
 */
export function buildProviderFallbackMessage(state: TurnState): string {
  // 如果有累积的 chunk，拼接它们
  if (state.assistantChunks.length > 0) {
    return state.assistantChunks.join('');
  }

  // 否则返回默认消息
  return t('runtime.noFinalMessage');
}

/**
 * 构建达到最大步数限制的提示消息
 * @param maxStepsPerTurn - 单轮最大步数
 * @returns 提示消息
 */
export function buildMaxStepsMessage(_maxStepsPerTurn: number): string {
  return t('runtime.maxStepsReached');
}

/**
 * 构建命中 doom loop 时的提示消息
 *
 * 次数使用当前生效阈值（不写死 3），消息点明工具名与连续次数，
 * 供模型在下一轮看到并自纠（换思路或换参数）。
 *
 * @param toolName - 被连续重复调用的工具名
 * @param threshold - 当前生效的连续重复阈值
 * @returns 提示消息
 */
export function buildDoomLoopMessage(toolName: string, threshold: number): string {
  return t('runtime.doomLoopDetected', { tool: toolName, count: String(threshold) });
}

/**
 * 首 token 计时上下文（processStreamedNonToolEvent 透传）。
 */
export interface FirstChunkMeasure {
  /** turn 内第一次 provider 调用的起点毫秒（Date.now），null 表示不计时 */
  startMs: number | null;
  sessionId: string;
  turn: number;
  step: number;
  providerId: string;
}

/**
 * 首 token 计时消费（纯函数，可单测）。
 *
 * - 仅 turn 内第一次 provider 调用（调用方在 step === 1 时设 startMs，其余 null）；
 * - 仅首个带文本事件（assistant_chunk 含 text / assistant_message）产生一条
 *   `provider.first_chunk` trace（含 elapsedMs），之后 startMs 归 null，不再重复；
 * - tool_call / usage 等非文本事件原样透过，不消耗计时。
 *
 * @param measure - 当前计时状态
 * @param event - 流经的 provider 事件（仅读 type/text）
 * @returns trace（无则 null）与下一状态
 */
export function consumeFirstChunkTrace(
  measure: FirstChunkMeasure,
  event: { type: string; text?: string }
): { trace: DebugTraceInput | null; next: FirstChunkMeasure } {
  if (measure.startMs === null) {
    return { trace: null, next: measure };
  }
  const isText =
    (event.type === 'assistant_chunk' && !!event.text) || event.type === 'assistant_message';
  if (!isText) {
    return { trace: null, next: measure };
  }
  const elapsedMs = Date.now() - measure.startMs;
  return {
    trace: {
      sessionId: measure.sessionId,
      turn: measure.turn,
      step: measure.step,
      scope: 'provider',
      phase: 'provider.first_chunk',
      message: `first chunk after ${elapsedMs}ms`,
      data: { elapsedMs, provider: measure.providerId },
    },
    next: { ...measure, startMs: null },
  };
}
