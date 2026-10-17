import { describe, expect, it } from "vitest";
import {
  WORKFLOW_ERROR_CODES,
  WORKFLOW_ERROR_MESSAGES,
  WorkflowError,
  getWorkflowErrorMessage,
  isWorkflowError,
  isWorkflowErrorCode,
} from "../errors.js";
import type { WorkflowErrorCode } from "../errors.js";

const EXPECTED_CODES: readonly WorkflowErrorCode[] = [
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
];

describe("workflow error codes", () => {
  it("exposes exactly the 10 contract codes", () => {
    expect([...WORKFLOW_ERROR_CODES].sort()).toEqual([...EXPECTED_CODES].sort());
    expect(WORKFLOW_ERROR_CODES).toHaveLength(10);
  });

  it("maps every code to a non-empty english message", () => {
    for (const code of EXPECTED_CODES) {
      const message = WORKFLOW_ERROR_MESSAGES[code];
      expect(typeof message).toBe("string");
      expect(message.trim().length).toBeGreaterThan(0);
      expect(getWorkflowErrorMessage(code)).toBe(message);
    }
  });

  it("WorkflowError carries code and defaults to mapped message", () => {
    const err = new WorkflowError("E_BUDGET_EXHAUSTED");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(WorkflowError);
    expect(err.code).toBe("E_BUDGET_EXHAUSTED");
    expect(err.message).toBe(WORKFLOW_ERROR_MESSAGES["E_BUDGET_EXHAUSTED"]);
    const custom = new WorkflowError("E_CONCURRENCY", "custom");
    expect(custom.message).toBe("custom");
  });
});

describe("isWorkflowError / isWorkflowErrorCode", () => {
  it("accepts class instances and plain { code } objects", () => {
    expect(isWorkflowError(new WorkflowError("E_SCHEMA_VALIDATE"))).toBe(true);
    expect(isWorkflowError({ code: "E_SPAWN_DEPTH" })).toBe(true);
    expect(
      isWorkflowError({ code: "E_SPAWN_DEPTH", message: "x" }),
    ).toBe(true);
  });

  it("rejects unknown codes and non-objects", () => {
    expect(isWorkflowError({ code: "E_NOPE" })).toBe(false);
    expect(isWorkflowError({})).toBe(false);
    expect(isWorkflowError(null)).toBe(false);
    expect(isWorkflowError(undefined)).toBe(false);
    expect(isWorkflowError("E_BUDGET_EXHAUSTED")).toBe(false);
    expect(isWorkflowError(42)).toBe(false);
    expect(isWorkflowErrorCode("E_PIPELINE_ALL_FAILED")).toBe(true);
    expect(isWorkflowErrorCode("E_UNKNOWN")).toBe(false);
    expect(isWorkflowErrorCode(null)).toBe(false);
  });
});
