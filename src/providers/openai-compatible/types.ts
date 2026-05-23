/**
 * types.ts - OpenAI 兼容 API 类型定义
 *
 * 定义 OpenAI Chat Completions API 的工具调用相关类型。
 * 许多模型提供商（Qwen、DeepSeek、智谱等）都兼容此格式。
 *
 * ## 为什么需要这些类型？
 *
 * 1. 类型安全：确保 API 请求/响应格式正确
 * 2. 文档化：类型定义本身就是 API 文档
 * 3. 复用：所有 OpenAI 兼容的 provider 都能使用
 */

// ============================================================
// 工具定义类型
// ============================================================

/**
 * JSON Schema 类型定义
 *
 * 用于描述工具参数的结构。
 */
export type JsonSchema = {
  type: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  [key: string]: unknown;
};

/**
 * OpenAI 函数工具定义
 *
 * 在 API 请求中定义可用工具。
 *
 * @example
 * {
 *   type: 'function',
 *   function: {
 *     name: 'edit-file',
 *     description: '精确编辑文件',
 *     parameters: {
 *       type: 'object',
 *       properties: {
 *         path: { type: 'string', description: '文件路径' },
 *         old_string: { type: 'string', description: '要替换的字符串' },
 *         new_string: { type: 'string', description: '替换后的字符串' }
 *       },
 *       required: ['path', 'old_string', 'new_string']
 *     }
 *   }
 * }
 */
export type OpenAIFunctionTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: JsonSchema;
  };
};

/**
 * 工具选择策略
 *
 * - 'auto': 模型自动决定是否调用工具
 * - 'none': 不调用工具，只生成文本
 * - 'required': 必须调用工具
 * - { type: 'function', function: { name: '...' } }: 强制调用特定工具
 */
export type OpenAIToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

// ============================================================
// 消息类型
// ============================================================

/**
 * OpenAI 聊天消息
 *
 * 基础消息格式，支持 user、assistant、system 角色。
 */
export type OpenAIChatMessage = {
  role: "user" | "assistant" | "system";
  content: string | null;
};

/**
 * OpenAI 工具调用
 *
 * 当模型决定调用工具时，返回此结构。
 *
 * @example
 * {
 *   id: 'call_abc123',
 *   type: 'function',
 *   function: {
 *     name: 'edit-file',
 *     arguments: '{"path": "src/file.ts", "old_string": "x", "new_string": "y"}'
 *   }
 * }
 */
export type OpenAIToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON 字符串，需要解析
  };
};

/**
 * OpenAI Assistant 消息（可能包含工具调用）
 *
 * 当模型调用工具时，content 为 null，tool_calls 包含调用信息。
 */
export type OpenAIAssistantMessage = {
  role: "assistant";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
};

/**
 * OpenAI Tool 消息（工具执行结果）
 *
 * 将工具执行结果返回给模型。
 *
 * @example
 * {
 *   role: 'tool',
 *   tool_call_id: 'call_abc123',
 *   content: '成功编辑文件 src/file.ts'
 * }
 */
export type OpenAIToolMessage = {
  role: "tool";
  tool_call_id: string;
  content: string;
};

/**
 * OpenAI 消息（联合类型）
 *
 * 支持所有消息类型：普通聊天、助手（含工具调用）、工具结果。
 */
export type OpenAIMessage = OpenAIChatMessage | OpenAIAssistantMessage | OpenAIToolMessage;

// ============================================================
// API 响应类型
// ============================================================

/**
 * OpenAI Chat Completion 响应
 *
 * 包含模型回复，可能是文本或工具调用。
 */
export type OpenAIChatCompletionResponse = {
  id: string;
  object: "chat.completion";
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: "stop" | "tool_calls" | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

/**
 * OpenAI API 错误响应
 */
export type OpenAIErrorResponse = {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};
