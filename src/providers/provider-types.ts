import type { Observable } from 'rxjs';

import type { TurnContext } from '@core/runtime/turn-context.js';
import type { TurnState } from '@core/engine/turn-state.js';
import type { ToolCall } from '@tools/core/tool-types.js';

/**
 * Provider 流事件（可辨识联合类型）
 *
 * 这是 AI Provider 在生成响应过程中发出的事件流。
 * 使用联合类型配合 type 字段区分不同事件类型。
 *
 * 事件类型说明：
 * - "assistant_chunk": AI 生成的文本片段（流式输出）
 * - "tool_call": AI 请求调用工具
 * - "assistant_message": AI 完成的完整消息
 *
 * @example
 * // 处理 provider 事件
 * provider.runStep(params).subscribe(event => {
 *   switch (event.type) {
 *     case "assistant_chunk":
 *       // 流式显示文本片段
 *       process.stdout.write(event.text);
 *       break;
 *     case "tool_call":
 *       // 执行工具调用
 *       await executeTool(event.call);
 *       break;
 *     case "assistant_message":
 *       // 完整消息已生成
 *       console.log(event.text);
 *       break;
 *   }
 * });
 */
export type ProviderStreamEvent =
  | {
      /** 事件类型：AI 生成的文本片段 */
      type: 'assistant_chunk';
      /** 文本片段内容 */
      text: string;
    }
  | {
      /** 事件类型：AI 请求调用工具 */
      type: 'tool_call';
      /** 工具调用请求详情 */
      call: ToolCall;
    }
  | {
      /** 事件类型：AI 完成的完整消息 */
      type: 'assistant_message';
      /** 完整消息内容 */
      text: string;
    }
  | {
      /** 事件类型：Token 使用量统计 */
      type: 'usage';
      /** Token 使用量 */
      usage: ProviderUsage;
    };

/**
 * Provider Token 使用量
 */
export type ProviderUsage = {
  /** 输入 token 数 */
  promptTokens: number;
  /** 输出 token 数 */
  completionTokens: number;
  /** 总 token 数 */
  totalTokens: number;
  /** 缓存命中的 token 数（可选） */
  cachedTokens?: number;
};

/**
 * Provider 步骤输入
 *
 * 调用 runStep 时需要提供的参数，包含当前对话的上下文和状态。
 *
 * @property context - 对话上下文，包含会话信息、用户输入、历史记录等
 * @property state - 当前 turn 的状态，包含已生成的文本、工具调用结果等
 */
export type ProviderStepInput = {
  context: TurnContext;
  state: TurnState;
};

/**
 * Agent Provider 接口
 *
 * 定义 AI 模型提供者必须实现的方法。
 * Provider 负责根据对话上下文生成 AI 响应。
 *
 * @property id - Provider 标识符，如 "local"、"openai"、"anthropic"
 * @method runStep - 执行一步生成，返回 Observable 事件流
 *
 * ## 关于 Observable<ProviderStreamEvent>
 *
 * 使用 Observable 而非 Promise 的原因：
 * 1. 支持流式输出：AI 生成文本时逐步发出 assistant_chunk 事件
 * 2. 支持多事件：一次调用可能产生多个文本片段和工具调用
 * 3. 可取消：用户可以中断生成过程
 *
 * @example
 * const provider: AgentProvider = {
 *   id: "openai",
 *   runStep({ context, state }) {
 *     // 返回一个 Observable，逐步发出事件
 *     return new Observable(subscriber => {
 *       subscriber.next({ type: "assistant_chunk", text: "Hello" });
 *       subscriber.next({ type: "assistant_chunk", text: " world" });
 *       subscriber.next({ type: "assistant_message", text: "Hello world" });
 *       subscriber.complete();
 *     });
 *   },
 * };
 */
export interface AgentProvider {
  readonly id: string;
  runStep(input: ProviderStepInput): Observable<ProviderStreamEvent>;
}
