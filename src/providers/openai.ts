/**
 * openai.ts - OpenAI 兼容 Provider 实现
 *
 * 支持所有兼容 OpenAI Chat Completions API 的服务：
 * - OpenAI
 * - Ollama (本地)
 * - Qwen (阿里云通义千问)
 * - DeepSeek
 * - 智谱 GLM
 * - 京东云、小米等其他兼容服务
 *
 * ## 核心设计模式
 *
 * ### 1. defer + API 调用
 * 使用 `defer` 包装异步 API 调用，确保每次订阅时都会发起新的请求。
 *
 * ### 2. concatMap + 流式事件
 * 将 API 返回的文本转换为流式事件流（chunk + final message）。
 *
 * ### 3. Tool Calling 支持
 * 使用 openai-compatible 模块处理工具调用：
 * - buildOpenAITools: 转换工具定义为 OpenAI 格式
 * - parseToolCalls: 解析 OpenAI tool_calls 响应
 * - buildMessages: 构建包含工具历史的消息
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
 *     },
 *     "ollama": {
 *       "type": "openai-compatible",
 *       "baseUrl": "http://localhost:11434/v1",
 *       "model": "qwen2.5:7b"
 *     },
 *     "jdcloud": {
 *       "type": "openai-compatible",
 *       "baseUrl": "https://modelservice.jdcloud.com/coding/openai/v1",
 *       "apiKey": { "$auth": "jdcloud_api_key" },
 *       "model": "GLM-5"
 *     }
 *   }
 * }
 * ```
 */

import { defer, concatMap, from, type Observable } from "rxjs";

import type { ProviderSettings } from "../config/settings-types.js";
import { t } from "../locales/index.js";
import { createAssistantTextEvents } from "./assistant-events.js";
import type { AgentProvider, ProviderStreamEvent } from "./provider-types.js";
import type { ProviderStepInput } from "./provider-types.js";
import {
  buildOpenAITools,
  buildMessages,
  parseToolCalls,
  type OpenAIChatCompletionResponse,
  type OpenAIFunctionTool,
  type OpenAIMessage,
} from "./openai-compatible/index.js";

// ============================================================
// 类型定义
// ============================================================

/** OpenAI 兼容 Provider 配置 */
type OpenAIProviderConfig = {
  baseUrl: string;
  apiKey?: string;  // 可选，Ollama 等本地服务不需要
  model: string;
};

/** OpenAI API 响应 */
type OpenAIChatResponse = OpenAIChatCompletionResponse & {
  choices?: Array<{
    finish_reason?: "stop" | "tool_calls" | string;
    message?: {
      content?: unknown;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

// ============================================================
// 辅助函数
// ============================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 读取非空字符串配置
 */
function readNonEmptyString(
  settings: ProviderSettings | undefined,
  key: "baseUrl" | "apiKey" | "model",
): string | undefined {
  const value = settings?.[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * 解析 Provider 配置
 *
 * - baseUrl 和 model 必需
 * - apiKey 可选（Ollama 等本地服务不需要）
 * - baseUrl 直接使用用户配置的值，不做自动追加
 */
function resolveOpenAIConfig(settings?: ProviderSettings): OpenAIProviderConfig {
  const apiKey = readNonEmptyString(settings, "apiKey");
  const model = readNonEmptyString(settings, "model");
  const baseUrl = readNonEmptyString(settings, "baseUrl");

  if (!model) throw new Error(t("providers.openai.missingModel"));
  if (!baseUrl) throw new Error(t("providers.openai.missingBaseUrl"));

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    model,
  };
}

// ============================================================
// 核心 API 调用
// ============================================================

/**
 * 请求 OpenAI Chat Completion API
 *
 * 注意：apiKey 可选，Ollama 等本地服务不需要认证
 */
async function requestOpenAICompletion(
  config: OpenAIProviderConfig,
  messages: readonly OpenAIMessage[],
  tools?: readonly OpenAIFunctionTool[],
): Promise<OpenAIChatResponse> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: false,
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  // 构建 headers：apiKey 可选（Ollama 不需要）
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  let payload: OpenAIChatResponse | null = null;

  try {
    payload = await response.json() as OpenAIChatResponse;
  } catch {
    if (!response.ok) {
      throw new Error(`${t("providers.openai.requestFailed")} HTTP ${response.status}`);
    }
    throw new Error(t("providers.openai.invalidJson"));
  }

  if (!response.ok) {
    const errorMessage = payload?.error?.message;
    throw new Error(
      errorMessage
        ? `${t("providers.openai.requestFailed")}${errorMessage}`
        : `${t("providers.openai.requestFailed")} HTTP ${response.status}`,
    );
  }

  return payload;
}

/**
 * 处理 OpenAI API 响应
 */
function handleOpenAIResponse(payload: OpenAIChatResponse): Observable<ProviderStreamEvent> {
  const choice = payload.choices?.[0];

  if (!choice) {
    throw new Error(t("providers.openai.missingChoices"));
  }

  const finishReason = choice.finish_reason;
  const message = choice.message;

  // 工具调用响应
  if (finishReason === "tool_calls" && message?.tool_calls) {
    const toolCalls = parseToolCalls(message.tool_calls);
    return from<ProviderStreamEvent[]>(
      toolCalls.map((call) => ({ type: "tool_call" as const, call })),
    );
  }

  // 文本响应
  if (message?.content !== undefined && message.content !== null) {
    const text = extractTextContent(message.content);
    return createAssistantTextEvents(text);
  }

  throw new Error(`${t("providers.openai.unexpectedResponse")}finish_reason=${finishReason}`);
}

/**
 * 提取文本内容
 */
function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    throw new Error(t("providers.openai.contentNotString"));
  }

  const text = content
    .map((part) => {
      if (typeof part === "string") return part;
      if (isRecord(part) && typeof part.text === "string") return part.text;
      return "";
    })
    .join("");

  if (text.length === 0) {
    throw new Error(t("providers.openai.contentEmpty"));
  }

  return text;
}

// ============================================================
// Provider 工厂函数
// ============================================================

/**
 * 创建 OpenAI 兼容 Provider
 *
 * 支持所有兼容 OpenAI Chat Completions API 的服务：
 * - OpenAI、Ollama（本地）、阿里云、智谱、京东云、小米等
 *
 * @param settings - Provider 配置
 * @returns AgentProvider 实例
 */
export function createOpenAIProvider(settings?: ProviderSettings): AgentProvider {
  const config = resolveOpenAIConfig(settings);

  return {
    id: "openai-compatible",

    runStep({ context, state }: ProviderStepInput) {
      return defer(async () => {
        const messages = buildMessages({
          history: context.history,
          input: context.input.content,
          toolResults: state.toolResults,
          prompt: context.prompt,
        });

        const tools = context.toolRegistry
          ? buildOpenAITools(context.toolRegistry)
          : undefined;

        return requestOpenAICompletion(config, messages, tools);
      }).pipe(
        concatMap((response) => handleOpenAIResponse(response)),
      );
    },
  };
}
