import type { PermissionDecisionKind, PermissionMode } from '../engine/permission-gate.js';
import type { ToolInput, ToolRunStatus } from '@tools/core/tool-types.js';
import type { SkillArgs, SkillResult } from '@core/skills/skill-types.js';

/**
 * 输入来源
 *
 * 标识用户输入的来源渠道：
 * - "message": 命令行 --message 参数传入的单条消息
 * - "stdin": 通过标准输入管道传入
 * - "interactive": 交互式对话中用户主动输入
 */
export type FinishReason = 'stop' | 'error' | 'max_steps' | 'abort';

export type InputSource = 'message' | 'stdin' | 'interactive';

/**
 * Reasoning 字面回传载荷（round-trip）
 *
 * 上游（OpenAI 兼容厂商）在这条 assistant 消息上发过哪个 reasoning 字段、原值是什么，
 * 续传历史时就用**同名原字段、原值**带回。`field` 是实际命中的源字段名
 * （`reasoning_content` / `reasoning` / `thought`），不解释、不归一化。
 *
 * 定义在 core 层，供 record 类型与 provider 事件类型共用（分层方向：provider → core）。
 * 见 `.trellis/tasks/09-13-reasoning-roundtrip/prd.md`。
 */
export type ReasoningPayload = {
  /** 上游实际使用的字段名（字面回传时作为 key 放回） */
  field: string;
  /** 该字段累积的原文（不截断，字面回传） */
  content: string;
};

/**
 * 运行时模式
 *
 * - "single": 单次执行模式，处理一条消息后退出
 * - "interactive": 交互模式，持续等待用户输入
 */
export type RuntimeMode = 'single' | 'interactive';

/**
 * 聊天输入轮次
 *
 * 表示用户的一次输入，包含输入内容和元数据。
 *
 * @property turn - 轮次编号，从 1 开始递增
 * @property content - 用户输入的文本内容
 * @property source - 输入来源
 */
export type ChatInputTurn = {
  turn: number;
  content: string;
  source: InputSource;
};

// 导出所有会话记录与历史类型
export type {
  SessionMessageRecord,
  SessionToolCallRecord,
  SessionPermissionRecord,
  SessionToolResultRecord,
  SessionSummaryRecord,
  HistoryRecord,
  SessionStartRecord,
  SessionEndRecord,
  SessionUsageRecord,
  SessionUndoRecord,
  SessionCompactionRecord,
  SessionRecord,
} from "./session-record-types.js";


/**
 * 运行时事件（可辨识联合类型）
 *
 * 这是 CLI 运行时的核心事件类型，表示整个对话过程中的所有事件。
 * UI 层通过订阅这些事件来更新显示，测试通过验证这些事件来检查行为。
 *
 * ## 事件类型说明
 *
 * ### 会话生命周期
 * - "session_started": 会话开始，包含会话配置信息
 * - "session_ended": 会话结束
 *
 * ### 对话轮次
 * - "user_turn": 用户输入
 * - "assistant_chunk": AI 响应片段（流式输出）
 * - "assistant_message": AI 响应完成
 *
 * ### 工具执行
 * - "tool_call_requested": AI 请求调用工具
 * - "permission_decision": 权限决策结果
 * - "tool_started": 工具开始执行
 * - "tool_result": 工具执行成功
 * - "tool_failed": 工具执行失败或被阻止
 *
 * ## 使用示例
 *
 * @example
 * // 处理运行时事件
 * events$.subscribe(event => {
 *   switch (event.type) {
 *     case "assistant_chunk":
 *       process.stdout.write(event.chunk);
 *       break;
 *     case "tool_result":
 *       console.log(`工具 ${event.toolName} 成功: ${event.output}`);
 *       break;
 *   }
 * });
 */
