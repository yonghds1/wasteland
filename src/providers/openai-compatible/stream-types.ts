/**
 * stream-types.ts - OpenAI 兼容 SSE 流式响应的内部类型
 *
 * 从 `providers/openai.ts` 拆出，用于控制单文件行数（CLAUDE.md: 单文件 ≤500 行）。
 * 只描述线上报文形状，不含解析行为；解析仍由 openai.ts 负责
 * （reasoning 字段探测见 `providers/shared/reasoning-roundtrip.ts`）。
 */

/** SSE delta 载荷（含各厂商 reasoning 字段变体） */
export type OpenAIStreamDelta = {
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

/** OpenAI SSE 流式响应 chunk */
export type OpenAIStreamChunk = {
  choices: Array<{
    delta: OpenAIStreamDelta;
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

/** 工具调用累积器（SSE 增量拼接） */
export type ToolCallAccumulator = {
  id: string;
  name: string;
  arguments: string;
};
