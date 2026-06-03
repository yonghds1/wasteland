/**
 * output-adapter.ts - 输出适配器接口
 *
 * 定义 DisplayEvent 类型和 OutputAdapter 接口，用于抽象 CLI 和 TUI 的输出差异。
 * DisplayEvent 是 RuntimeEvent 的 1:1 映射，保持事件级转换的简单性。
 */

import type { RuntimeEvent, InputSource, RuntimeMode } from '../runtime/event-types.js';
import type { PermissionDecisionKind, PermissionMode } from '../runtime/permission-gate.js';
import type { SkillArgs, SkillResult } from '../../skills/skill-types.js';

// ============================================================
// DisplayEvent Types
// ============================================================

/**
 * 显示事件（可辨识联合类型）
 *
 * RuntimeEvent 的 1:1 映射，用于 UI 渲染。
 * 每个 RuntimeEvent 类型都有对应的 DisplayEvent 类型，包含所有原始字段。
 */
export type DisplayEvent =
  | {
      /** 会话开始 */
      type: 'session_started';
      sessionId: string;
      sessionPath: string;
      mode: RuntimeMode;
    }
  | {
      /** 用户输入 */
      type: 'user_turn';
      sessionId: string;
      turn: number;
      content: string;
      source: InputSource;
    }
  | {
      /** AI 响应片段（流式输出） */
      type: 'assistant_chunk';
      sessionId: string;
      turn: number;
      chunk: string;
    }
  | {
      /** AI 响应完成 */
      type: 'assistant_message';
      sessionId: string;
      turn: number;
      content: string;
    }
  | {
      /** 工具调用请求 */
      type: 'tool_call_requested';
      sessionId: string;
      turn: number;
      callId: string;
      toolName: string;
    }
  | {
      /** 权限决策 */
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
      /** 工具开始执行 */
      type: 'tool_started';
      sessionId: string;
      turn: number;
      callId: string;
      toolName: string;
    }
  | {
      /** 工具执行成功 */
      type: 'tool_result';
      sessionId: string;
      turn: number;
      callId: string;
      toolName: string;
      output: string;
    }
  | {
      /** 工具执行失败 */
      type: 'tool_failed';
      sessionId: string;
      turn: number;
      callId: string;
      toolName: string;
      error: string;
    }
  | {
      /** 子 Agent 创建 */
      type: 'agent_spawned';
      parentId: string;
      childId: string;
      childSessionPath: string;
      name: string;
      task: string;
    }
  | {
      /** 子 Agent 完成 */
      type: 'agent_completed';
      childId: string;
      status: 'success' | 'error' | 'timeout';
      result?: string;
      error?: string;
      sessionPath: string;
    }
  | {
      /** 技能调用开始 */
      type: 'skill_started';
      sessionId: string;
      turn: number;
      skillName: string;
      args: SkillArgs;
    }
  | {
      /** 技能执行结果 */
      type: 'skill_result';
      sessionId: string;
      turn: number;
      skillName: string;
      result: SkillResult;
    }
  | {
      /** 会话结束 */
      type: 'session_ended';
      sessionId: string;
    }
  | {
      /** 用户输入请求（ask-user 工具触发） */
      type: 'user_input_requested';
      sessionId: string;
      turn: number;
      callId: string;
      question: string;
      options?: string[];
    }
  | {
      /** 用户输入响应（用户回答后触发） */
      type: 'user_input_received';
      sessionId: string;
      turn: number;
      callId: string;
      answer: string;
    };

// ============================================================
// OutputAdapter Interface
// ============================================================

/**
 * 输出适配器接口
 *
 * 将 RuntimeEvent 转换为 DisplayEvent。
 * CLI 和 TUI 各自实现此接口，但转换逻辑相同（1:1 映射）。
 */
export interface OutputAdapter {
  /**
   * 处理运行时事件，返回显示事件
   *
   * @param event - 运行时事件
   * @returns 显示事件
   */
  processEvent(event: RuntimeEvent): DisplayEvent;
}

// ============================================================
// Default Implementation
// ============================================================

/**
 * 默认输出适配器
 *
 * 实现 RuntimeEvent 到 DisplayEvent 的 1:1 映射。
 * 这是纯函数转换，没有副作用。
 */
export class DefaultOutputAdapter implements OutputAdapter {
  /**
   * 处理运行时事件，返回显示事件
   */
  processEvent(event: RuntimeEvent): DisplayEvent {
    switch (event.type) {
      case 'session_started':
        return {
          type: 'session_started',
          sessionId: event.sessionId,
          sessionPath: event.sessionPath,
          mode: event.mode,
        };

      case 'user_turn':
        return {
          type: 'user_turn',
          sessionId: event.sessionId,
          turn: event.turn,
          content: event.content,
          source: event.source,
        };

      case 'assistant_chunk':
        return {
          type: 'assistant_chunk',
          sessionId: event.sessionId,
          turn: event.turn,
          chunk: event.chunk,
        };

      case 'assistant_message':
        return {
          type: 'assistant_message',
          sessionId: event.sessionId,
          turn: event.turn,
          content: event.content,
        };

      case 'tool_call_requested':
        return {
          type: 'tool_call_requested',
          sessionId: event.sessionId,
          turn: event.turn,
          callId: event.callId,
          toolName: event.toolName,
        };

      case 'permission_decision':
        return {
          type: 'permission_decision',
          sessionId: event.sessionId,
          turn: event.turn,
          callId: event.callId,
          toolName: event.toolName,
          decision: event.decision,
          mode: event.mode,
          reason: event.reason,
        };

      case 'tool_started':
        return {
          type: 'tool_started',
          sessionId: event.sessionId,
          turn: event.turn,
          callId: event.callId,
          toolName: event.toolName,
        };

      case 'tool_result':
        return {
          type: 'tool_result',
          sessionId: event.sessionId,
          turn: event.turn,
          callId: event.callId,
          toolName: event.toolName,
          output: event.output,
        };

      case 'tool_failed':
        return {
          type: 'tool_failed',
          sessionId: event.sessionId,
          turn: event.turn,
          callId: event.callId,
          toolName: event.toolName,
          error: event.error,
        };

      case 'agent_spawned':
        return {
          type: 'agent_spawned',
          parentId: event.parentId,
          childId: event.childId,
          childSessionPath: event.childSessionPath,
          name: event.name,
          task: event.task,
        };

      case 'agent_completed':
        return {
          type: 'agent_completed',
          childId: event.childId,
          status: event.status,
          result: event.result,
          error: event.error,
          sessionPath: event.sessionPath,
        };

      case 'skill_started':
        return {
          type: 'skill_started',
          sessionId: event.sessionId,
          turn: event.turn,
          skillName: event.skillName,
          args: event.args,
        };

      case 'skill_result':
        return {
          type: 'skill_result',
          sessionId: event.sessionId,
          turn: event.turn,
          skillName: event.skillName,
          result: event.result,
        };

      case 'session_ended':
        return {
          type: 'session_ended',
          sessionId: event.sessionId,
        };

      case 'user_input_requested':
        return {
          type: 'user_input_requested',
          sessionId: event.sessionId,
          turn: event.turn,
          callId: event.callId,
          question: event.question,
          options: event.options,
        };

      case 'user_input_received':
        return {
          type: 'user_input_received',
          sessionId: event.sessionId,
          turn: event.turn,
          callId: event.callId,
          answer: event.answer,
        };

      default: {
        // 穷举检查
        const _exhaustive: never = event;
        throw new Error(`Unhandled event type: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }
}
