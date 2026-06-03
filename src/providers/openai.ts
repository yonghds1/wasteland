/**
 * openai.ts - OpenAI 兼容 Provider 实现（SSE Streaming）
 *
 * 支持所有兼容 OpenAI Chat Completions API 的服务：
 * - OpenAI
 * - Ollama (本地)
 * - Qwen (阿里云通义千问)
 * - DeepSeek
 * - 智谱 GLM
 * - 京东云、小米等其他兼容服务
 *
 * ## 核心设计
 *
 * 使用 SSE (Server-Sent Events) 流式传输，逐 token 输出响应。
 * 工具调用参数通过累积 chunks 获取完整 JSON 后解析。
 *
 * ## 配置示例
 *
 * ```json
 * {
 *   "providers": {
 *     "openai": {
 *       "type": "openai-compatible",
 *       "baseUrl": "https://api.openai.com/v1",
 *       "apiKey": "sk-xxx",
 *       "model": "gpt-4"
 *     }
 *   }
 * }
 * ```
 */

import { defer, concatMap, Observable, type Observer } from 'rxjs';

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
// 重试配置
// ============================================================

/** 最大重试次数 */
const MAX_RETRIES = 3;

/** 基础重试延迟（毫秒） */
const BASE_RETRY_DELAY = 1000;

/**
 * 带重试的 fetch 请求
 *
 * @param url - 请求 URL
 * @param options - fetch 选项
 * @param retries - 剩余重试次数
 * @returns Response 对象
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  try {
    const response = await fetch(url, options);

    // 429 Rate Limit - 等待 Retry-After 或指数退避
    if (response.status === 429) {
      if (retries > 0) {
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : BASE_RETRY_DELAY * Math.pow(2, MAX_RETRIES - retries);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return fetchWithRetry(url, options, retries - 1);
      }
    }

    // 503 Service Unavailable - 指数退避重试
    if (response.status === 503 && retries > 0) {
      const delay = BASE_RETRY_DELAY * Math.pow(2, MAX_RETRIES - retries);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retries - 1);
    }

    return response;
  } catch (error) {
    // 网络错误 - 指数退避重试
    if (retries > 0) {
      const delay = BASE_RETRY_DELAY * Math.pow(2, MAX_RETRIES - retries);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retries - 1);
    }
    throw error;
  }
}

// ============================================================
// 类型定义
// ============================================================

/** OpenAI 兼容 Provider 配置 */
type OpenAIProviderConfig = {
  baseUrl: string;
  apiKey?: string;
  model: string;
};

/** OpenAI SSE 流式响应 chunk */
type OpenAIStreamChunk = {
  choices: Array<{
    delta: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: 'stop' | 'tool_calls' | null;
  }>;
  error?: {
    message?: string;
  };
};

/** 工具调用累积器 */
type ToolCallAccumulator = {
  id: string;
  name: string;
  arguments: string;
};

// ============================================================
// 辅助函数
// ============================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 读取非空字符串配置
 */