export type RuntimeEvent =
  | {
      /** 会话开始事件 */
      type: 'session_started';
      sessionId: string;
      sessionPath: string;
      mode: RuntimeMode;
    }
  | {
      /** 用户输入事件 */
      type: 'user_turn';
      sessionId: string;
      turn: number;
      content: string;
      source: InputSource;
    }
  | {
      /** AI 响应片段事件（流式输出） */
      type: 'assistant_chunk';
      sessionId: string;
      turn: number;
      chunk: string;
    }
  | {
      /** AI 响应完成事件 */
      type: 'assistant_message';
      sessionId: string;
      turn: number;
      content: string;
    }
  | {
      /** 工具调用请求事件 */
      type: 'tool_call_requested';
      sessionId: string;
      turn: number;
      callId: string;
      toolName: string;
      input: ToolInput;
    }
  | {
      /** 权限决策事件 */
      type: 'permission_decision';
      sessionId: string;
      turn: number;
      callId: string;
      toolName: string;
      decision: PermissionDecisionKind;
      mode: PermissionMode;
      reason: string;
    }
  | {
      /** 工具开始执行事件 */
      type: 'tool_started';
      sessionId: string;
      turn: number;
      callId: string;
      toolName: string;
    }
  | {
      /** 工具执行成功事件 */
      type: 'tool_result';
      sessionId: string;
      turn: number;
      callId: string;
      toolName: string;
      status: 'success';
      output: string;
    }
  | {
      /** 工具执行失败事件 */
      type: 'tool_failed';
      sessionId: string;
      turn: number;
      callId: string;
      toolName: string;
      status: Exclude<ToolRunStatus, 'success'>;
      error: string;
    }
  | {
      /** 会话结束事件 */
      type: 'session_ended';
      sessionId: string;
      finishReason?: FinishReason;
      error?: string;
    }
  | {
      /** 子 Agent 创建事件 */
      type: 'agent_spawned';
      parentId: string;
      childId: string;
      childSessionPath: string;
      name: string;
      task: string;
    }
  | {
      /** 子 Agent 完成事件 */
      type: 'agent_completed';
      childId: string;
      status: 'success' | 'error' | 'timeout';
      result?: string;
      error?: string;
      sessionPath: string;
    }
  | {
      /** 技能调用开始事件 */
      type: 'skill_started';
      sessionId: string;
      turn: number;
      skillName: string;
      args: SkillArgs;
    }
  | {
      /** 技能执行结果事件 */
      type: 'skill_result';
      sessionId: string;
      turn: number;
      skillName: string;
      result: SkillResult;
    }
  | {
      /** 用户输入请求事件（ask-user 工具触发） */
      type: 'user_input_requested';
      sessionId: string;
      turn: number;
      callId: string;
      question: string;
      options?: string[];
      /**
       * 权限问询的结构化上下文（权限 ask 分支填写，ask-user 工具可不填）。
       * UI 由此推导 once/always 模式，无需正则反解析 question。
       */
      toolName?: string;
      input?: Record<string, unknown>;
    }
  | {
      /** 用户输入响应事件（用户回答后触发） */
      type: 'user_input_received';
      sessionId: string;
      turn: number;
      callId: string;
      answer: string;
    }
  | {
      /** 子 Agent 进度更新事件 */
      type: 'agent_progress';
      childId: string;
      childName: string;
      status: string;
      message?: string;
    }
  | {
      /** 子 Agent 思考事件 */
      type: 'agent_thinking';
      childId: string;
      childName: string;
      content: string;
    }
  | {
      /** 子 Agent 工具调用事件 */
      type: 'agent_tool_use';
      childId: string;
      childName: string;
      toolName: string;
      input?: Record<string, unknown>;
    }
  | {
      /** Token 使用量更新事件 */
      type: 'usage_update';
      sessionId: string;
      turn: number;
      usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        cachedTokens?: number;
      };
      timing?: {
        ttftMs: number;
        totalMs: number;
        tokensPerSec: number;
      };
    }
  | {
      /** 上下文压缩事件 */
      type: 'context_compacted';
      sessionId: string;
      turn: number;
      removedCount: number;
      tokensSaved: number;
      /** 是否使用了 LLM 摘要保留早期上下文（false 表示降级为直接丢弃） */
      summarized?: boolean;
    }
  | {
      /** 上下文预算警告：prompt + history 接近 context window 上限 */
      type: 'context_budget_warning';
      sessionId: string;
      turn: number;
      promptTokens: number;
      historyTokens: number;
      contextWindow: number;
    };
