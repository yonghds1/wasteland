/**
 * openai-compatible 模块
 *
 * 提供 OpenAI 兼容 API 的通用工具调用实现。
 * 所有兼容 OpenAI Chat Completions API 的 provider 都可复用。
 *
 * ## 包含的模块
 *
 * - types: OpenAI API 类型定义
 * - tool-adapter: 工具定义和调用转换
 * - message-builder: 消息构建器
 *
 * ## 使用示例
 *
 * ```typescript
 * import {
 *   buildOpenAITools,
 *   buildMessages,
 *   parseToolCalls,
 * } from "./openai-compatible/index.js";
 *
 * // 构建请求
 * const tools = buildOpenAITools(toolRegistry);
 * const messages = buildMessages({ history, input, toolResults });
 *
 * // 发送请求
 * const response = await fetch("/chat/completions", {
 *   body: JSON.stringify({ model, messages, tools }),
 * });
 *
 * // 解析响应
 * if (response.choices[0].finish_reason === "tool_calls") {
 *   const calls = parseToolCalls(response.choices[0].message.tool_calls);
 *   // 执行工具...
 * }
 * ```
 *
 * ## 支持的 Provider
 *
 * - Qwen（阿里云通义千问）
 * - DeepSeek
 * - 智谱 GLM
 * - Moonshot（月之暗面）
 * - OpenAI
 * - 其他兼容 OpenAI API 的服务
 */

export type {
  JsonSchema,
  OpenAIFunctionTool,
  OpenAIToolChoice,
  OpenAIChatMessage,
  OpenAIToolCall,
  OpenAIAssistantMessage,
  OpenAIToolMessage,
  OpenAIMessage,
  OpenAIChatCompletionResponse,
  OpenAIErrorResponse,
} from './types.js';

export {
  buildOpenAITools,
  parseToolCalls,
  hasParseError,
  getParseErrorMessage,
} from './tool-adapter.js';

export { buildMessages, buildToolResultMessages, needsToolLoop } from './message-builder.js';
