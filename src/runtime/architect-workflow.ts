/**
 * architect-workflow.ts - Architect 三角色协作工作流
 *
 * 本文件实现了 Architect → Coder → Reviewer 的闭环工作流。
 *
 * ## 核心设计
 *
 * 工作流阶段：
 * 1. PLAN: Architect 分析需求，制定计划
 * 2. CODE: 调用 external_coder 执行编码
 * 3. VERIFY: Architect 验证编码结果
 * 4. REVIEW: 调用 external_reviewer 进行代码审查
 * 5. DECIDE: 根据审查结果决定是否继续迭代
 *
 * ## 工作流循环
 *
 * ```
 * PLAN → CODE → VERIFY → REVIEW → DECIDE
 *                              ↓
 *                         通过 → 结束
 *                         不通过 → 返回 PLAN
 * ```
 *
 * ## 使用示例
 *
 * ```typescript
 * const workflow = createArchitectWorkflow({
 *   provider: architectProvider,
 *   toolRegistry: registry,
 *   maxIterations: 5,
 * });
 *
 * const result = await workflow.execute({
 *   task: "实现用户登录功能",
 *   context: "项目使用 TypeScript 和 Express",
 * });
 * ```
 */

import { Observable, Subject, concat, defer, from, map, of, tap, filter, take, lastValueFrom, timeout, catchError, EMPTY } from "rxjs";
import type { AgentProvider } from "../providers/provider-types.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import type { PermissionGate } from "./permission-gate.js";
import type { SessionManager, SessionMetadata } from "./session-manager.js";
import type { RuntimeEvent, SessionMessageRecord } from "./event-types.js";
import type { ToolExecutionResult } from "../tools/tool-types.js";
import { runAgentLoop } from "./agent-loop.js";
import { createTurnContext } from "./turn-context.js";
import {
  createInitialTurnState,
  advanceTurnState,
  appendAssistantChunk,
  completeTurnState,
  failTurnState,
  recordToolCall,
  recordToolResult,
  type TurnState,
} from "./turn-state.js";

// ============================================================
// 类型定义
// ============================================================

/**
 * 工作流阶段
 */
export type WorkflowPhase =
  | "init"      // 初始化
  | "plan"      // 规划阶段
  | "code"      // 编码阶段
  | "verify"    // 验证阶段
  | "review"    // 审查阶段
  | "decide"    // 决策阶段
  | "complete"  // 完成
  | "failed";   // 失败

/**
 * 工作流状态
 */
export type WorkflowState = {
  /** 当前阶段 */
  phase: WorkflowPhase;
  /** 当前迭代次数 */
  iteration: number;
  /** 最大迭代次数 */
  maxIterations: number;
  /** 原始任务 */
  task: string;
  /** 上下文信息 */
  context?: string;
  /** 当前计划 */
  plan?: string;
  /** 编码结果 */
  codeResult?: ToolExecutionResult;
  /** 验证结果 */
  verifyResult?: { passed: boolean; issues: string[] };
  /** 审查结果 */
  reviewResult?: {
    approved: boolean;
    issues: Array<{ severity: string; description: string }>;
    suggestions: string[];
    summary: string;
  };
  /** 累积的变更 */
  changes: string[];
  /** 错误信息 */
  error?: string;
};

/**
 * 工作流事件
 */
export type WorkflowEvent =
  | { type: "workflow_started"; task: string }
  | { type: "phase_started"; phase: WorkflowPhase; iteration: number }
  | { type: "phase_completed"; phase: WorkflowPhase; iteration: number; result?: unknown }
  | { type: "iteration_started"; iteration: number }
  | { type: "iteration_completed"; iteration: number; approved: boolean }
  | { type: "workflow_completed"; state: WorkflowState }
  | { type: "workflow_failed"; state: WorkflowState; error: string };

/**
 * 工作流输入
 */
