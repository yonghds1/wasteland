import { concat, from, map, of, concatMap, delay, type Observable } from "rxjs";

import { splitReplyText } from "../chat/reply-pipeline.js";
import type { ProviderStreamEvent } from "./provider-types.js";

/**
 * 打字机效果延迟（毫秒）
 * 每个 chunk 延迟此毫秒数发送，实现打字机效果
 * 设置为 0 禁用
 */
let TYPEWRITER_DELAY_MS = 10;

/**
 * 创建助手文本事件流
 *
 * 发送 assistant_chunk 事件（逐字符）+ 最终的 assistant_message 事件。
 *
 * ## 打字机效果
 *
 * 当 TYPEWRITER_DELAY_MS > 0 时，每个 chunk 延迟指定毫秒发送，
 * 实现真正的打字机效果。但这会显著增加响应时间。
 *
 * 默认设置为 0（禁用），因为：
 * - CLI: stdout.write 直接输出，无需延迟
 * - TUI: 使用定时器批量渲染，已实现视觉效果
 */
export function createAssistantTextEvents(text: string): Observable<ProviderStreamEvent> {
  const chunks = splitReplyText(text);

  // 如果禁用打字机效果，直接同步发送
  if (TYPEWRITER_DELAY_MS === 0) {
    return concat(
      from(chunks).pipe(
        map(
          (chunk): ProviderStreamEvent => ({
            type: "assistant_chunk",
            text: chunk,
          }),
        ),
      ),
      of<ProviderStreamEvent>({
        type: "assistant_message",
        text,
      }),
    );
  }

  // 启用打字机效果：每个 chunk 延迟发送
  return concat(
    from(chunks).pipe(
      concatMap((chunk) =>
        of<ProviderStreamEvent>({
          type: "assistant_chunk",
          text: chunk,
        }).pipe(delay(TYPEWRITER_DELAY_MS))
      ),
    ),
    of<ProviderStreamEvent>({
      type: "assistant_message",
      text,
    }),
  );
}
