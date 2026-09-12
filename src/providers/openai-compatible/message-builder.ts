/**
 * message-builder.ts - 消息构建器
 *
 * 构建 OpenAI API 所需的消息格式，包括：
 * - 历史对话消息
 * - 工具调用消息
 * - 工具结果消息
 *
 * ## 核心功能
 *
 * 1. buildMessages: 构建完整的消息数组（含工具历史）
 * 2. buildToolResultMessages: 批量转换工具结果
 */

import type { HistoryRecord } from '@core/runtime/event-types.js';
import type { TurnToolResult } from '@core/engine/turn-state.js';
import { t } from '@locales/index.js';
import type {
  OpenAIAssistantMessage,
  OpenAIMessage,
  OpenAIToolMessage,
} from './types.js';

// ============================================================
// 消息构建
// ============================================================

/**
 * R-3 回传用：把上游"实际发过的 reasoning 字段"附加到 assistant 消息上。
 *
 * `extraFields` 的 key 是源字段名（reasoning_content / reasoning / thought…），
 * 值原样带回。联合类型 OpenAIMessage 不声明动态 key，故这里只对**额外字段**做断言；
 * assistant 的 role/content/tool_calls 全部交给类型系统静态检查
 * ——避免整对象 `as OpenAIMessage` 把 shape 错误一起盖掉。
 */
function withAssistantExtras(
  base: OpenAIAssistantMessage,
  extraFields: Record<string, string>
): OpenAIMessage {
  return { ...base, ...(extraFields as Partial<OpenAIAssistantMessage>) };
}

/**
 * R-3：把额外 reasoning 字段并入已存在的 assistant 消息（同 step 合并 tool_calls 时用）。
 *
 * 就地写入是刻意的：messages 数组持有该对象引用，合并多条 tool_call 记录时必须
 * 累加到同一条 assistant 消息上；调用方已按字段名判重，保证每个 key 只挂一次。
 */
function attachAssistantExtras(
  target: OpenAIAssistantMessage,
  extraFields: Record<string, string>
): void {
  Object.assign(target, extraFields as Partial<OpenAIAssistantMessage>);
}

/**
 * 构建 OpenAI API 消息数组
 *
 * 将会话历史、当前输入和工具结果转换为 OpenAI 消息格式。
 *
 * ## 消息顺序
 *
 * 1. System 消息（如果提供了 prompt）
 * 2. 历史对话消息（user/assistant）
 * 3. 当前用户输入
 * 4. 工具结果消息（如果有）
 *
 * ## 工具结果处理
 *
 * 当 state.toolResults 非空时，需要：
 * 1. 添加 assistant 消息（包含 tool_calls）
 * 2. 添加 tool 消息（包含执行结果）
 *
 * @param params.history - 会话历史记录
 * @param params.input - 当前用户输入
 * @param params.toolResults - 当前 turn 的工具执行结果
 * @param params.prompt - 可选的 system prompt
 * @returns OpenAI 消息数组
 *
 * @example
 * const messages = buildMessages({
 *   history: sessionHistory,
 *   input: "帮我编辑 config.ts",
 *   toolResults: [{ callId: 'call_abc', toolName: 'read-file', status: 'success', output: '...' }],
 *   prompt: "你是一个专业的程序员。"
 * });
 */
