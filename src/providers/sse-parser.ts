/**
 * sse-parser.ts - Server-Sent Events (SSE) 流解析工具
 *
 * 将 HTTP streaming 响应体解析为结构化的 SSE 事件。
 * 支持 OpenAI 和 Claude 两种 SSE 格式。
 *
 * ## SSE 格式
 *
 * ```
 * data: {"id":"...","choices":[...]}\n
 * \n
 * data: {"id":"...","choices":[...]}\n
 * \n
 * data: [DONE]\n
 * \n
 * ```
 */

import { Observable } from 'rxjs';

/**
 * 单个 SSE 事件（去掉 "data: " 前缀后的 JSON 字符串）
 */
export type SSEEvent = string;

/**
 * 解析 SSE 流为 Observable<SSEEvent>
 *
 * @param reader - ReadableStreamDefaultReader，来自 fetch 响应
 * @returns Observable，每个元素是一个 SSE 事件的 JSON 字符串
 */
export function parseSSEStream(reader: ReadableStreamDefaultReader<Uint8Array>): Observable<SSEEvent> {
  return new Observable<SSEEvent>((subscriber) => {
    const decoder = new TextDecoder();
    const bufferParts: string[] = [];
    let bufferLength = 0;

    async function readStream() {
      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            // 流结束，处理 buffer 中剩余的数据
            const remaining = bufferParts.join('');
            if (remaining.trim()) {
              processBuffer(remaining, subscriber);
            }
            subscriber.complete();
            return;
          }

          // 解码 Uint8Array 并追加到 buffer
          const decoded = decoder.decode(value, { stream: true });
          bufferParts.push(decoded);
          bufferLength += decoded.length;

          // 当 buffer 足够大时才处理，减少 split 操作
          if (bufferLength > 8192) {
            const fullBuffer = bufferParts.join('');
            bufferParts.length = 0;
            bufferLength = 0;

            // 按 \n\n 分割为独立的 SSE 事件
            const parts = fullBuffer.split('\n\n');

            // 最后一个部分可能不完整，保留在 buffer 中
            const lastPart = parts.pop() ?? '';
            if (lastPart) {
              bufferParts.push(lastPart);
              bufferLength = lastPart.length;
            }

            // 处理完整的事件
            for (const part of parts) {
              processPart(part, subscriber);
            }
          }
        }
      } catch (err) {
        subscriber.error(err);
      }
    }

    readStream();

    // 清理函数
    return () => {
      reader.cancel().catch(() => {});
    };
  });
}

/**
 * 处理一个完整的 SSE 事件部分（可能包含多行 "data: "）
 */
function processPart(part: string, subscriber: { next: (value: SSEEvent) => void }) {
  const lines = part.split('\n');
  const dataLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // 跳过空行、注释行和非 data 行
    if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) {
      continue;
    }

    // 提取 "data: " 后面的内容
    const data = trimmed.slice(5).trim();
    dataLines.push(data);
  }

  if (dataLines.length > 0) {
    // 合并多行 data（某些 SSE 实现可能拆分 JSON）
    const fullData = dataLines.join('\n');

    // 跳过 OpenAI 的 [DONE] 标记（由调用者处理）
    if (fullData === '[DONE]') {
      return;
    }

    subscriber.next(fullData);
  }
}

/**
 * 处理 buffer 中残留的数据
 */
function processBuffer(buffer: string, subscriber: { next: (value: SSEEvent) => void }) {
  const trimmed = buffer.trim();
  if (!trimmed) return;

  // 如果是完整的 SSE 事件，直接处理
  if (trimmed.includes('\n\n')) {
    const parts = trimmed.split('\n\n');
    for (const part of parts) {
      if (part.trim()) {
        processPart(part, subscriber);
      }
    }
  } else {
    // 可能是一个不完整的事件，尝试处理
    processPart(trimmed, subscriber);
  }
}

/**
 * 检查 SSE 流是否结束（OpenAI 使用 "data: [DONE]"）
 */
export function isStreamDone(data: string): boolean {
  return data === '[DONE]';
}
