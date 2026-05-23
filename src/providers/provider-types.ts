import type { Observable } from "rxjs";

import type { TurnContext } from "../runtime/turn-context.js";
import type { TurnState } from "../runtime/turn-state.js";
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

export type ProviderStepInput = {
  context: TurnContext;
  state: TurnState;
};

export interface AgentProvider {
  readonly id: string;
  runStep(input: ProviderStepInput): Observable<ProviderStreamEvent>;
}
