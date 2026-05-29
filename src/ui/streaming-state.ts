import { t } from "../locales/index.js";

/**
 * 流式显示状态管理
 *
 * 提供 CLI 和 TUI 共用的流式状态逻辑。
 *
 * ## 状态说明
 *
 * - isThinking: 等待第一个 chunk 到达（思考中）
 * - isStreaming: 正在接收流式数据
 * - streamingContent: 已到达但未显示完成的内容
 * - streamingMessageId: 当前流式消息的临时 ID
 *
 * ## 状态转换
 *
 * session_started → isThinking = true, isStreaming = false
 * assistant_chunk (第一个) → isThinking = false, isStreaming = true
 * assistant_chunk (后续) → isStreaming = true, 累积 content
 * assistant_message → isStreaming = false, 清空 streamingContent
 */

/**
 * 流式显示状态
 */
export interface StreamingState {
  /** 是否正在等待第一个 chunk（思考中） */
  isThinking: boolean;
  /** 是否正在接收流式数据 */
  isStreaming: boolean;
  /** 已到达但未显示完成的内容 */
  streamingContent: string;
  /** 流式消息 ID */
  streamingMessageId: string | null;
}

/**
 * 流式状态管理器
 *
 * 管理流式显示的状态转换逻辑。
 */
export interface StreamingStateManager {
  /** 开始思考（等待第一个 chunk） */
  startThinking(): void;
  /** 收到 chunk */
  appendChunk(chunk: string, messageId: string): void;
  /** 流式结束 */
  finishStreaming(): { content: string; messageId: string | null };
  /** 获取当前状态 */
  getState(): StreamingState;
  /** 重置状态 */
  reset(): void;
}

/**
 * 创建流式状态管理器
 */
export function createStreamingStateManager(): StreamingStateManager {
  let state: StreamingState = {
    isThinking: false,
    isStreaming: false,
    streamingContent: "",
    streamingMessageId: null,
  };

  return {
    startThinking(): void {
      state = {
        isThinking: true,
        isStreaming: false,
        streamingContent: "",
        streamingMessageId: null,
      };
    },

    appendChunk(chunk: string, messageId: string): void {
      state = {
        isThinking: false,
        isStreaming: true,
        streamingContent: state.streamingContent + chunk,
        streamingMessageId: messageId,
      };
    },

    finishStreaming(): { content: string; messageId: string | null } {
      const result = {
        content: state.streamingContent,
        messageId: state.streamingMessageId,
      };
      state = {
        isThinking: false,
        isStreaming: false,
        streamingContent: "",
        streamingMessageId: null,
      };
      return result;
    },

    getState(): StreamingState {
      return { ...state };
    },

    reset(): void {
      state = {
        isThinking: false,
        isStreaming: false,
        streamingContent: "",
        streamingMessageId: null,
      };
    },
  };
}

/**
 * 获取显示状态文本
 *
 * 返回当前状态的文字描述，用于 UI 显示。
 */
export function getStreamingStatusText(state: StreamingState): string | null {
  if (state.isThinking) return t("ui.streaming.thinking");
  if (state.isStreaming) return t("ui.streaming.streaming");
  return null;
}

/**
 * 获取光标字符
 *
 * 只在流式过程中有内容时显示光标。
 */
export function getStreamingCursor(state: StreamingState): string {
  if (state.isStreaming && state.streamingContent.length > 0) {
    return "▌";
  }
  return "";
}
