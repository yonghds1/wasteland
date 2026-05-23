export type ToolRiskLevel = "read" | "write" | "execute";

export type ToolInput = Record<string, unknown>;

export type ToolCall = {
  id: string;
  toolName: string;
  input: ToolInput;
};

export type ToolExecutionContext = {
  sessionId: string;
  turn: number;
  cwd: string;
};

export type ToolSuccessResult = {
  status: "success";
  output: string;
  data?: unknown;
};

export type ToolErrorResult = {
  status: "error";
  error: string;
  data?: unknown;
};

export type ToolExecutionResult = ToolSuccessResult | ToolErrorResult;

export interface AgentTool {
  readonly name: string;
  readonly riskLevel: ToolRiskLevel;
  execute(input: ToolInput, context: ToolExecutionContext): Promise<ToolExecutionResult>;
}
