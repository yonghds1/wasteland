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

import { defer, concatMap, Observable } from 'rxjs';

import type { ProviderSettings } from '@config/settings-types.js';
import { t } from '@locales/index.js';
import type { AgentProvider, ProviderStreamEvent } from './provider-types.js';
import type { ProviderStepInput } from './provider-types.js';
import {
  buildOpenAITools,
  buildMessages,
  type OpenAIFunctionTool,
  type OpenAIMessage,
} from './openai-compatible/index.js';
import { parseSSEStream } from './sse-parser.js';
import { fetchWithRetry, parseToolArguments } from './shared/retry.js';
import { resolveProviderProfile, type ProviderProfile } from './profiles.js';

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
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      thought?: string | null;
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
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
    /** DeepSeek：缓存命中 token（供应商原始字段，经 profile.usageFields 归一化读取） */
    prompt_cache_hit_tokens?: number;
    /** DeepSeek：缓存未命中 token（保留供后续使用，不向上泄漏） */
    prompt_cache_miss_tokens?: number;
  };
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
// usage 归一化
// ============================================================

/**
 * 按点号路径读取嵌套字段
 *
 * 供应商缓存字段可能是嵌套路径（"prompt_tokens_details.cached_tokens"）
 * 或扁平路径（"prompt_cache_hit_tokens"），统一用点号路径读取。
 */
function readNestedPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current === undefined || current === null) return undefined;
    if (typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, obj);
}

/**
 * 从 usage 中读取缓存 token 数
 *
 * 按 profile.usageFields 候选顺序，取第一个非空值归一化。
 * 供应商原始字段名不向上泄漏，只产出统一的 cachedTokens。
 *
 * @param usage - provider 返回的原始 usage
 * @param profile - 命中的供应商 profile
 * @returns 归一化后的缓存 token 数；所有字段缺失时为 undefined
 */
function readCachedTokens(
  usage: OpenAIStreamChunk['usage'] | undefined,
  profile: ProviderProfile
): number | undefined {
  if (!usage) return undefined;
  for (const field of profile.usageFields) {
    const value = readNestedPath(usage, field);
    if (typeof value === 'number' && value >= 0) {
      return value;
    }
  }
  return undefined;
}

// ============================================================
// SSE Streaming 核心
// ============================================================

/**
 * OpenCode Go 要求的客户端标识（见 https://opencode.ai/docs/go/#where-can-i-use-it）。
 *
 * Go 网关按会话路由与缓存：调用方须自报 UA + 每个对话稳定的 session ID。
 * 仅 opencode profile 发送，避免向任意第三方端点泄露会话标识。
 */