function readNonEmptyString(
  settings: ProviderSettings | undefined,
  key: 'baseUrl' | 'apiKey' | 'model'
): string | undefined {
  const value = settings?.[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * 解析 Provider 配置
 */
function resolveOpenAIConfig(settings?: ProviderSettings): OpenAIProviderConfig {
  const apiKey = readNonEmptyString(settings, 'apiKey');
  const model = readNonEmptyString(settings, 'model');
  const baseUrl = readNonEmptyString(settings, 'baseUrl');

  if (!model) throw new Error(t('providers.openai.missingModel'));
  if (!baseUrl) throw new Error(t('providers.openai.missingBaseUrl'));

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    model,
  };
}

// ============================================================
// SSE Streaming 核心
// ============================================================

/**
 * 请求 OpenAI Chat Completion API（SSE 流式）
 *
 * 返回 Observable<ProviderStreamEvent>，逐 token 发出事件。
 */
function requestOpenAIStreaming(
  config: OpenAIProviderConfig,
  messages: readonly OpenAIMessage[],
  tools?: readonly OpenAIFunctionTool[]
): Observable<ProviderStreamEvent> {
  return new Observable<ProviderStreamEvent>((subscriber) => {
    async function execute() {
      const body: Record<string, unknown> = {
        model: config.model,
        messages,
        stream: true,
      };

      if (tools && tools.length > 0) {
        body.tools = tools;
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (config.apiKey) {
        headers['Authorization'] = `Bearer ${config.apiKey}`;
      }

      const response = await fetchWithRetry(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        try {
          const errorPayload = await response.json() as { error?: { message?: string } };
          if (errorPayload?.error?.message) {
            errorMessage = errorPayload.error.message;
          }
        } catch {
          // ignore parse error
        }
        subscriber.error(new Error(`${t('providers.openai.requestFailed')}${errorMessage}`));
        return;
      }

      if (!response.body) {
        subscriber.error(new Error(t('providers.openai.invalidJson')));
        return;
      }

      const reader = response.body.getReader();
      const sse$ = parseSSEStream(reader);

      // 工具调用累积器：Map<index, ToolCallAccumulator>
      const toolCallMap = new Map<number, ToolCallAccumulator>();
      let finished = false;

      sse$.subscribe({
        next(data) {
          try {
            const chunk = JSON.parse(data) as OpenAIStreamChunk;
            const choice = chunk.choices?.[0];

            if (!choice) return;

            // 处理文本 delta
            if (choice.delta?.content) {
              subscriber.next({
                type: 'assistant_chunk',
                text: choice.delta.content,
              });
            }

            // 处理工具调用 delta（增量累积）
            if (choice.delta?.tool_calls) {
              for (const tc of choice.delta.tool_calls) {
                const idx = tc.index;
                if (!toolCallMap.has(idx)) {
                  toolCallMap.set(idx, {
                    id: tc.id ?? '',
                    name: tc.function?.name ?? '',
                    arguments: '',
                  });
                }
                const acc = toolCallMap.get(idx)!;
                if (tc.id) acc.id = tc.id;
                if (tc.function?.name) acc.name = tc.function.name;
                if (tc.function?.arguments) acc.arguments += tc.function.arguments;
              }
            }

            // 处理完成原因
            if (choice.finish_reason === 'tool_calls' && !finished) {
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

            if (choice.finish_reason === 'stop' && !finished) {
              finished = true;
            }
          } catch {
            // 忽略解析错误的 chunk
          }
        },
        error(err) {
          subscriber.error(err);
        },
        complete() {
          // 流结束：发出最终的 assistant_message
          // 如果有工具调用，不需要 assistant_message
          if (toolCallMap.size === 0) {
            // 没有工具调用时，需要从累积的 chunks 中构建完整消息
            // 但 streaming 模式下 chunks 已经发出，这里发出一个空的 final message
            // 实际的文本已通过 assistant_chunk 发出
            subscriber.next({ type: 'assistant_message', text: '' });
          }
          subscriber.complete();
        },
      });
    }

    execute().catch((err) => subscriber.error(err));

    return () => {
      // 清理由 parseSSEStream 内部处理
    };
  });
}

/**
 * 解析工具调用参数 JSON，失败时返回空对象
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

/**
 * 创建 OpenAI 兼容 Provider（SSE 流式）
 *
 * 支持所有兼容 OpenAI Chat Completions API 的服务。
 *
 * @param settings - Provider 配置
 * @returns AgentProvider 实例
 */
export function createOpenAIProvider(settings?: ProviderSettings): AgentProvider {
  const config = resolveOpenAIConfig(settings);

  return {
    id: 'openai-compatible',

    runStep({ context, state }: ProviderStepInput) {
      return defer(async () => {
        const messages = buildMessages({
          history: context.history,
          input: context.input.content,
          toolResults: state.toolResults,
          prompt: context.prompt,
        });

        const tools = context.toolRegistry ? buildOpenAITools(context.toolRegistry) : undefined;

        return requestOpenAIStreaming(config, messages, tools);
      }).pipe(concatMap((obs) => obs));
    },
  };
}
