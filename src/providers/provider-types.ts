import type { Observable } from "rxjs";

import type { TurnContext } from "../runtime/turn-context.js";
import type { ToolCall } from "../tools/tool-types.js";

export type ProviderStreamEvent =
  | {
      type: "assistant_chunk";
      text: string;
    }
  | {
      type: "tool_call";
      call: ToolCall;
    }
  | {
      type: "assistant_message";
      text: string;
    };

export interface AgentProvider {
  readonly id: string;
  streamReply(context: TurnContext): Observable<ProviderStreamEvent>;
}