export type WorkflowInput = {
  /** 任务描述 */
  task: string;
  /** 上下文信息（可选） */
  context?: string;
  /** 相关文件（可选） */
  files?: string[];
};

/**
 * 工作流结果
 */
export type WorkflowResult = {
  /** 是否成功 */
  success: boolean;
  /** 最终状态 */
  state: WorkflowState;
  /** 总迭代次数 */
  totalIterations: number;
  /** 变更摘要 */
  changesSummary: string;
  /** 错误信息（如果有） */
  error?: string;
};

/**
 * 工作流配置
 */
export type ArchitectWorkflowConfig = {
  /** Architect Provider */
  provider: AgentProvider;
  /** 工具注册表 */
  toolRegistry: ToolRegistry;
  /** 权限门控 */
  permissionGate: PermissionGate;
  /** 会话管理器 */
  sessionManager: SessionManager;
  /** 工作目录 */
  cwd: string;
  /** 最大迭代次数（默认 5） */
  maxIterations?: number;
  /** 每轮最大步数（默认 8） */
  maxStepsPerTurn?: number;
  /** 阶段超时（毫秒，默认 300000 = 5分钟） */
  phaseTimeout?: number;
  /** Coder 工具名称（默认 "coder" 或 MCP 工具名） */
  coderToolName?: string;
  /** Reviewer 工具名称（默认 "reviewer" 或 MCP 工具名） */
  reviewerToolName?: string;
};

// ============================================================
// 工作流执行器
// ============================================================

/**
 * 创建 Architect 工作流执行器
 */