const OPENCODE_USER_AGENT = 'wasteland';
const OPENCODE_SESSION_HEADER = 'x-opencode-session';

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
  tools: readonly OpenAIFunctionTool[] | undefined,
  profile: ProviderProfile,
  opts?: { sessionId?: string }
): Observable<ProviderStreamEvent> {
  return new Observable<ProviderStreamEvent>((subscriber) => {
    const controller = new AbortController();
    let subscription: { unsubscribe: () => void } | undefined;
    // 本轮已发出的 chunk 原文累积（与 subscriber 收到的逐字一致）；
    // 流结束时作为定稿发出，保证 transcript 与界面显示同源。
    let fullText = '';

    /**
     * 发出文本 chunk 并同步累积定稿。
     */
    function emitChunk(text: string): void {
      fullText += text;
      subscriber.next({
        type: 'assistant_chunk',
        text,
      });
    }

    async function execute() {
      const body: Record<string, unknown> = {
        model: config.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
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

      // OpenCode Go 网关要求自报身份 + 稳定会话 ID（否则拒绝路由）。
      // 会话 ID 用 wasteland sessionId，一轮对话内稳定，天然满足“per conversation”语义。
      if (profile.id === 'opencode') {
        headers['User-Agent'] = OPENCODE_USER_AGENT;
        if (opts?.sessionId) {
          headers[OPENCODE_SESSION_HEADER] = opts.sessionId;
        }
      }

      const response = await fetchWithRetry(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
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
      let isThinking = false;
      let lastUsage: OpenAIStreamChunk['usage'] | undefined;

      subscription = sse$.subscribe({
        next(data) {
          try {
            const chunk = JSON.parse(data) as OpenAIStreamChunk;
            const choice = chunk.choices?.[0];

            // 捕获 usage（通常在最后一个 chunk）
            if (chunk.usage) {
              lastUsage = chunk.usage;
            }

            if (!choice) return;

            // 处理独立思考字段（reasoning_content / reasoning / thought）
            const reasoningDelta =
              choice.delta?.reasoning_content ??
              choice.delta?.reasoning ??
              choice.delta?.thought;

            if (reasoningDelta) {
              if (!isThinking) {
                isThinking = true;
                emitChunk(`<think>${reasoningDelta}`);
              } else {
                emitChunk(reasoningDelta);
              }
            }

            // 处理文本 delta
            if (choice.delta?.content) {
              if (isThinking) {
                isThinking = false;
                emitChunk(`</think>\n${choice.delta.content}`);
              } else {
                emitChunk(choice.delta.content);
              }
            }

            // 处理工具调用 delta（增量累积）
            if (choice.delta?.tool_calls) {
              if (isThinking) {
                isThinking = false;
                emitChunk('</think>\n');
              }
              for (const tc of choice.delta.tool_calls) {
                const idx = tc.index;
                if (!toolCallMap.has(idx)) {
                  toolCallMap.set(idx, {
                    id: tc.id ?? '',
                    name: tc.function?.name ?? '',
                    arguments: '',
                  });
                }
                const acc = toolCallMap.get(idx);
                if (acc) {
                  if (tc.id) acc.id = tc.id;
                  if (tc.function?.name) acc.name = tc.function.name;
                  if (tc.function?.arguments) acc.arguments += tc.function.arguments;
                }
              }
            }

            // 处理完成原因
            if (choice.finish_reason === 'tool_calls' && !finished) {
              finished = true;
              if (isThinking) {
                isThinking = false;
                emitChunk('</think>\n');
              }
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
              if (isThinking) {
                isThinking = false;
                emitChunk('</think>\n');
              }
            }
          } catch {
            // 忽略解析错误的 chunk
          }
        },
        error(err) {
          subscriber.error(err);
        },
        complete() {
          if (isThinking) {
            isThinking = false;
            emitChunk('</think>\n');
          }
          if (toolCallMap.size > 0 && !finished) {
            finished = true;
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

          // 流结束：发出最终的 assistant_message
          // 如果有工具调用，不需要 assistant_message
          if (toolCallMap.size === 0) {
            // 定稿即本轮 chunk 原文之和（与界面累积器同源），保证 transcript 不丢文本。
            subscriber.next({ type: 'assistant_message', text: fullText });
          }

          // 发出 usage 事件（如果有）
          if (lastUsage) {
            subscriber.next({
              type: 'usage',
              usage: {
                promptTokens: lastUsage.prompt_tokens,
                completionTokens: lastUsage.completion_tokens,
                totalTokens: lastUsage.total_tokens,
                cachedTokens: readCachedTokens(lastUsage, profile),
              },
            });
          }

          subscriber.complete();
        },
      });
    }

    execute().catch((err) => subscriber.error(err));

    return () => {
      subscription?.unsubscribe();
      controller.abort();
    };
  });
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
  // 从 baseUrl / model 推断供应商，读取其声明式差异（usageFields 等）
  const profile = resolveProviderProfile({
    baseUrl: config.baseUrl,
    model: config.model,
    usageFields: settings?.usageFields,
  });

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

        return requestOpenAIStreaming(config, messages, tools, profile, {
          sessionId: context.sessionId,
        });
      }).pipe(concatMap((obs) => obs));
    },
  };
}
