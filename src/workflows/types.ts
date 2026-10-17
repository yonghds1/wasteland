import { z } from "zod";

export const RUN_STATUSES = [
  "running",
  "done",
  "interrupted",
  "failed",
  "cancelled",
] as const;
export const runStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const JOURNAL_EVENTS = [
  "agent_start",
  "agent_end",
  "progress",
  "error",
  "done",
  "cancelled",
  "phase",
  "log",
] as const;
export const journalEventSchema = z.enum(JOURNAL_EVENTS);
export type JournalEvent = z.infer<typeof journalEventSchema>;

export const FINAL_STATE_STATUSES = [
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
] as const;
export const finalStateStatusSchema = z.enum(FINAL_STATE_STATUSES);
export type FinalStateStatus = z.infer<typeof finalStateStatusSchema>;

export const SUBMIT_NAME_PATTERN = /^[a-z0-9-]{1,64}$/;
export const SUBMIT_SCRIPT_MAX = 8192;
export const SUBMIT_ARGS_MAX = 20;
export const SUBMIT_ARG_MAX = 1024;

export const submitArgsSchema = z.array(z.string().max(SUBMIT_ARG_MAX)).max(SUBMIT_ARGS_MAX);

export const submitInputSchema = z
  .object({
    name: z.string().regex(SUBMIT_NAME_PATTERN),
    script: z.string().min(1).max(SUBMIT_SCRIPT_MAX).optional(),
    scriptPath: z.string().min(1).max(1024).optional(),
    args: submitArgsSchema.optional(),
    resumeFromRunId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasScript = val.script !== undefined;
    const hasPath = val.scriptPath !== undefined;
    if (hasScript === hasPath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Exactly one of 'script' and 'scriptPath' must be provided.",
        path: ["script"],
      });
    }
  });
export type SubmitInput = z.infer<typeof submitInputSchema>;

export const journalUsageSchema = z
  .object({
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
  })
  .strict();
export type JournalUsage = z.infer<typeof journalUsageSchema>;

export const journalEntrySchema = z
  .object({
    seq: z.number().int().min(0),
    ts: z.string().datetime(),
    runId: z.string().min(1),
    agentId: z.string().min(1).optional(),
    event: journalEventSchema,
    promptHash: z.string().min(1).optional(),
    codeVersion: z.string().min(1).optional(),
    resultRef: z.string().min(1).optional(),
    cached: z.boolean().optional(),
    usage: journalUsageSchema.optional(),
    status: z.string().min(1).optional(),
    message: z.string().optional(),
  })
  .strict();
export type JournalEntry = z.infer<typeof journalEntrySchema>;

export const finalStateSchema = z
  .object({
    runId: z.string().min(1),
    workflowName: z.string().regex(SUBMIT_NAME_PATTERN),
    codeVersion: z.string().min(1).max(128),
    status: finalStateStatusSchema,
    outputs: z.record(z.string(), z.string()),
    result: z.unknown().optional(),
    usageTotal: journalUsageSchema,
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    resumeFromRunId: z.string().uuid().optional(),
  })
  .strict();
export type FinalState = z.infer<typeof finalStateSchema>;
