/**
 * runtime-reducers/types.ts - 事件归约共享类型
 *
 * 从 `useRuntimeEvents.ts` 拆出：19 个 RuntimeEvent case 按
 * session / agent / tool+permission / usage+context 四域分治，
 * 此处只放四 reducer 共用的 draft 与上下文类型。
 *
 * 约定：
 * - draft 为可变草稿（数组浅拷贝 + flow/permission/usage 快照），reducer 只管改，不组装返回；
 * - 调用方（processRuntimeEvent）负责建草稿、分发、组装 EventProcessResult；
 * - usage/context 初始为当前 state 的引用/快照：usage_update 做加法等价，
 *   context_compacted 整体替换，其余原样透传。
 */

import type { SubAgentSettings } from '@config/settings-types.js';
import type {
  AgentNode,
  Message,
  ToolCall,
  PermissionCard,
} from '../../context/AppContext.js';

/**
 * 事件归约草稿：AppState session 切片的可变工作区。
 */
export type EventDraft = {
  agents: AgentNode[];
  messages: Message[];
  tools: ToolCall[];
  flow: {
    isThinking: boolean;
    isStreaming: boolean;
    streamingContent: string;
    streamingMessageId: string | null;
  };
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
 * 跨事件共享的可变上下文（Hooks 层 ref 透传）。
 */
export type ReducerShared = {
  /** chunk 累积器（打字机效果，避免触发重新渲染） */
  chunkAccumulator: { current: string };
  /** tool 开始时间（计算耗时） */
  toolStartTimes: Map<string, number>;
  /** 子 Agent 配置（皮肤分配） */
  multiAgent: Record<string, SubAgentSettings>;
};
