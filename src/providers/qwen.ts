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
 * ## 数据流向
 * ```
 * runStep() 被调用
 *      ↓
 * defer(() => requestQwenCompletion(...))  延迟执行 API 调用
 *      ↓
 * concatMap(text => createAssistantTextEvents(text))  转换为事件流
 *      ↓
 * Observable<ProviderStreamEvent>
 *      ├─ assistant_chunk (多个)
 *      └─ assistant_message (最终)
 * ```
 */

import { defer, concatMap } from "rxjs";

import type { ProviderSettings } from "../config/settings-types.js";
import type { SessionMessageRecord } from "../runtime/event-types.js";
import { createAssistantTextEvents } from "./assistant-events.js";
import type { AgentProvider } from "./provider-types.js";

// ============================================================
// 类型定义
// ============================================================

/** Qwen Provider 配置 */
type QwenProviderConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

/** Qwen 聊天消息格式 */
type QwenChatMessage = {
  role: "user" | "assistant";
  content: string;
};

/** Qwen API 响应格式 */
type QwenChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
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
 * 将会话历史转换为 Qwen API 消息格式
 *
 * @param history - 会话历史记录
 * @param input - 当前用户输入
 * @returns Qwen 消息数组
 */
function toQwenMessages(history: readonly SessionMessageRecord[], input: string): QwenChatMessage[] {
  const messages: QwenChatMessage[] = [];

  // 添加历史消息
  for (const message of history) {
    messages.push({
      role: message.role,
      content: message.content,
    });
  }

  // 添加当前用户输入
  messages.push({
    role: "user",
    content: input,
  });

  return messages;
}

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
 * 请求 Qwen Chat Completion API
 *
 * ## 请求格式
 * ```json
 * {
 *   "model": "qwen-turbo",
 *   "messages": [{ "role": "user", "content": "Hello" }],
 *   "stream": false
 * }
 * ```
 *
 * ## 响应格式
 * ```json
 * {
 *   "choices": [{
 *     "message": {
 *       "content": "Hi! How can I help you?"
 *     }
 *   }]
 * }
 * ```
 *
 * @param config - Qwen 配置
 * @param messages - 消息数组
 * @returns 助手回复文本
 * @throws 如果请求失败或响应格式错误
 */
async function requestQwenCompletion(
  config: QwenProviderConfig,
  messages: readonly QwenChatMessage[],
): Promise<string> {
  // 发送 POST 请求
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,  // 非流式模式
    }),
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

  // 提取内容
  const content = payload?.choices?.[0]?.message?.content;

  if (content === undefined) {
    throw new Error("qwen 返回结果缺少 choices[0].message.content。");
  }

  return extractTextContent(content);
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
 * `concatMap` 将 API 返回的文本转换为事件流。
 * 它会等待前一个 Observable 完成后再处理下一个。
 *
 * ```ts
 * concatMap(text => createAssistantTextEvents(text))
 * // text → Observable<assistant_chunk, ..., assistant_message>
 * ```
 *
 * ### 为什么使用这个模式？
 *
 * 1. **延迟执行**: defer 确保 API 调用在订阅时才发生
 * 2. **可取消**: 如果 Observable 被取消订阅，可以中断请求
 * 3. **流式输出**: 虽然是非流式 API，但通过 createAssistantTextEvents
 *    模拟出 chunk + final message 的流式效果
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
    runStep({ context }) {
      // defer: 延迟执行，确保每次订阅时都发起新请求
      return defer(() =>
        requestQwenCompletion(
          config,
          toQwenMessages(context.history, context.input.content),
        ),
      ).pipe(
        // concatMap: 将文本转换为流式事件
        // createAssistantTextEvents 会发出：
        // 1. 多个 assistant_chunk (文本片段)
        // 2. 一个 assistant_message (最终消息)
        concatMap((text) => createAssistantTextEvents(text)),
      );
    },
  };
}
