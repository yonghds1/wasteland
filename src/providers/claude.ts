/**
 * claude.ts - Claude API Provider 实现（SSE Streaming）
 *
 * 支持 Anthropic Claude API 格式：
 * - Endpoint: /v1/messages
 * - Auth: x-api-key header
 * - Version: anthropic-version: 2023-06-01
 * - Streaming: SSE (Server-Sent Events)
 *
 * ## Claude SSE 事件类型
 *
 * - `message_start`: 消息开始
 * - `content_block_start`: 内容块开始（text 或 tool_use）
 * - `content_block_delta`: 内容块增量（text_delta 或 input_json_delta）
 * - `content_block_stop`: 内容块结束
 * - `message_delta`: 消息增量（stop_reason）
 * - `message_stop`: 消息结束
 */

import { defer, concatMap, Observable } from 'rxjs';

import type { ProviderSettings } from '../config/settings-types.js';
import { t } from '../locales/index.js';
import type { AgentProvider, ProviderStreamEvent } from './provider-types.js';
import type { ProviderStepInput } from './provider-types.js';
import {
  buildOpenAITools,
  buildMessages,
  parseToolCalls,
  type OpenAIFunctionTool,
  type OpenAIMessage,
} from './openai-compatible/index.js';
import { parseSSEStream } from './sse-parser.js';

// ============================================================
// 类型定义
// ============================================================

/** Claude API 配置 */
type ClaudeProviderConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

/** Claude API 消息格式 */
type ClaudeMessage = {
  role: 'user' | 'assistant';
  content: string;
};

/** Claude API 请求 */
type ClaudeRequest = {
  model: string;
  messages: ClaudeMessage[];
  max_tokens: number;
  stream: boolean;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
  system?: string;
};

/** Claude SSE 事件 */
type ClaudeSSEEvent =
  | { type: 'message_start'; message: { id: string; role: string } }
  | {
      type: 'content_block_start';
      index: number;
      content_block: { type: string; id?: string; name?: string };
    }
  | {
      type: 'content_block_delta';
      index: number;
      delta: { type: string; text?: string; partial_json?: string };
    }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason?: string }; usage?: object }
  | { type: 'message_stop' };

/** 工具调用累积器 */
type ToolCallAccumulator = {
  id: string;
  name: string;
  arguments: string;
};

// ============================================================
// 辅助函数
// ============================================================

function readNonEmptyString(
  settings: ProviderSettings | undefined,
  key: 'baseUrl' | 'apiKey' | 'model'
): string | undefined {
  const value = settings?.[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeBaseUrl(rawBaseUrl: string | undefined): string {
  const base = (rawBaseUrl ?? 'https://api.anthropic.com').trim().replace(/\/+$/, '');
  if (base.endsWith('/v1')) return base;
  return `${base}/v1`;
}

function resolveClaudeConfig(settings?: ProviderSettings): ClaudeProviderConfig {
  const apiKey = readNonEmptyString(settings, 'apiKey');
  const model = readNonEmptyString(settings, 'model');

  if (!apiKey) throw new Error(t('providers.claude.missingApiKey'));
  if (!model) throw new Error(t('providers.claude.missingModel'));

  return {
    baseUrl: normalizeBaseUrl(readNonEmptyString(settings, 'baseUrl')),
    apiKey,
    model,
  };
}

/**
 * 将 OpenAI 格式消息转换为 Claude 格式
 */
function convertToClaudeMessages(openaiMessages: OpenAIMessage[]): {
  system?: string;
  messages: ClaudeMessage[];
} {
  let system: string | undefined;
  const messages: ClaudeMessage[] = [];
  let pendingToolResults: Array<{ toolCallId: string; content: string }> = [];

  for (const msg of openaiMessages) {
    if (msg.role === 'system') {
      system = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    } else if (msg.role === 'tool') {
      pendingToolResults.push({
        toolCallId: msg.tool_call_id,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      });
    } else {
      if (pendingToolResults.length > 0) {
        const toolResultContent = pendingToolResults.map((tr) => ({
          type: 'tool_result' as const,
          tool_use_id: tr.toolCallId,
          content: tr.content,
        }));
        messages.push({
          role: 'user',
          content: JSON.stringify(toolResultContent),
        });
        pendingToolResults = [];
      }

      messages.push({
        role: msg.role as 'user' | 'assistant',
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      });
    }
  }

  if (pendingToolResults.length > 0) {
    const toolResultContent = pendingToolResults.map((tr) => ({
      type: 'tool_result' as const,
      tool_use_id: tr.toolCallId,
      content: tr.content,
    }));
    messages.push({
      role: 'user',
      content: JSON.stringify(toolResultContent),
    });
  }

  return { system, messages };
}

/**
 * 将 OpenAI 工具格式转换为 Claude 格式
 */
function convertToClaudeTools(tools: OpenAIFunctionTool[]) {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description ?? '',
    input_schema: tool.function.parameters ?? { type: 'object', properties: {} },
  }));
}

