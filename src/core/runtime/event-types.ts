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

/**
 * 会话消息记录
 *
 * 记录用户或 AI 的消息内容，用于历史记录和上下文管理。
 *
 * @property type - 固定为 "message"，用于区分记录类型
 * @property role - 消息角色："user" 表示用户，"assistant" 表示 AI
 * @property turn - 所属对话轮次
 * @property content - 消息文本内容
 * @property timestamp - 消息时间戳（ISO 8601 格式）
 * @property source - 可选的输入来源（仅用户消息有）
 */
export type SessionMessageRecord = {
  type: 'message';
  role: 'user' | 'assistant';
  turn: number;
  content: string;
  timestamp: string;
  source?: InputSource;
  /**
   * 可选：assistant 消息携带的 reasoning 原文（round-trip 字面回传用）。
   * 缺失（旧会话 / 非思考模型）时序列化结果与今天逐字节一致。
   */
  reasoning?: ReasoningPayload;
};

/**
 * 会话工具调用记录
 *
 * 记录工具调用请求，用于审计和追踪工具执行历史。
 *
 * @property type - 固定为 "tool_call"
 * @property sessionId - 所属会话 ID
 * @property turn - 所属对话轮次
 * @property callId - 工具调用的唯一标识符
 * @property toolName - 被调用的工具名称
 * @property input - 传递给工具的参数
 * @property timestamp - 调用时间戳
 */
export type SessionToolCallRecord = {
  type: 'tool_call';
  sessionId: string;
  turn: number;
  callId: string;
  toolName: string;
  input: ToolInput;
  timestamp: string;
  /**
   * 可选：发起本 tool_call 的 assistant 消息携带的 reasoning 原文（round-trip 字面回传用）。
   * 工具循环中间步同样带过 reasoning，strict 网关要求回传（见 09-13 PRD R-3 范围扩展）。
   * 缺失时序列化结果与今天逐字节一致。
   */
  reasoning?: ReasoningPayload;
};

/**
 * 会话权限决策记录
 *
 * 记录权限系统对工具调用的决策，用于审计权限请求。
 *
 * @property type - 固定为 "permission"
 * @property sessionId - 所属会话 ID
 * @property turn - 所属对话轮次
 * @property callId - 对应的工具调用 ID
 * @property toolName - 工具名称
 * @property decision - 权限决策结果："allow"（允许）、"ask"（询问）、"deny"（拒绝）
 * @property mode - 当前的权限模式
 * @property reason - 决策原因说明
 * @property timestamp - 决策时间戳
 */
export type SessionPermissionRecord = {
  type: 'permission';
  sessionId: string;
  turn: number;
  callId: string;
  toolName: string;
  decision: PermissionDecisionKind;
  mode: PermissionMode;
  reason: string;
  timestamp: string;
};

/**
 * 会话工具结果记录
 *
 * 记录工具执行的最终结果，用于追踪工具执行状态。
 *
 * @property type - 固定为 "tool_result"
 * @property sessionId - 所属会话 ID
 * @property turn - 所属对话轮次
 * @property callId - 对应的工具调用 ID
 * @property toolName - 工具名称
 * @property status - 执行状态："success" 或 "error" 或 "blocked"
 * @property output - 可选的成功输出（status 为 success 时有值）
 * @property error - 可选的错误信息（status 为 error 或 blocked 时有值）
 * @property timestamp - 结果时间戳
 */
export type SessionToolResultRecord = {
  type: 'tool_result';
  sessionId: string;
  turn: number;
  callId: string;
  toolName: string;
  status: ToolRunStatus;
  output?: string;
  error?: string;
  timestamp: string;
};

/**
 * 会话摘要记录
 *
 * 上下文压缩时，对被移除的旧消息生成的 LLM 摘要。
 * 作为单条记录插入 history 头部，替代被丢弃的多条旧消息，
 * 让模型仍能看到早期对话的关键信息。
 *
 * 注意：仅存在于 in-memory history（不持久化到 session 文件）。
 * 持久化的 session 仍保留完整原始记录；resume 时重新加载完整历史，
 * 压缩会按需重新触发。这避免了"摘要 + 原始记录"在 resume 时重复。
 *
 * @property type - 固定为 "summary"
 * @property turn - 生成摘要时的轮次
 * @property content - 摘要文本
 * @property summarizedCount - 被摘要的原始记录数
 * @property timestamp - 生成时间戳
 */
