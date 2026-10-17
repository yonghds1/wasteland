export const WORKFLOW_ERROR_CODES = [
  "E_WORKFLOW_NOT_FOUND",
  "E_WORKFLOW_NESTED",
  "E_WORKFLOW_QUOTA_EXCEEDED",
  "E_WORKFLOW_ABORT_TIMEOUT",
  "E_PIPELINE_ALL_FAILED",
  "E_PARALLEL_FAIL_FAST",
  "E_SCHEMA_VALIDATE",
  "E_BUDGET_EXHAUSTED",
  "E_CONCURRENCY",
  "E_SPAWN_DEPTH",
] as const;

export type WorkflowErrorCode = (typeof WORKFLOW_ERROR_CODES)[number];

export const WORKFLOW_ERROR_MESSAGES: Record<WorkflowErrorCode, string> = {
  E_WORKFLOW_NOT_FOUND: "Workflow not found.",
  E_WORKFLOW_NESTED: "Nested workflow execution is not allowed.",
  E_WORKFLOW_QUOTA_EXCEEDED: "Workflow quota exceeded.",
  E_WORKFLOW_ABORT_TIMEOUT: "Workflow abort timed out.",
  E_PIPELINE_ALL_FAILED: "All pipeline branches failed.",
  E_PARALLEL_FAIL_FAST: "Parallel execution stopped by fail-fast.",
  E_SCHEMA_VALIDATE: "Schema validation failed.",
  E_BUDGET_EXHAUSTED: "Budget exhausted.",
  E_CONCURRENCY: "Concurrency limit exceeded.",
  E_SPAWN_DEPTH: "Max spawn depth exceeded.",
};

const WORKFLOW_ERROR_CODE_SET: ReadonlySet<string> = new Set<string>(
  WORKFLOW_ERROR_CODES,
);

export interface WorkflowErrorLike {
  code: WorkflowErrorCode;
  message?: string;
}

export function getWorkflowErrorMessage(code: WorkflowErrorCode): string {
  return WORKFLOW_ERROR_MESSAGES[code];
}

export class WorkflowError extends Error {
  readonly code: WorkflowErrorCode;

  constructor(
    code: WorkflowErrorCode,
    message?: string,
    options?: ErrorOptions,
  ) {
    super(message ?? WORKFLOW_ERROR_MESSAGES[code], options);
    this.name = "WorkflowError";
    this.code = code;
    Object.setPrototypeOf(this, WorkflowError.prototype);
  }

  toJSON(): { name: string; code: WorkflowErrorCode; message: string } {
    return { name: this.name, code: this.code, message: this.message };
  }
}

export function isWorkflowErrorCode(value: unknown): value is WorkflowErrorCode {
  return typeof value === "string" && WORKFLOW_ERROR_CODE_SET.has(value);
}

export function isWorkflowError(
  value: unknown,
): value is WorkflowError | WorkflowErrorLike {
  if (value instanceof WorkflowError) return true;
  if (typeof value !== "object" || value === null) return false;
  if (!("code" in value)) return false;
  const code = (value as Record<string, unknown>)["code"];
  return isWorkflowErrorCode(code);
}

export const E_WORKFLOW_NOT_FOUND: WorkflowErrorCode = "E_WORKFLOW_NOT_FOUND";
export const E_WORKFLOW_NESTED: WorkflowErrorCode = "E_WORKFLOW_NESTED";
export const E_WORKFLOW_QUOTA_EXCEEDED: WorkflowErrorCode = "E_WORKFLOW_QUOTA_EXCEEDED";
export const E_WORKFLOW_ABORT_TIMEOUT: WorkflowErrorCode = "E_WORKFLOW_ABORT_TIMEOUT";
export const E_PIPELINE_ALL_FAILED: WorkflowErrorCode = "E_PIPELINE_ALL_FAILED";
export const E_PARALLEL_FAIL_FAST: WorkflowErrorCode = "E_PARALLEL_FAIL_FAST";
export const E_SCHEMA_VALIDATE: WorkflowErrorCode = "E_SCHEMA_VALIDATE";
export const E_BUDGET_EXHAUSTED: WorkflowErrorCode = "E_BUDGET_EXHAUSTED";
export const E_CONCURRENCY: WorkflowErrorCode = "E_CONCURRENCY";
export const E_SPAWN_DEPTH: WorkflowErrorCode = "E_SPAWN_DEPTH";