export function buildMessages(params: {
  history: readonly HistoryRecord[];
  input: string;
  toolResults: readonly TurnToolResult[];
  prompt?: string;
}): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [];

  // 0. 添加 system 消息（如果提供了 prompt）
  if (params.prompt) {
    messages.push({
      role: 'system',
      content: params.prompt,
    });
  }

  // 1. 添加历史消息（包含 tool_call 和 tool_result）
  for (const record of params.history) {
    if (record.type === 'message') {
      // 对话消息。R-3：assistant 带 reasoning 时按**源字段名、原值**放回；
      // 无 reasoning（普通消息 / 旧记录 / user 角色）→ 逐字节与改前一致。
      // content 为空时同样不回传：那是上游从未发过的字段（R-1 只累积非空增量），
      // 凭空造 `reasoning_content: ""` 反而可能被 strict 网关判为非法。
      if (record.role === 'assistant' && record.reasoning?.content) {
        messages.push(
          withAssistantExtras(
            { role: 'assistant', content: record.content },
            { [record.reasoning.field]: record.reasoning.content }
          )
        );
      } else {
        messages.push({
          role: record.role,
          content: record.content,
        });
      }
    } else if (record.type === 'summary') {
      // 压缩摘要：作为 system 元上下文，让模型了解被压缩掉的早期对话
      messages.push({
        role: 'system',
        content: `[Summary of earlier conversation]\n${record.content}`,
      });
    } else if (record.type === 'tool_call') {
      // 工具调用记录 → assistant message with tool_calls
      // 查找上一条 assistant 消息，追加 tool_calls
      // R-3（范围扩展）：发起 tool_calls 的 assistant 消息也带过 reasoning，
      // strict 网关要求原字段回传。一条 assistant 消息可能对应多个 tool_call 记录，
      // 取第一个带 reasoning 的挂到该 assistant 消息上（同批次 reasoning 同一份）。
      const lastMsg = messages[messages.length - 1];
      // 源字段名与值一起取出，避免非空断言（lint 铁律）。
      // 与 message 分支同规则：content 为空时不造字段（上游从未发过空 reasoning）。
      const reasoningField = record.reasoning?.content ? record.reasoning.field : undefined;
      const reasoning =
        reasoningField !== undefined
          ? { [reasoningField]: record.reasoning?.content ?? '' }
          : undefined;
      if (lastMsg?.role === 'assistant' && 'tool_calls' in lastMsg && lastMsg.tool_calls) {
        lastMsg.tool_calls.push({
          id: record.callId,
          type: 'function',
          function: {
            name: record.toolName,
            arguments: JSON.stringify(record.input ?? {}),
          },
        });
        // 同一步多个 tool_call 合并进一条 assistant 消息：按字段名判重，只挂一次。
        if (reasoning && reasoningField && !(reasoningField in lastMsg)) {
          attachAssistantExtras(lastMsg, reasoning);
        }
      } else {
        // 新建 assistant message with tool_calls
        const base: OpenAIAssistantMessage = {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: record.callId,
              type: 'function',
              function: {
                name: record.toolName,
                arguments: JSON.stringify(record.input ?? {}),
              },
            },
          ],
        };
        messages.push(withAssistantExtras(base, reasoning ?? {}));
      }
    } else if (record.type === 'tool_result') {
      // 工具结果记录 → tool message
      messages.push({
        role: 'tool',
        tool_call_id: record.callId,
        content:
          record.status === 'success'
            ? (record.output ?? t('providers.messageBuilder.noOutput'))
            : (record.error ?? t('providers.messageBuilder.toolFailed')),
      });
    }
  }

  // 2. 添加当前用户输入
  messages.push({
    role: 'user',
    content: params.input,
  });

  // 3. 如果有工具结果，添加工具历史
  if (params.toolResults.length > 0) {
    // 3.1 添加 assistant 消息（包含 tool_calls）
    // 从 toolResults 构建 tool_calls，包含原始 input
    const toolCalls = params.toolResults.map((result) => ({
      id: result.callId,
      type: 'function' as const,
      function: {
        name: result.toolName,
        arguments: JSON.stringify(result.input ?? {}),
      },
    }));

    // R-3（intra-turn 路径）：同 step 的多个 toolResults 共享同一 assistant 消息的
    // reasoning，按字段名去重后挂到重建的 assistant tool_calls 消息上。
    const stepReasoning = new Map<string, string>();
    for (const result of params.toolResults) {
      if (result.reasoning?.content && !stepReasoning.has(result.reasoning.field)) {
        stepReasoning.set(result.reasoning.field, result.reasoning.content);
      }
    }

    const base: OpenAIAssistantMessage = {
      role: 'assistant',
      content: null,
      tool_calls: toolCalls,
    };
    // Object.fromEntries 保留插入顺序：第一个命中字段先写，与原实现逐字节一致。
    messages.push(withAssistantExtras(base, Object.fromEntries(stepReasoning)));

    // 3.2 添加 tool 消息（批量返回）
    for (const result of params.toolResults) {
      messages.push({
        role: 'tool',
        tool_call_id: result.callId,
        content:
          result.status === 'success'
            ? (result.output ?? t('providers.messageBuilder.noOutput'))
            : (result.error ?? t('providers.messageBuilder.toolFailed')),
      });
    }
  }

  return messages;
}

/**
 * 构建工具结果消息（批量）
 *
 * 将多个工具执行结果转换为 OpenAI tool 消息。
 *
 * @param results - 工具执行结果数组
 * @returns OpenAI tool 消息数组
 */
export function buildToolResultMessages(results: readonly TurnToolResult[]): OpenAIToolMessage[] {
  return results.map((result) => ({
    role: 'tool' as const,
    tool_call_id: result.callId,
    content:
      result.status === 'success'
        ? (result.output ?? t('providers.messageBuilder.noOutput'))
        : (result.error ?? t('providers.messageBuilder.toolFailed')),
  }));
}

/**
 * 检查是否需要继续工具循环
 *
 * 当最后一个消息是 tool 消息时，需要继续请求模型。
 *
 * @param messages - 消息数组
 * @returns true 表示需要继续
 */
export function needsToolLoop(messages: OpenAIMessage[]): boolean {
  const lastMessage = messages[messages.length - 1];
  return lastMessage?.role === 'tool';
}