export type SessionSummaryRecord = {
  type: 'summary';
  turn: number;
  content: string;
  summarizedCount: number;
  timestamp: string;
};

/**
 * 历史记录联合类型
 *
 * 包含会话中所有可作为上下文的记录类型：
 * - SessionMessageRecord: 用户/AI 消息
 * - SessionToolCallRecord: 工具调用请求
 * - SessionToolResultRecord: 工具执行结果
 * - SessionSummaryRecord: 压缩时生成的旧消息摘要
 *
 * 用于 history 数组，支持完整的上下文管理。
 */
export type HistoryRecord =
  | SessionMessageRecord
  | SessionToolCallRecord
  | SessionToolResultRecord
  | SessionSummaryRecord;

/**
 * 会话开始记录
 *
 * 记录会话的初始化信息，包括工作目录、Provider、运行模式等。
 *
 * @property type - 固定为 "session"
 * @property sessionId - 会话唯一标识
 * @property mode - 运行模式
 * @property cwd - 工作目录
 * @property provider - Provider 名称
 * @property timestamp - 创建时间戳
 * @property parentId - 父会话 ID（如果是子 Agent）
 * @property childName - 子 Agent 名称（如果是子 Agent）
 */
export type SessionStartRecord = {
  type: 'session';
  sessionId: string;
  mode: RuntimeMode;
  cwd: string;
  provider: string;
  timestamp: string;
  /** 父会话 ID（如果是子 Agent） */
  parentId?: string;
  /** 子 Agent 名称（如果是子 Agent） */
  childName?: string;
};

/**
 * 会话结束记录
 *
 * @property type - 固定为 "session_end"
 * @property sessionId - 会话唯一标识
 * @property timestamp - 结束时间戳
 */
export type SessionEndRecord = {
  type: 'session_end';
  sessionId: string;
  timestamp: string;
};

/**
 * 会话使用量记录
 *
 * 记录每次请求的 token 使用量和性能指标。
 */
export type SessionUsageRecord = {
  type: 'usage';
  sessionId: string;
  turn: number;
  timestamp: string;
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
};

/**
 * 会话上下文压缩记录
 *
 * 记录一次上下文压缩（同步滑动切割或异步摘要压缩），供 session 索引聚合
 * 出会话级压缩统计（可观测性）。
 *
 * @property type - 固定为 "compaction"
 * @property removedCount - 被移除的记录数
 * @property tokensSaved - 预估节省的 token 数
 * @property summarized - 是否使用了 LLM 摘要（false 表示同步切割或摘要降级）
 */
export type SessionCompactionRecord = {
  type: 'compaction';
  sessionId: string;
  turn: number;
  removedCount: number;
  tokensSaved: number;
  summarized: boolean;
  timestamp: string;
};

/**
 * 会话记录（联合类型）
 *
 * 所有会话相关记录的总类型。使用可辨识联合模式，
 * 通过 type 字段区分不同类型的记录。
 *
 * 支持的记录类型：
 * - SessionStartRecord - 会话开始记录
 * - SessionMessageRecord - 消息记录
 * - SessionToolCallRecord - 工具调用记录
 * - SessionPermissionRecord - 权限决策记录
 * - SessionToolResultRecord - 工具结果记录
 * - SessionEndRecord - 会话结束记录
 *
 * @example
 * function saveRecord(record: SessionRecord) {
 *   switch (record.type) {
 *     case "session":
 *       console.log(`会话开始: ${record.sessionId}`);
 *       break;
 *     case "message":
 *       console.log(`${record.role}: ${record.content}`);
 *       break;
 *     // ... 其他类型
 *   }
 * }
 */
export type SessionRecord =
  | SessionStartRecord
  | SessionMessageRecord
  | SessionToolCallRecord
  | SessionPermissionRecord
  | SessionToolResultRecord
  | SessionUsageRecord
  | SessionCompactionRecord
  | SessionEndRecord;

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
