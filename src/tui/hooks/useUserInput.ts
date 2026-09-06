/**
 * useUserInput - 用户输入处理 Hook
 *
 * 提供 sendMessage 方法，将用户输入发送到 runtime。
 */

import { useCallback, useRef } from 'react';
import type { Subject } from 'rxjs';
import type { ChatInputTurn } from '../types.js';

/**
 * useUserInput Hook
 *
 * @param input$ - 用户输入流 Subject
 * @returns sendMessage - 发送消息到 runtime 的方法
 */
export function useUserInput(input$: Subject<ChatInputTurn> | null): {
  sendMessage: (content: string) => void;
  /** 预览下一个 turn 编号（不推进计数器，供乐观回显拼消息 id 用） */
  peekTurn: () => number;
} {
  // Turn 计数器（从 1 开始）
  const turnRef = useRef(1);

  const peekTurn = useCallback(() => turnRef.current, []);

  const sendMessage = useCallback(
    (content: string) => {
      if (!input$) {
        console.error('Runtime not initialized, cannot send message');
        return;
      }

      if (!content.trim()) {
        return;
      }

      // 创建 ChatInputTurn 并发送
      const turn: ChatInputTurn = {
        turn: turnRef.current,
        content: content.trim(),
        source: 'interactive',
      };

      input$.next(turn);
      turnRef.current += 1;
    },
    [input$]
  );

  return { sendMessage, peekTurn };
}
