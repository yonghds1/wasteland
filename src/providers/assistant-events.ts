import { concat, from, map, of, type Observable } from 'rxjs';

import { splitReplyText } from '../chat/reply-pipeline.js';
import type { ProviderStreamEvent } from './provider-types.js';

/**
 * 创建助手文本事件流
 *
 * 发送 assistant_chunk 事件（逐字符）+ 最终的 assistant_message 事件。
 *
 * ## 打字机效果
 *
 * Provider 层不实现打字机效果，直接发送 chunk。
 * 打字机效果由 UI 层实现：
 * - CLI: stdout.write 直接输出，数据到达即显示
 * - TUI: React 状态更新触发渲染，数据到达即显示
 *
 * 这样保持了数据层的纯粹性，UI 层负责显示效果。
 */
export function createAssistantTextEvents(text: string): Observable<ProviderStreamEvent> {
  const chunks = splitReplyText(text);

  return concat(
    from(chunks).pipe(
      map(
        (chunk): ProviderStreamEvent => ({
          type: 'assistant_chunk',
          text: chunk,
        })
      )
    ),
    of<ProviderStreamEvent>({
      type: 'assistant_message',
      text,
    })
  );
}
