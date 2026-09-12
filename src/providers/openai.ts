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
import {
  detectReasoningField,
  hasReasoningFields,
  isReasoningRoundTripError,
  stripReasoningFields,
} from './shared/reasoning-roundtrip.js';
import {
  type OpenAIStreamChunk,
  type ToolCallAccumulator,
} from './openai-compatible/stream-types.js';
import { readCachedTokens } from './openai-compatible/usage-normalization.js';
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
// OpenCode Go 客户端标识 + R-4 自愈回调
// ============================================================

/**
 * OpenCode Go 要求的客户端标识（见 https://opencode.ai/docs/go/#where-can-i-use-it）。
 *
 * Go 网关按会话路由与缓存：调用方须自报 UA + 每个对话稳定的 session ID。
 * 仅 opencode profile 发送，避免向任意第三方端点泄露会话标识。
 */
const OPENCODE_USER_AGENT = 'wasteland';
const OPENCODE_SESSION_HEADER = 'x-opencode-session';

/**
 * R-4 自愈回调：进程内（per provider 实例）记忆"该端点拒收回传，停回传"。
 *
 * 状态放在 `createOpenAIProvider` 闭包里，此处只传读写回调，
 * 避免 `requestOpenAIStreaming` 顶层持有可变状态（利于测试与多实例隔离）。
 */
type ReasoningRoundTripHooks = {
  /** 该 provider 实例是否已确认端点拒收 reasoning 回传 */
  isSuppressed(): boolean;
  /** 标记端点拒收，后续请求不再回传 reasoning */
  setSuppressed(): void;
};

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
  opts?: { sessionId?: string; roundTrip?: ReasoningRoundTripHooks }
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

    // R-4：一次事件流最多自愈一次，防递归。
    let roundTripRetried = false;
    // 实际发送的历史；若 provider 实例已确认端点拒收回传，起手即剥离。
    let effectiveMessages = opts?.roundTrip?.isSuppressed()
      ? stripReasoningFields(messages)
      : messages;

    async function execute() {
      const roundTrip = opts?.roundTrip;
      const body: Record<string, unknown> = {
        model: config.model,
        messages: effectiveMessages,
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
        // R-4 自愈：仅当"我们确实回了传" + 错误是"字段被拒收"（非"要求多带"）时，
        // 去字段重试一次。retry 标记保证不递归；"停回传"的记忆等重试请求
        // 真的被接受（response.ok）再落下，避免误判错误文案就把 R-3 能力永久关掉。
        if (
          roundTrip &&
          !roundTripRetried &&
          !roundTrip.isSuppressed() &&
          isReasoningRoundTripError(errorMessage) &&
          hasReasoningFields(effectiveMessages)
        ) {
          roundTripRetried = true;
          effectiveMessages = stripReasoningFields(effectiveMessages);
          return execute();
        }
        subscriber.error(new Error(`${t('providers.openai.requestFailed')}${errorMessage}`));
        return;
      }

      // 走到这里说明本次请求被端点接受：若它是自愈重试，正式记住"该端点停回传"。
      if (roundTrip && roundTripRetried) {
        roundTrip.setSuppressed();
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
      // R-1：按**实际命中的源字段名**累积 reasoning 原文（round-trip 字面回传用）。
      // 与 <think>/emitChunk 显示链完全独立，UI 渲染零改动。
      let reasoningField: string | undefined;
      let reasoningText = '';

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
            // R-1：探测**实际命中的字段名**，按源字段名累积增量原文（供 R-3 字面回传）。
            const sourceDelta = choice.delta ?? {};
            const hitField = detectReasoningField(sourceDelta);
            const reasoningDelta = hitField ? sourceDelta[hitField] : undefined;

            if (reasoningDelta) {
              // 首个非空增量锁定字段名；后续增量按同名累积（不跨字段混装）。
              if (reasoningField === undefined) {
                reasoningField = hitField;
              }
              if (reasoningField === hitField) {
                reasoningText += reasoningDelta;
              }
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
                subscriber.next({
                  type: 'tool_call',
                  call,
                  // reasoningText 非空 ⇒ reasoningField 必已锁定（R-1 首个非空增量时设置）。
                  ...(reasoningText && reasoningField
                    ? { reasoning: { field: reasoningField, content: reasoningText } }
                    : {}),
                });
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
              subscriber.next({
                type: 'tool_call',
                call,
                ...(reasoningText && reasoningField
                  ? { reasoning: { field: reasoningField, content: reasoningText } }
                  : {}),
              });
            }
          }

          // 流结束：发出最终的 assistant_message
          // 如果有工具调用，不需要 assistant_message
          if (toolCallMap.size === 0) {
            // 定稿即本轮 chunk 原文之和（与界面累积器同源），保证 transcript 不丢文本。
            subscriber.next({
              type: 'assistant_message',
              text: fullText,
              // R-2：reasoning 随定稿透传，字段名+原值不解释（供 R-3 回传）。
              ...(reasoningText && reasoningField
                ? { reasoning: { field: reasoningField, content: reasoningText } }
                : {}),
            });
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

  // R-4：自愈状态按 provider 实例记忆（一个实例锁定一个 baseUrl+model+profile）。
  // 放在工厂闭包而非 requestOpenAIStreaming，避免模块级全局态污染其它端点。
  let roundTripSuppressed = false;
  const roundTrip: ReasoningRoundTripHooks = {
    isSuppressed: () => roundTripSuppressed,
    setSuppressed: () => {
      roundTripSuppressed = true;
    },
  };

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
          roundTrip,
        });
      }).pipe(concatMap((obs) => obs));
    },
  };
}
