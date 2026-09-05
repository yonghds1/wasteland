/**
 * readline-input.ts - 单次输入模式
 *
 * 提供非交互模式下的输入处理：
 * - createSingleTurnInput: 创建单次输入流（命令行参数或管道）
 * - readPipedInput: 读取管道输入
 */

import type { Readable } from 'node:stream';

import { of, type Observable } from 'rxjs';

import type { ChatInputTurn } from '@core/runtime/event-types.js';

/**
 * 创建单次输入的 Observable
 *
 * 用于非交互模式：
 * - 命令行参数模式 (--message)
 * - 管道输入模式 (stdin pipe)
 *
 * @param message - 用户消息
 * @param source - 输入来源
 * @returns 发出单个 ChatInputTurn 的 Observable
 *
 * @example
 * // 命令行参数
 * const turns$ = createSingleTurnInput("Hello", "message");
 *
 * // 管道输入
 * const turns$ = createSingleTurnInput(pipedContent, "stdin");
 */
export function createSingleTurnInput(
  message: string,
  source: 'message' | 'stdin'
): Observable<ChatInputTurn> {
  // of: 直接发出单个元素（比 from([x]) 更直接，语义等价）
  return of({
    turn: 1,
    content: message.trim(),
    source,
  } satisfies ChatInputTurn);
}

/**
 * 读取管道输入
 *
 * 检测 stdin 是否为 TTY。如果不是 TTY，说明有管道输入。
 *
 * @param stdin - 标准输入流
 * @returns 管道内容，或 null（如果是 TTY）
 *
 * @example
 * // 使用方式
 * // echo "Hello" | rxc chat
 * const pipedContent = await readPipedInput();
 */
export async function readPipedInput(stdin: Readable = process.stdin): Promise<string | null> {
  // TTY 检测：如果 stdin.isTTY 为 true，说明是交互式终端
  // 管道输入时，isTTY 为 undefined 或 false
  if ('isTTY' in stdin && stdin.isTTY) {
    return null;
  }

  // 异步迭代读取所有 chunk
  let content = '';

  for await (const chunk of stdin) {
    content += chunk.toString();
  }

  const trimmed = content.trim();

  return trimmed.length > 0 ? trimmed : null;
}