// ============================================================
// SSE Streaming 核心
// ============================================================

/**
 * 请求 Claude Messages API（SSE 流式）
 *
 * 返回 Observable<ProviderStreamEvent>，逐 token 发出事件。
 */
function requestClaudeStreaming(
  config: ClaudeProviderConfig,
  messages: ClaudeMessage[],
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>,
  system?: string
): Observable<ProviderStreamEvent> {
  return new Observable<ProviderStreamEvent>((subscriber) => {
    async function execute() {
      const requestBody: ClaudeRequest = {
        model: config.model,
        messages,
        max_tokens: 4096,
        stream: true,
      };

      if (system) {
        requestBody.system = system;
      }

      if (tools && tools.length > 0) {
        requestBody.tools = tools;
      }

      const response = await fetch(`${config.baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        subscriber.error(
          new Error(`${t('providers.claude.requestFailed')} (${response.status}): ${errorBody}`)
        );
        return;
      }

      if (!response.body) {
        subscriber.error(new Error(t('providers.claude.unexpectedResponse')));
        return;
      }

      const reader = response.body.getReader();
      const sse$ = parseSSEStream(reader);

      // 工具调用累积器
      const toolCallMap = new Map<number, ToolCallAccumulator>();
      let finished = false;

      sse$.subscribe({
        next(data) {
          try {
            const event = JSON.parse(data) as ClaudeSSEEvent;

            switch (event.type) {
              case 'content_block_delta': {
                // 文本增量
                if (event.delta.type === 'text_delta' && event.delta.text) {
                  subscriber.next({
                    type: 'assistant_chunk',
                    text: event.delta.text,
                  });
                }

                // 工具调用参数增量
                if (event.delta.type === 'input_json_delta' && event.delta.partial_json) {
                  const acc = toolCallMap.get(event.index);
                  if (acc) {
                    acc.arguments += event.delta.partial_json;
                  }
                }
                break;
              }

              case 'content_block_start': {
                // 工具调用块开始
                if (event.content_block.type === 'tool_use') {
                  toolCallMap.set(event.index, {
                    id: event.content_block.id ?? '',
                    name: event.content_block.name ?? '',
                    arguments: '',
                  });
                }
                break;
              }

              case 'message_delta': {
                // 消息完成
                if (event.delta.stop_reason === 'tool_use' && !finished) {
                  finished = true;
                  // 发出累积的工具调用事件
                  const toolCalls = Array.from(toolCallMap.values())
                    .filter((tc) => tc.name)
                    .map((tc) => ({
                      id: tc.id,
                      toolName: tc.name,
                      input: parseToolArguments(tc.arguments),
                    }));

                  for (const call of toolCalls) {
                    subscriber.next({ type: 'tool_call', call });
                  }
                }

                if (event.delta.stop_reason === 'end_turn' && !finished) {
                  finished = true;
                }
                break;
              }

              case 'message_stop': {
                if (!finished) {
                  finished = true;
                }
                break;
              }
            }
          } catch {
            // 忽略解析错误的事件
          }
        },
        error(err) {
          subscriber.error(err);
        },
        complete() {
          // 流结束：发出最终的 assistant_message
          if (toolCallMap.size === 0) {
            subscriber.next({ type: 'assistant_message', text: '' });
          }
          subscriber.complete();
        },
      });
    }

    execute().catch((err) => subscriber.error(err));

    return () => {};
  });
}

/**
 * 解析工具调用参数 JSON
 */
function parseToolArguments(argsJson: string): Record<string, unknown> {
  if (!argsJson) return {};
  try {
    return JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ============================================================
// Provider 工厂函数
// ============================================================

export function createClaudeProvider(settings?: ProviderSettings): AgentProvider {
  const config = resolveClaudeConfig(settings);

  return {
    id: 'claude',

    runStep({ context, state }: ProviderStepInput) {
      return defer(async () => {
        const openaiMessages = buildMessages({
          history: context.history,
          input: context.input.content,
          toolResults: state.toolResults,
          prompt: context.prompt,
        });

        const { system, messages } = convertToClaudeMessages(openaiMessages);

        const openaiTools = context.toolRegistry
          ? buildOpenAITools(context.toolRegistry)
          : undefined;

        const tools = openaiTools ? convertToClaudeTools(openaiTools) : undefined;

        return requestClaudeStreaming(config, messages, tools, system);
      }).pipe(concatMap((obs) => obs));
    },
  };
}
