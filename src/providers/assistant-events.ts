import { concat, from, map, of, type Observable } from "rxjs";

import { splitReplyText } from "../chat/reply-pipeline.js";
import type { ProviderStreamEvent } from "./provider-types.js";

export function createAssistantTextEvents(text: string): Observable<ProviderStreamEvent> {
  return concat(
    from(splitReplyText(text)).pipe(
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