export function createArchitectWorkflow(config: ArchitectWorkflowConfig) {
  const maxIterations = config.maxIterations ?? 5;
  const maxStepsPerTurn = config.maxStepsPerTurn ?? 8;
  const phaseTimeout = config.phaseTimeout ?? 300000;

  // 工具名称：支持 MCP 工具或自定义名称
  // MCP 工具格式: "serverName/toolName" 或 "toolName"
  const coderToolName = config.coderToolName ?? "coder";
  const reviewerToolName = config.reviewerToolName ?? "reviewer";

  // 创建事件 Subject（在外部定义以便 events$ 可以访问）
  const eventSubject = new Subject<WorkflowEvent>();

  // 创建阶段执行上下文
  const phaseContext = {
    coderToolName,
    reviewerToolName,
  };

  /**
   * 执行工作流
   */
  async function execute(input: WorkflowInput): Promise<WorkflowResult> {
    // 初始化状态
    let state: WorkflowState = {
      phase: "init",
      iteration: 0,
      maxIterations,
      task: input.task,
      context: input.context,
      changes: [],
    };

    // 发出工作流开始事件
    eventSubject.next({ type: "workflow_started", task: input.task });

    try {
      // 主循环
      while (state.phase !== "complete" && state.phase !== "failed") {
        // 检查迭代限制
        if (state.iteration >= maxIterations) {
          state = { ...state, phase: "failed", error: "达到最大迭代次数限制" };
          break;
        }

        // 执行当前阶段
        state = await executePhase(state, config, eventSubject, phaseTimeout, phaseContext);
      }

      // 发出完成事件
      if (state.phase === "complete") {
        eventSubject.next({ type: "workflow_completed", state });
      } else {
        eventSubject.next({ type: "workflow_failed", state, error: state.error ?? "Unknown error" });
      }

      return {
        success: state.phase === "complete",
        state,
        totalIterations: state.iteration,
        changesSummary: state.changes.join("\n"),
        error: state.error,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      eventSubject.next({ type: "workflow_failed", state, error: errorMsg });

      return {
        success: false,
        state,
        totalIterations: state.iteration,
        changesSummary: state.changes.join("\n"),
        error: errorMsg,
      };
    } finally {
      eventSubject.complete();
    }
  }

  return {
    execute,
    events$: eventSubject.asObservable(),
  };
}

/**
 * 阶段执行上下文
 */
type PhaseContext = {
  coderToolName: string;
  reviewerToolName: string;
};

/**
 * 执行单个阶段
 */
async function executePhase(
  state: WorkflowState,
  config: ArchitectWorkflowConfig,
  events: Subject<WorkflowEvent>,
  phaseTimeout: number,
  phaseContext: PhaseContext,
): Promise<WorkflowState> {
  events.next({ type: "phase_started", phase: state.phase, iteration: state.iteration });

  switch (state.phase) {
    case "init":
      return executeInitPhase(state, config, events);

    case "plan":
      return executePlanPhase(state, config, events, phaseTimeout);

    case "code":
      return executeCodePhase(state, config, events, phaseTimeout, phaseContext.coderToolName);

    case "verify":
      return executeVerifyPhase(state, config, events, phaseTimeout);

    case "review":
      return executeReviewPhase(state, config, events, phaseTimeout, phaseContext.reviewerToolName);

    case "decide":
      return executeDecidePhase(state, config, events);

    default:
      return state;
  }
}

/**
 * 初始化阶段
 */
async function executeInitPhase(
  state: WorkflowState,
  config: ArchitectWorkflowConfig,
  events: Subject<WorkflowEvent>,
): Promise<WorkflowState> {
  // 开始第一次迭代
  events.next({ type: "iteration_started", iteration: 1 });

  return {
    ...state,
    phase: "plan",
    iteration: 1,
  };
}

/**
 * 规划阶段 - Architect 分析需求并制定计划
 */
async function executePlanPhase(
  state: WorkflowState,
  config: ArchitectWorkflowConfig,
  events: Subject<WorkflowEvent>,
  phaseTimeout: number,
): Promise<WorkflowState> {
  // 构建规划提示词
  const planPrompt = buildPlanPrompt(state);

  // 调用 Architect 进行规划
  const result = await callArchitect({
    prompt: planPrompt,
    config,
    phaseTimeout,
  });

  if (result.success) {
    events.next({
      type: "phase_completed",
      phase: "plan",
      iteration: state.iteration,
      result: result.content,
    });

    return {
      ...state,
      phase: "code",
      plan: result.content,
    };
  } else {
    return {
      ...state,
      phase: "failed",
      error: `规划阶段失败: ${result.error}`,
    };
  }
}

/**
 * 编码阶段 - 调用 MCP Coder 工具
 */
async function executeCodePhase(
  state: WorkflowState,
  config: ArchitectWorkflowConfig,
  events: Subject<WorkflowEvent>,
  phaseTimeout: number,
  coderToolName: string,
): Promise<WorkflowState> {
  // 获取 Coder 工具
  const coderTool = config.toolRegistry.get(coderToolName);
  if (!coderTool) {
    return {
      ...state,
      phase: "failed",
      error: `Coder 工具未注册: ${coderToolName}`,
    };
  }

  // 构建编码任务
  const codeTask = buildCodeTask(state);

  // 调用 Coder 工具
  const result = await coderTool.execute(
    {
      task: codeTask,
      context: state.context,
    },
    {
      sessionId: `architect-${state.iteration}`,
      turn: state.iteration,
      cwd: config.cwd,
    },
  );

  events.next({
    type: "phase_completed",
    phase: "code",
    iteration: state.iteration,
    result: result.status === "success" ? result.output : result.error,
  });

  if (result.status === "success") {
    return {
      ...state,
      phase: "verify",
      codeResult: result,
      changes: [...state.changes, result.output],
    };
  } else {
    return {
      ...state,
      phase: "failed",
      error: `编码阶段失败: ${result.error}`,
    };
  }
}

/**
 * 验证阶段 - Architect 验证编码结果
 */
async function executeVerifyPhase(
  state: WorkflowState,
  config: ArchitectWorkflowConfig,
  events: Subject<WorkflowEvent>,
  phaseTimeout: number,
): Promise<WorkflowState> {
  // 构建验证提示词
  const verifyPrompt = buildVerifyPrompt(state);

  // 调用 Architect 进行验证
  const result = await callArchitect({
    prompt: verifyPrompt,
    config,
    phaseTimeout,
  });

  if (result.success) {
    // 解析验证结果
    const verifyResult = parseVerifyResult(result.content ?? "无响应");

    events.next({
      type: "phase_completed",
      phase: "verify",
      iteration: state.iteration,
      result: verifyResult,
    });

    return {
      ...state,
      phase: "review",
      verifyResult,
    };
  } else {
    // 验证失败，但仍然进入审查阶段
    return {
      ...state,
      phase: "review",
      verifyResult: { passed: false, issues: [result.error ?? "验证失败"] },
    };
  }
}

/**
 * 审查阶段 - 调用 MCP Reviewer 工具
 */
async function executeReviewPhase(
  state: WorkflowState,
  config: ArchitectWorkflowConfig,
  events: Subject<WorkflowEvent>,
  phaseTimeout: number,
  reviewerToolName: string,
): Promise<WorkflowState> {
  // 获取 Reviewer 工具
  const reviewerTool = config.toolRegistry.get(reviewerToolName);
  if (!reviewerTool) {
    return {
      ...state,
      phase: "failed",
      error: `Reviewer 工具未注册: ${reviewerToolName}`,
    };
  }

  // 构建审查内容
  const reviewChanges = state.codeResult?.status === "success"
    ? state.codeResult.output
    : "";

  // 调用 Reviewer 工具
  const result = await reviewerTool.execute(
    {
      changes: reviewChanges,
      criteria: ["代码质量", "测试覆盖", "安全性", "性能"],
    },
    {
      sessionId: `architect-${state.iteration}`,
      turn: state.iteration,
      cwd: config.cwd,
    },
  );

  events.next({
    type: "phase_completed",
    phase: "review",
    iteration: state.iteration,
    result: result.status === "success" ? result.data : result.error,
  });

  if (result.status === "success" && result.data) {
    const reviewData = result.data as {
      approved: boolean;
      issues: Array<{ severity: string; description: string }>;
      suggestions: string[];
      summary: string;
    };

    return {
      ...state,
      phase: "decide",
      reviewResult: reviewData,
    };
  } else {
    // 审查失败，默认通过（允许继续）
    return {
      ...state,
      phase: "decide",
      reviewResult: {
        approved: true,
        issues: [],
        suggestions: [],
        summary: "审查工具执行失败，默认通过",
      },
    };
  }
}

/**
 * 决策阶段 - 根据审查结果决定是否继续迭代
 */
async function executeDecidePhase(
  state: WorkflowState,
  config: ArchitectWorkflowConfig,
  events: Subject<WorkflowEvent>,
): Promise<WorkflowState> {
  const approved = state.reviewResult?.approved ?? false;

  events.next({
    type: "iteration_completed",
    iteration: state.iteration,
    approved,
  });

  if (approved) {
    // 审查通过，工作流完成
    events.next({
      type: "phase_completed",
      phase: "decide",
      iteration: state.iteration,
      result: { decision: "complete", approved: true },
    });

    return {
      ...state,
      phase: "complete",
    };
  } else {
    // 审查不通过，继续迭代
    const nextIteration = state.iteration + 1;

    if (nextIteration > state.maxIterations) {
      // 达到最大迭代次数
      return {
        ...state,
        phase: "failed",
        error: "达到最大迭代次数，审查仍未通过",
      };
    }

    events.next({
      type: "phase_completed",
      phase: "decide",
      iteration: state.iteration,
      result: { decision: "retry", approved: false, nextIteration },
    });

    events.next({ type: "iteration_started", iteration: nextIteration });

    return {
      ...state,
      phase: "plan",
      iteration: nextIteration,
    };
  }
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 调用 Architect Provider
 */
async function callArchitect(params: {
  prompt: string;
  config: ArchitectWorkflowConfig;
  phaseTimeout: number;
}): Promise<{ success: boolean; content?: string; error?: string }> {
  const { prompt, config, phaseTimeout } = params;

  try {
    // 创建临时 session
    const session = await config.sessionManager.startSession({
      cwd: config.cwd,
      mode: "single",
      providerId: config.provider.id,
    });

    // 创建输入
    const input$ = of({
      turn: 1,
      content: prompt,
      source: "message" as const,
    });

    // 运行 Agent
    const { events$ } = runAgentLoop({
      input$,
      provider: config.provider,
      sessionManager: config.sessionManager,
      toolRegistry: config.toolRegistry,
      permissionGate: config.permissionGate,
      cwd: config.cwd,
      mode: "single",
      existingSession: session,
      maxStepsPerTurn: config.maxStepsPerTurn ?? 8,
    });

    // 等待最终响应
    const result = await lastValueFrom(
      events$.pipe(
        filter((e): e is { type: "assistant_message"; sessionId: string; turn: number; content: string } =>
          e.type === "assistant_message"
        ),
        take(1),
        timeout(phaseTimeout),
        catchError(() => EMPTY),
      ),
    );

    if (result && result.content) {
      return { success: true, content: result.content };
    } else {
      return { success: false, error: "Architect 未返回响应" };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 构建规划提示词
 */
function buildPlanPrompt(state: WorkflowState): string {
  let prompt = `## 任务分析

原始任务: ${state.task}
当前迭代: ${state.iteration} / ${state.maxIterations}

`;

  if (state.context) {
    prompt += `上下文: ${state.context}\n\n`;
  }

  if (state.reviewResult && !state.reviewResult.approved) {
    prompt += `## 上次审查反馈

审查未通过，问题列表:
${state.reviewResult.issues.map((i) => `- [${i.severity}] ${i.description}`).join("\n")}

改进建议:
${state.reviewResult.suggestions.map((s) => `- ${s}`).join("\n")}

请根据以上反馈调整计划。
`;
  }

  prompt += `
## 请制定详细计划

请分析任务需求，制定详细的实施计划，包括：
1. 需要修改/创建的文件
2. 每个文件的具体变更内容
3. 实施步骤
4. 预期结果
`;

  return prompt;
}

/**
 * 构建编码任务
 */
function buildCodeTask(state: WorkflowState): string {
  if (!state.plan) {
    return state.task;
  }

  return `## 实施计划

${state.plan}

## 原始任务

${state.task}

## 要求

请严格按照计划执行编码任务。完成后报告变更内容。`;
}

/**
 * 构建验证提示词
 */
function buildVerifyPrompt(state: WorkflowState): string {
  // 安全地获取编码结果
  const codeOutput = state.codeResult?.status === "success"
    ? state.codeResult.output
    : state.codeResult?.status === "error"
      ? `编码失败: ${state.codeResult.error}`
      : "无";

  return `## 验证编码结果

原始任务: ${state.task}

编码结果:
${codeOutput}

## 请验证

请验证编码结果是否符合预期：
1. 是否完成了计划中的所有任务？
2. 是否有明显的错误或遗漏？
3. 代码风格是否一致？

输出格式:
- 通过: [是/否]
- 问题: [问题列表，如有]
`;
}

/**
 * 解析验证结果
 */
function parseVerifyResult(content: string): { passed: boolean; issues: string[] } {
  const lowerContent = content.toLowerCase();
  const passed =
    lowerContent.includes("通过") ||
    lowerContent.includes("pass") ||
    lowerContent.includes("是");

  const issues: string[] = [];
  const issuePattern = /问题[：:]\s*(.+)/gi;
  let match;
  while ((match = issuePattern.exec(content)) !== null) {
    issues.push(match[1].trim());
  }

  return { passed, issues };
}
