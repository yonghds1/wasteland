/**
 * runtime-reducers/usage-reducer.ts - 用量与上下文事件归约
 *
 * 负责：usage_update / context_compacted / context_budget_warning。
 * 纯搬运自 `processRuntimeEvent`，零逻辑改动。
 *
 * 说明：原实现中这三个 case 直接 return（用量做加法、
 * compact 整体替换 context）。此处等价地写回 draft，
 * 由调用方统一组装返回，行为一致。
 */

import type { RuntimeEvent } from '@core/runtime/event-types.js';
import { t } from '@locales/index.js';
import type { EventDraft, ReducerShared } from './types.js';

type UsageEvent = Extract<
  RuntimeEvent,
  { type: 'usage_update' | 'context_compacted' | 'context_budget_warning' }
>;

export function reduceUsageEvent(
  draft: EventDraft,
  _shared: ReducerShared,
  event: UsageEvent
): void {
  const { messages } = draft;

  switch (event.type) {
    case 'usage_update': {
      // 更新 token 使用量
      draft.usage = {
        promptTokens: draft.usage.promptTokens + event.usage.promptTokens,
        completionTokens: draft.usage.completionTokens + event.usage.completionTokens,
        totalTokens: draft.usage.totalTokens + event.usage.totalTokens,
        cachedTokens: draft.usage.cachedTokens + (event.usage.cachedTokens ?? 0),
      };
      break;
    }

    case 'context_compacted': {
      // 上下文压缩完成：向消息列表推入系统提示，让用户感知 context 被压缩
      messages.push({
        id: `msg-compaction-${Date.now()}`,
        timestamp: new Date().toISOString(),
        agentId: 'system',
        type: 'system',
        content:
        event.summarized
          ? t('tui.contextCompactedSummarized', {
              removedCount: String(event.removedCount),
              tokensSaved: String(event.tokensSaved),
            })
          : t('tui.contextCompacted', {
              removedCount: String(event.removedCount),
              tokensSaved: String(event.tokensSaved),
            }),
      });
      draft.context = {
        isCompacting: false,
        lastCompaction: {
          removedCount: event.removedCount,
          tokensSaved: event.tokensSaved,
          timestamp: new Date().toISOString(),
        },
      };
      break;
    }

    case 'context_budget_warning': {
      // 上下文预算警告：prompt + history 接近 context window 上限
      messages.push({
        id: `msg-budget-${Date.now()}`,
        timestamp: new Date().toISOString(),
        agentId: 'system',
        type: 'system',
        content: t('tui.contextBudgetWarning', {
          promptTokens: String(event.promptTokens),
          historyTokens: String(event.historyTokens),
          contextWindow: String(event.contextWindow),
        }),
      });
      break;
    }
  }
}
