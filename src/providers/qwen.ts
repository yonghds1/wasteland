/**
 * qwen.ts - Qwen Provider 实现
 *
 * 本文件实现了通义千问 (Qwen) API 的 Provider。
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
 * ## 数据流向
 * ```
 * runStep() 被调用
 *      ↓
 * defer(() => requestQwenCompletion(...))  延迟执行 API 调用
 *      ↓
 * concatMap(response => handleResponse(response))  处理响应
 *      ↓
 * Observable<ProviderStreamEvent>
 *      ├─ assistant_chunk (多个，文本响应时)
 *      ├─ tool_call (多个，工具调用时)
 *      └─ assistant_message (最终)
 * ```
 */

import { defer, concatMap, from, of, type Observable } from "rxjs";

import type { ProviderSettings } from "../config/settings-types.js";
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

/** Qwen Provider 配置 */
type QwenProviderConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

/** Qwen API 响应（扩展 OpenAI 格式以支持 finish_reason 和 error） */
type QwenChatCompletionResponse = OpenAIChatCompletionResponse & {
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
// 常量定义
// ============================================================

/** 默认 Qwen API 基础 URL (阿里云灵积) */
const DEFAULT_QWEN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

// ============================================================
// 辅助函数：类型检查和配置解析
// ============================================================

/**
 * 检查值是否为普通对象
 * @param value - 要检查的值
 * @returns 是否为普通对象
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 规范化基础 URL
 *
 * 处理用户配置的 baseUrl：
 * - 去除首尾空白
 * - 去除尾部斜杠
 * - 添加 /v1 后缀（如果没有）
 *
 * @param rawBaseUrl - 原始 URL
 * @returns 规范化后的 URL
 */
function normalizeBaseUrl(rawBaseUrl: string | undefined): string {
  const normalized = (rawBaseUrl ?? DEFAULT_QWEN_BASE_URL).trim().replace(/\/+$/, "");

  if (normalized.length === 0) {
    return DEFAULT_QWEN_BASE_URL;
  }

  // 如果已经以 /v1 结尾，直接返回
  if (normalized.endsWith("/v1")) {
    return normalized;
  }

  // 添加 /v1 后缀
  return `${normalized}/v1`;
}

/**
 * 读取非空字符串配置
 *
 * @param settings - Provider 设置
 * @param key - 配置键名
 * @returns 配置值（非空字符串）或 undefined
 */
function readNonEmptyString(
  settings: ProviderSettings | undefined,
  key: "baseUrl" | "apiKey" | "model",
): string | undefined {
  const value = settings?.[key];

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * 解析 Qwen Provider 配置
 *
 * 从用户设置中提取必要参数：
 * - apiKey: 必需
 * - model: 必需
 * - baseUrl: 可选，有默认值
 *
 * @param settings - Provider 设置
 * @returns Qwen 配置对象
 * @throws 如果缺少必需配置
 */
function resolveQwenConfig(settings?: ProviderSettings): QwenProviderConfig {
  const apiKey = readNonEmptyString(settings, "apiKey");
  const model = readNonEmptyString(settings, "model");

  if (!apiKey) {
    throw new Error("provider qwen 缺少 apiKey 配置。");
  }

  if (!model) {
    throw new Error("provider qwen 缺少 model 配置。");
  }

  return {
    baseUrl: normalizeBaseUrl(readNonEmptyString(settings, "baseUrl")),
    apiKey,
    model,
  };
}

// ============================================================
// 辅助函数：消息转换
// ============================================================

/**
 * 提取文本内容
 *
 * Qwen API 可能返回字符串或结构化内容，需要统一提取为字符串。
 *
 * @param content - API 返回的内容
 * @returns 提取的文本
 * @throws 如果内容格式无效
 */
function extractTextContent(content: unknown): string {
  // 情况 1: 直接是字符串
  if (typeof content === "string") {
    return content;
  }

  // 情况 2: 数组格式 [{ type: "text", text: "..." }, ...]
  if (!Array.isArray(content)) {
    throw new Error("qwen 返回的 assistant content 不是字符串。");
  }

  // 提取每个 text 部分
  const text = content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (isRecord(part) && typeof part.text === "string") {
        return part.text;
      }

      return "";
    })
    .join("");

  if (text.length === 0) {
    throw new Error("qwen 返回的 assistant content 为空。");
  }

  return text;
}

// ============================================================
// 核心 API 调用
// ============================================================

/**
 * 请求 Qwen Chat Completion API（支持 Tool Calling）
 *
 * ## 请求格式
 * ```json
 * {
 *   "model": "qwen-turbo",
 *   "messages": [{ "role": "user", "content": "Hello" }],
 *   "tools": [{ "type": "function", "function": { ... } }],
 *   "stream": false
 * }
 * ```
 *
 * ## 响应格式
 * - 文本响应：
 * ```json
 * { "choices": [{ "finish_reason": "stop", "message": { "content": "..." } }] }
 * ```
 * - 工具调用响应：
 * ```json
 * { "choices": [{ "finish_reason": "tool_calls", "message": { "tool_calls": [...] } }] }
 * ```
 *
 * @param config - Qwen 配置
 * @param messages - OpenAI 格式消息数组
 * @param tools - OpenAI 格式工具定义（可选）
 * @returns Qwen API 响应
 * @throws 如果请求失败
 */
