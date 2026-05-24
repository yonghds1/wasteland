import type { PermissionDecisionKind, PermissionMode } from "./permission-gate.js";
import type { ToolInput, ToolRunStatus } from "../tools/tool-types.js";

/**
 * 输入来源
 *
 * 标识用户输入的来源渠道：
 * - "message": 命令行 --message 参数传入的单条消息
 * - "stdin": 通过标准输入管道传入
 * - "interactive": 交互式对话中用户主动输入
 */
export type InputSource = "message" | "stdin" | "interactive";

/**
 * 运行时模式
 *
 * - "single": 单次执行模式，处理一条消息后退出
 * - "interactive": 交互模式，持续等待用户输入
 */
export type RuntimeMode = "single" | "interactive";

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
  type: "message";
  role: "user" | "assistant";
  turn: number;
  content: string;
  timestamp: string;
  source?: InputSource;
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
  type: "tool_call";
  sessionId: string;
  turn: number;
  callId: string;
  toolName: string;
  input: ToolInput;
  timestamp: string;
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
  type: "permission";
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
  type: "tool_result";
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
 * 会话记录（联合类型）
 *
 * 所有会话相关记录的总类型。使用可辨识联合模式，
 * 通过 type 字段区分不同类型的记录。
 *
 * 支持的记录类型：
 * - { type: "session" } - 会话开始记录
 * - SessionMessageRecord - 消息记录
 * - SessionToolCallRecord - 工具调用记录
 * - SessionPermissionRecord - 权限决策记录
 * - SessionToolResultRecord - 工具结果记录
 * - { type: "session_end" } - 会话结束记录
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
  | {
      type: "session";
      sessionId: string;
      mode: RuntimeMode;
      cwd: string;
      provider: string;
      timestamp: string;
    }
  | SessionMessageRecord
  | SessionToolCallRecord
  | SessionPermissionRecord
  | SessionToolResultRecord
  | {
      type: "session_end";
      sessionId: string;
      timestamp: string;
    };

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
      type: "session_started";
      sessionId: string;
      sessionPath: string;
      mode: RuntimeMode;
    }
  | {
      /** 用户输入事件 */
      type: "user_turn";
      sessionId: string;
      turn: number;
      content: string;
      source: InputSource;
    }
  | {
      /** AI 响应片段事件（流式输出） */
      type: "assistant_chunk";
      sessionId: string;
      turn: number;
      chunk: string;
    }
  | {
      /** AI 响应完成事件 */
      type: "assistant_message";
      sessionId: string;
      turn: number;
      content: string;
    }
  | {
      /** 工具调用请求事件 */
      type: "tool_call_requested";
      sessionId: string;
      turn: number;
      callId: string;
      toolName: string;
      input: ToolInput;
    }
  | {
      /** 权限决策事件 */
      type: "permission_decision";
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
      type: "tool_started";
      sessionId: string;
      turn: number;
      callId: string;
      toolName: string;
    }
  | {
      /** 工具执行成功事件 */
      type: "tool_result";
      sessionId: string;
      turn: number;
      callId: string;
      toolName: string;
      status: "success";
      output: string;
    }
  | {
      /** 工具执行失败事件 */
      type: "tool_failed";
      sessionId: string;
      turn: number;
      callId: string;
      toolName: string;
      status: Exclude<ToolRunStatus, "success">;
      error: string;
    }
  | {
      /** 会话结束事件 */
      type: "session_ended";
      sessionId: string;
    }
  | {
      /** 子 Agent 创建事件 */
      type: "agent_spawned";
      parentId: string;
      childId: string;
      childSessionPath: string;
      name: string;
      task: string;
    }
  | {
      /** 子 Agent 完成事件 */
      type: "agent_completed";
      childId: string;
      status: "success" | "error" | "timeout";
      result?: string;
      error?: string;
      sessionPath: string;
    };
