/**
 * spawn-agent/index.ts - 子 Agent 创建与事件转发主入口
 *
 * 编排各子模块：
 * - input-parser：Zod schema + 嵌套深度 + multiAgent 配置 + 工具/模型合并
 * - skin-acquirer：候选收集 + SkinOccupancy 占用
 * - context-builder：system prompt + inheritHistory + tool 限定 + provider 解析
 * - event-forwarder：child 事件 → parent 事件
 *
 * 主函数 `spawnChildAgentForwarding$` 是 spawn_agent 工具的执行入口。
 *
 * ## 核心设计
 *
 * - 子 Agent 通过 runAgentLoop 执行（mode="single"）
 * - 子 Agent 的中间事件被转译为 agent_thinking / agent_tool_use / agent_progress
 *   三个父侧可观察事件（定义于 event-types.ts）
 * - 最终结果以 tool_result / tool_failed 形式写回父 session
 *
 * ## 使用示例
 *
 * ```typescript
 * // 在 handleSpawnAgent 中：
 * spawnChildAgentForwarding$({ context, call });
 * ```
 */

import { defer, mergeMap, of, retry, timer, type Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';

import { Logger } from '@core/logger/index.js';
import { runAgentLoop } from '@core/engine/agent-loop.js';
import type { RuntimeEvent } from '@core/runtime/event-types.js';

import { defaultSkin as defaultRoleSkin } from '@skins/index.js';
import * as skinOccupancy from '@core/runtime/skin-occupancy.js';

// 副作用：导入 dispatch-handler.ts 触发 registerPreDispatchHook('spawn_agent', ...)
// 这是 ESM 标准模式——模块顶层副作用在 import 时执行一次。
// 这里只是触发，不直接使用任何导出符号。
import './dispatch-handler.js';

import {
  checkSpawnDepth,
  mapModelToActualModel,
  parseSpawnInput,
  resolveSubAgentInput,
  SPAWN_AGENT_INPUT_SCHEMA_JSON,
  spawnAgentInputSchema,
  type SpawnAgentInput,
} from './input-parser.js';
import {
  collectSubAgentSkins,
  selectAndAcquireSkin,
} from './skin-acquirer.js';
import { buildChildSetup } from './context-builder.js';
import { assembleForwardObservable } from './event-forwarder.js';
import { MAX_SPAWN_DEPTH, type SpawnAgentContext } from './types.js';

// ============================================================
// 集中导出给外部消费
// ============================================================

/** spawn_agent 工具的输入类型 */
export type { SpawnAgentInput };

/** Zod Schema + JSON Schema */
export { spawnAgentInputSchema, SPAWN_AGENT_INPUT_SCHEMA_JSON };

/** 子 Agent 最大嵌套深度（防止递归 spawn 耗尽资源） */
export { MAX_SPAWN_DEPTH };

/** spawn_agent 工具的风险等级（内部智能体协同/编排，不直接操作底层系统） */
export const SPAWN_AGENT_RISK_LEVEL = 'read' as const;

/** spawn_agent 工具的描述（展示给 LLM） */
export const SPAWN_AGENT_DESCRIPTION = '创建并运行子 Agent 执行任务';

export type { SpawnAgentContext };

// ============================================================
// 主 Observable
// ============================================================

/**
 * 运行子 Agent 并将其事件流转发为父侧可观察的 agent_* 事件。
 *
 * 设计目的：让父 Agent 和 TUI 能实时看到子 Agent 的思考、工具调用与进度，
 * 而不仅仅是最终的文本结果。修复前，子 Agent 的中间事件（assistant_chunk、
 * tool_call_requested、tool_result 等）被完全吞掉，父侧和 TUI 只能看到
 * "开始"和"结束 + 最终文本"两个事件，是黑盒。
 *
 * 输出事件顺序：
 * 1. agent_spawned（带 childId / childSessionPath）
 * 2. agent_thinking / agent_tool_use / agent_progress（来自子 Agent 的中间事件转译）
 * 3. agent_completed（success / error / timeout）
 * 4. tool_result 或 tool_failed（作为 spawn_agent 工具在父侧的最终结果，写入父 session）
 *
 * 单订阅保证：events$ 是 cold Observable，本函数内部只订阅一次以避免子 Agent 重复执行。
 *
 * @param params - 上下文与工具调用
 * @returns RuntimeEvent 事件流
 */
export function spawnChildAgentForwarding$(params: {
  context: SpawnAgentContext;
  call: { id: string; toolName: string; input: Record<string, unknown> };
}): Observable<RuntimeEvent> {
  const { context, call } = params;
  const parentId = context.session.id;

  // ---- 输入校验 ----
  const parseResult = parseSpawnInput(call);
  if (!parseResult.ok) {
    return of<RuntimeEvent>({
      type: 'tool_failed',
      sessionId: parentId,
      turn: context.turn,
      callId: call.id,
      toolName: call.toolName,
      status: 'error',
      error: parseResult.error,
    });
  }

  const { childName, childTask, tools, model, inheritHistory } = parseResult.parsed;

  // ---- 嵌套深度检查 ----
  if (!checkSpawnDepth(context)) {
    return of<RuntimeEvent>({
      type: 'tool_failed',
      sessionId: parentId,
      turn: context.turn,
      callId: call.id,
      toolName: call.toolName,
      status: 'error',
      error: `已达到子 Agent 最大嵌套深度（${MAX_SPAWN_DEPTH}），禁止继续 spawn。`,
    });
  }

  const childAgentTimeoutMs = context.childAgentTimeout ?? 600000;

  // ---- subAgent 配置解析（重试 / tools / model） ----
  const resolved = resolveSubAgentInput({
    childName,
    model,
    tools,
    context,
  });

  // ---- Skin 候选列表（提前收集，等子 session 创建后再占用） ----
  const subAgentSkinCandidates = collectSubAgentSkins(resolved.subAgentConfig);

  // ---- 准备并启动子 Agent ----
  return defer(async () => {
    const childSession = await context.sessionManager.createChildSession(
      context.session,
      childName
    );

    // ---- Subagent transcript sidecar + meta.json（PRD R17）----
    // 路径约定：.wasteland/logs/transcript/<parentSid>/subagents/agent-<childId>.{jsonl,meta.json}
    // 仅写 meta 与空 skeleton jsonl；完整 transcript 复制留给 P2。
    // 失败静默：spawn 主流程不应被 sidecar 写盘失败阻塞。
    try {
      await writeSubagentSidecar({
        parentSid: context.session.id,
        childSid: childSession.id,
        childName,
        callId: call.id,
        depth: resolved.depth,
      });
    } catch (err) {
      Logger.debug({
        sessionId: parentId,
        turn: context.turn,
        scope: 'tool',
        message: 'subagent.sidecar.write_failed',
        data: {
          kind: 'subagent_sidecar_write_failed',
          childId: childSession.id,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }

    // ---- Skin 选择 + 占用 ----
    // 在拿到 childSession.id 后立即占用（防止同一 tick 内两次 spawn 撞同一个 skin）
    const selectedSkinId = selectAndAcquireSkin(subAgentSkinCandidates, childSession.id);
    const acquisitionFailed =
      subAgentSkinCandidates.length > 0 && selectedSkinId === defaultRoleSkin;

    // ---- 组装子 agent 的 system prompt + 输入 + tool 限定 + provider 解析 ----
    const { reportResultTool } = await import('../../interaction/report-result.js');
    const setup = buildChildSetup({
      childSessionId: childSession.id,
      childName,
      childTask,
      inheritHistory,
      subAgentConfig: resolved.subAgentConfig,
      resolved,
      context,
      selectedSkinId,
      reportResultTool,
    });

    const { events$ } = runAgentLoop({
      input$: setup.childInput$,
      provider: setup.childProvider,
      sessionManager: context.sessionManager,
      toolRegistry: setup.childToolRegistry,
      permissionGate: context.permissionGate,
      cwd: context.cwd,
      mode: 'single',
      existingSession: childSession,
      providerRegistry: context.providerRegistry,
      // 子 agent 用其自身模型的 providerSettings（context window 按其模型解析），继承父时为 undefined
      providerSettings: setup.childProviderSettings,
      childAgentTimeout: context.childAgentTimeout,
      userInputBridge: context.userInputBridge,
      spawnDepth: resolved.depth,
      // 子 agent 的 system prompt（来自 multiAgent.promptTemplate）
      // minimax 收到后会按角色约束行为（不再"角色扮演"）
      prompt: setup.subAgentPrompt,
      loadedSettings: context.loadedSettings,
      // 子 Agent 专享深度分析预算（默认 50 步，允许充足的代码/架构检索与分析）
      maxStepsPerTurn: context.loadedSettings?.settings?.runtime?.maxStepsPerTurn
        ? Math.max(context.loadedSettings.settings.runtime.maxStepsPerTurn, 50)
        : 50,
    });

    // 日志：记录子 agent 实际配置（验证 minimax 调用时输入 + 解析后的 model/tools）
    // 用于排查子 agent 是否按 settings.json multiAgent 配置运行
    Logger.debug({
      sessionId: parentId,
      turn: context.turn,
      scope: 'tool',
      message: `spawn_agent:${childName}`,
      data: {
        kind: 'spawn_agent',
        childName,
        childId: childSession.id,
        subAgentConfigName: resolved.subAgentConfig ? childName : null,
        taskPreview: childTask.slice(0, 150),
        taskLength: childTask.length,
        providerId: setup.childProvider.id,
        resolvedModel: resolved.resolvedModelAlias
          ? resolved.subAgentConfigModelUsed
            ? resolved.resolvedModelAlias
            : mapModelToActualModel(resolved.resolvedModelAlias, context.provider.id)
          : (context.providerSettings?.model ?? 'inherit-parent'),
        modelParam: model ?? null,
        inheritedModel: resolved.subAgentConfig?.model ?? null,
        inheritHistory: inheritHistory ?? false,
        toolsRequested: tools ?? null,
        resolvedToolNames: setup.childToolRegistry ? setup.childToolRegistry.list() : [],
        subAgentTools: resolved.effectiveTools && resolved.effectiveTools.length > 0
          ? resolved.effectiveTools
          : null,
        subAgentPromptPreview: setup.subAgentPrompt
          ? setup.subAgentPrompt.slice(0, 200)
          : null,
        subAgentPromptLength: setup.subAgentPrompt?.length ?? 0,
        // skin occupancy 新增字段
        skinCandidates: subAgentSkinCandidates.length > 0 ? subAgentSkinCandidates : null,
        selectedSkin: selectedSkinId,
        acquisitionFailed,
        availableCount: subAgentSkinCandidates.length > 0
          ? skinOccupancy.getAvailable(subAgentSkinCandidates).length
          : 0,
        depth: resolved.depth,
      },
    });

    return {
      childSession,
      events$,
      selectedSkinId,
      childAgentTimeoutMs,
    };
  }).pipe(
    mergeMap(({ childSession, events$, selectedSkinId, childAgentTimeoutMs }) => {
      const childId = childSession.id;
      const childSessionPath = childSession.path;

      // ---- 事件转发主入口 ----
      return assembleForwardObservable({
        events$,
        parentId,
        childId,
        childName,
        childTask,
        childSessionPath,
        call,
        turn: context.turn,
        context,
        subAgentSkinCandidates,
        selectedSkinId,
        childAgentTimeoutMs,
      });
    }),
    // ---- 重试逻辑：失败时按 multiAgent.maxRetries 重新 attempt（指数退避） ----
    // 每次重试都会重新跑 defer → 新 childSession + 新 runAgentLoop（新 attempt）
    retry({
      count: resolved.maxRetries,
      delay: (err, count) => {
        Logger.debug({
          sessionId: parentId,
          turn: context.turn,
          scope: 'tool',
          message: `spawn_retry:${childName}`,
          data: {
            kind: 'spawn_retry',
            childName,
            attempt: count,
            maxRetries: resolved.maxRetries,
            error: err.message,
          },
        });
        return timer(resolved.retryDelayMs * Math.pow(2, count - 1));
      },
    }),
    // ---- 全部重试失败：返回明确 tool_failed（避免 minimax 自己脑补） ----
    catchError((err) =>
      of<RuntimeEvent>({
        type: 'tool_failed',
        sessionId: parentId,
        turn: context.turn,
        callId: call.id,
        toolName: call.toolName,
        status: 'error',
        error: `子 agent ${childName} 失败 ${resolved.maxRetries + 1} 次: ${err.message}`,
      })
    )
  );
}

// ============================================================
// 内部 helper：subagent transcript sidecar
// ============================================================

/**
 * 在 .wasteland/logs/transcript/<parentSid>/subagents/ 下写 meta.json + 空 jsonl。
 *
 * 字段对齐 Claude Code `subagents/agent-<id>.meta.json`：
 * - agentType / description / toolUseId / spawnDepth / createdAt + 我们的 childSessionId
 *
 * 不复制完整 transcript jsonl（完整复制留 P2，需要重写 SessionManager 的输出 sink）；
 * 仅留 skeleton + meta，便于 `wasteland logs show <parentSid>` 反查父 → 子链路。
 *
 * 失败静默：调用点已 catch。
 */
async function writeSubagentSidecar(params: {
  parentSid: string;
  childSid: string;
  childName: string;
  callId: string;
  depth: number;
}): Promise<void> {
  const logRoot = join(resolvePath(process.cwd()), '.wasteland', 'logs', 'transcript');
  const dir = join(logRoot, params.parentSid, 'subagents');
  await mkdir(dir, { recursive: true });

  const jsonlPath = join(dir, `agent-${params.childSid}.jsonl`);
  const metaPath = join(dir, `agent-${params.childSid}.meta.json`);

  // meta.json（对齐 Claude Code 字段名）
  const meta = {
    agentType: params.childName,
    description: params.childName,
    toolUseId: params.callId,
    spawnDepth: params.depth,
    createdAt: new Date().toISOString(),
    childSessionId: params.childSid,
    parentSessionId: params.parentSid,
  };
  await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  // skeleton jsonl：仅写一行 isSidechain:true 标识（对齐 Claude Code subagent 标记），
  // 便于 tools 区分父/子 transcript；完整 transcript 复制留 P2
  const skeletonEntry = {
    isSidechain: true,
    childSessionId: params.childSid,
    parentSessionId: params.parentSid,
    timestamp: new Date().toISOString(),
  };
  await writeFile(jsonlPath, JSON.stringify(skeletonEntry) + '\n', 'utf8');
}