async function requestQwenCompletion(
  config: QwenProviderConfig,
  messages: readonly OpenAIMessage[],
  tools?: readonly OpenAIFunctionTool[],
): Promise<QwenChatCompletionResponse> {
  // 构建请求体
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: false, // 非流式模式（tool calling 标准做法）
  };

  // 如果有工具定义，添加到请求
  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  // 发送 POST 请求
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  // 解析响应 JSON
  let payload: QwenChatCompletionResponse | null = null;

  try {
    payload = await response.json() as QwenChatCompletionResponse;
  } catch {
    // JSON 解析失败
    if (!response.ok) {
      throw new Error(`qwen 请求失败：HTTP ${response.status}`);
    }

    throw new Error("qwen 返回了无法解析的 JSON。");
  }

  // 检查 HTTP 错误
  if (!response.ok) {
    const errorMessage = payload?.error?.message;

    throw new Error(
      errorMessage
        ? `qwen 请求失败：${errorMessage}`
        : `qwen 请求失败：HTTP ${response.status}`,
    );
  }

  return payload;
}

/**
 * 处理 Qwen API 响应
 *
 * 根据 finish_reason 区分处理：
 * - "stop": 文本响应 → 发出 assistant_chunk + assistant_message
 * - "tool_calls": 工具调用 → 发出多个 tool_call 事件
 *
 * @param payload - API 响应
 * @returns ProviderStreamEvent Observable
 */
function handleQwenResponse(payload: QwenChatCompletionResponse): Observable<ProviderStreamEvent> {
  const choice = payload.choices?.[0];

  if (!choice) {
    throw new Error("qwen 返回结果缺少 choices[0]。");
  }

  const finishReason = choice.finish_reason;
  const message = choice.message;

  // 工具调用响应
  if (finishReason === "tool_calls" && message?.tool_calls) {
    const toolCalls = parseToolCalls(message.tool_calls);
    // 发出多个 tool_call 事件
    return from<ProviderStreamEvent[]>(
      toolCalls.map((call) => ({ type: "tool_call" as const, call })),
    );
  }

  // 文本响应
  if (message?.content !== undefined && message.content !== null) {
    const text = extractTextContent(message.content);
    return createAssistantTextEvents(text);
  }

  // 其他情况（如空响应）
  throw new Error(`qwen 返回了意外的响应：finish_reason=${finishReason}`);
}

// ============================================================
// Provider 工厂函数
// ============================================================

/**
 * 创建 Qwen Provider
 *
 * ## RxJS 模式说明
 *
 * ### defer 操作符
 * `defer` 延迟执行工厂函数，直到 Observable 被订阅。
 * 这意味着每次订阅都会重新调用 API。
 *
 * ```ts
 * defer(() => apiCall())  // 每次 subscribe 都会调用 apiCall
 * ```
 *
 * ### concatMap 操作符
 * `concatMap` 将 API 响应转换为事件流。
 * 它会等待前一个 Observable 完成后再处理下一个。
 *
 * ```ts
 * concatMap(response => handleQwenResponse(response))
 * // response → Observable<assistant_chunk | tool_call | assistant_message>
 * ```
 *
 * ### Tool Calling 流程
 *
 * 1. Provider 接收 context 和 state
 * 2. 使用 buildMessages 构建消息（含工具历史）
 * 3. 使用 buildOpenAITools 构建工具定义
 * 4. 发送请求，接收响应
 * 5. 根据 finish_reason 分发事件：
 *    - "tool_calls" → 发出多个 tool_call 事件
 *    - "stop" → 发出 assistant_chunk + assistant_message
 *
 * @param settings - Provider 配置
 * @returns AgentProvider 实例
 */
export function createQwenProvider(settings?: ProviderSettings): AgentProvider {
  const config = resolveQwenConfig(settings);

  return {
    id: "qwen",

    /**
     * 运行单步对话
     *
     * @param input - 包含上下文和状态的输入
     * @returns Provider 事件流
     */
    runStep({ context, state }: ProviderStepInput) {
      // defer: 延迟执行，确保每次订阅时都发起新请求
      return defer(async () => {
        // 构建消息（使用 openai-compatible 模块）
        const messages = buildMessages({
          history: context.history,
          input: context.input.content,
          toolResults: state.toolResults,
          prompt: context.prompt,
        });

        // 构建工具定义（如果有工具注册表）
        const tools = context.toolRegistry
          ? buildOpenAITools(context.toolRegistry)
          : undefined;

        // 发送请求
        return requestQwenCompletion(config, messages, tools);
      }).pipe(
        // concatMap: 将响应转换为事件流
        concatMap((response) => handleQwenResponse(response)),
      );
    },
  };
}
