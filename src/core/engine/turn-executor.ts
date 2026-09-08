
import {
  EMPTY,
  Observable,
  catchError,
  concat,
  concatWith,
  defer,
  from,
  map,
  merge,
  mergeMap,
  of,
  takeUntil,
  tap} from 'rxjs';
import { t } from '@locales/index.js';
import { UserInputBridge } from './user-input-bridge.js';
import type { AgentProvider } from '@providers/provider-types.js';
import { ToolRegistry } from '@tools/core/tool-registry.js';
import type {
  
  HistoryRecord,
  RuntimeEvent,
  
  
  SessionToolCallRecord,
  SessionToolResultRecord} from '../runtime/event-types.js';
import type { PermissionGate } from './permission-gate.js';
import { SessionManager, type SessionMetadata } from '../session/session-manager.js';
import { dispatchToolCall } from './tool-dispatch.js';
import { createToolCallRecord, createToolResultRecord } from './dispatch-utils.js';
import { createTurnContext } from '../runtime/turn-context.js';
import type { SkillExecutor } from '@core/skills/skill-executor.js';
import type { ProviderSettings, LoadedWastelandSettings } from '@config/settings-types.js';
import type { ProviderRegistry } from '@providers/provider-registry.js';
import { ContextManager, truncateToolOutput} from '../memory/context-manager.js';
import {
  advanceTurnState,
  appendAssistantChunk,
  completeTurnState,
  recordToolCall,
  recordToolResult,
  type TurnState} from './turn-state.js';
import {
  buildProviderFallbackMessage,
  consumeFirstChunkTrace,
  type DebugTraceInput} from './turn-helpers.js';
import {
  persistAssistantMessage,
  createAssistantRecord,
  createUsageRecord} from '../session/session-records.js';
import {
  maybeCompactContext,
  maybeSummaryCompact,
  persistCompactionRecord} from '../memory/context-compaction.js';
import { routeSkillCommand, checkMaxStepsExceeded, checkBudgetAndPreCompact } from "./loop-helpers.js";

export interface TurnExecutorParams {
  session: SessionMetadata;
  sessionManager: SessionManager;
  provider: AgentProvider;
  context: ReturnType<typeof createTurnContext>;
  history: HistoryRecord[];
  state: TurnState;
  toolRegistry?: ToolRegistry;
  permissionGate?: PermissionGate;
  cwd: string;
  maxStepsPerTurn: number;
  trace: (event: DebugTraceInput) => void;
  /** 技能执行器（可选） */
  skillExecutor?: SkillExecutor;
  /** Provider 注册表（用于子 Agent 模型选择） */
  providerRegistry?: ProviderRegistry;
  /** Provider 配置（用于子 Agent 模型选择） */
  providerSettings?: ProviderSettings;
  /** 子 Agent 执行超时（毫秒） */
  childAgentTimeout?: number;
  /** 用户输入桥接器（用于 ask-user 工具） */
  userInputBridge?: UserInputBridge;
  /** 当前 spawn 嵌套深度（用于限制递归 spawn） */
  spawnDepth?: number;
  /** 可选：完整 loadedSettings，透传到 dispatchToolCall → spawn-agent 用于读 multiAgent 配置 */
  loadedSettings?: LoadedWastelandSettings;
  /** 上下文管理器 */
  contextManager: ContextManager;
  /** 可选：用于打断当前生成的流 */
  abort$?: Observable<void>;
}

export class TurnExecutor {
  private params: TurnExecutorParams;
  private state: TurnState;
  private nextAction: 'complete' | 'tool' | 'none' = 'none';
  private streamIndex = 0;
  /** 首 token 计时起点（仅 turn 内第一次 provider 调用有效，其余 null；见 execute） */
  private firstChunkStartMs: number | null = null;
  private toolCallBuffer: Array<{
    event: { type: 'tool_call'; call: { id: string; toolName: string; input: Record<string, unknown> } };
    index: number;
  }> = [];

  constructor(params: TurnExecutorParams) {
    this.params = params;
    this.state = params.state;
  }

  public execute(): Observable<RuntimeEvent> {
    return defer(() => {
      // ---- 技能命令检测 ----
      const skillRouted$ = routeSkillCommand({
        skillExecutor: this.params.skillExecutor,
        toolRegistry: this.params.toolRegistry,
        permissionGate: this.params.permissionGate,
        provider: this.params.provider,
        session: this.params.session,
        sessionManager: this.params.sessionManager,
        history: this.params.history,
        cwd: this.params.cwd,
        turn: this.state.turn,
        step: this.state.step,
        inputContent: this.params.context.input.content,
        trace: this.params.trace});
      if (skillRouted$) {
        return skillRouted$;
      }

      // ---- 检查步数限制 ----
      const maxStepsExceeded$ = checkMaxStepsExceeded({
        state: this.state,
        maxStepsPerTurn: this.params.maxStepsPerTurn,
        session: this.params.session,
        sessionManager: this.params.sessionManager,
        history: this.params.history,
        contextManager: this.params.contextManager,
        trace: this.params.trace});
      if (maxStepsExceeded$) {
        return maxStepsExceeded$;
      }

      this.state = this.params.state;
      this.nextAction = 'none';
      this.streamIndex = 0;
      this.toolCallBuffer = [];

      this.params.trace({
        sessionId: this.params.session.id,
        turn: this.state.turn,
        step: this.state.step,
        scope: 'provider',
        phase: 'provider.start',
        message: 'run provider step',
        data: {
          provider: this.params.provider.id,
          history: this.state.history.length,
          toolResults: this.state.toolResults.length}});

      // 首 token 计时起点：仅 turn 内第一次 provider 调用（step === 1）；
      // 后续 step 各自 new TurnExecutor，不重复计时（多 step 只记首条）。
      this.firstChunkStartMs = this.state.step === 1 ? Date.now() : null;

      const budgetWarning$ = checkBudgetAndPreCompact({
        contextManager: this.params.contextManager,
        history: this.params.history,
        session: this.params.session,
        sessionManager: this.params.sessionManager,
        turn: this.state.turn,
        step: this.state.step,
        trace: this.params.trace});

      const provider$: Observable<RuntimeEvent> = defer((): Observable<RuntimeEvent> => {
        const step$ = this.params.provider.runStep({
          context: this.params.context,
          state: this.state,
        });
        // 中断语义：abort$ 触发 → AbortError（下游 catchError 转中断消息）。
        // 必须用 takeUntil 而不是 merge：abort$ 是常驻 Subject（TUI 创建后永不
        // complete），merge 会永远等它导致 provider$ 无法 complete，
        // processProviderTail / continuation 饿死（工具不派发、turn 不结束）。
        const abortable$ = this.params.abort$
          ? step$.pipe(
              takeUntil(
                this.params.abort$.pipe(
                  map(() => {
                    throw new Error('AbortError');
                  })
                )
              )
            )
          : step$;

        return abortable$.pipe(
          tap((e) => {
            if (e.type === 'tool_call' && e.call) {
              this.toolCallBuffer.push({
                event: e as any,
                index: this.streamIndex});
            }
            this.streamIndex++;
          }),
          mergeMap((e) => this.processStreamedNonToolEvent(e)),
          catchError((err): Observable<RuntimeEvent> => {
            this.toolCallBuffer = [];
            const errMsg = err instanceof Error ? err.message : String(err);
            const isAbort = errMsg === 'AbortError';
            
            this.params.trace({
              sessionId: this.params.session.id,
              turn: this.state.turn,
              step: this.state.step,
              scope: 'provider',
              phase: isAbort ? 'provider.abort' : 'provider.error',
              message: isAbort ? 'provider aborted by user' : `provider failed: ${errMsg}`,
              data: { provider: this.params.provider.id }});
            const errorContent = isAbort ? `[系统] 已中断响应。` : `[错误] provider 调用失败: ${errMsg}`;
            this.state = completeTurnState(this.state, errorContent);
            return from(
              this.params.sessionManager.appendRecord(
                this.params.session,
                createAssistantRecord(this.state.turn, errorContent)
              )
            ).pipe(
              map(
                (): RuntimeEvent => ({
                  type: 'assistant_message',
                  sessionId: this.params.session.id,
                  turn: this.state.turn,
                  content: errorContent})
              )
            );
          }),
          concatWith(defer(() => this.processProviderTail()))
        );
      });

      const continuation$ = defer(() => {
        if (this.nextAction === 'complete' || this.state.status === 'completed') {
          return EMPTY;
        }

        if (this.nextAction === 'tool') {
          const nextState = advanceTurnState(this.state);

          this.params.trace({
            sessionId: this.params.session.id,
            turn: nextState.turn,
            step: nextState.step,
            scope: 'turn',
            phase: 'turn.advance',
            message: 'advance to next provider step',
            data: {
              toolResults: nextState.toolResults.length}});

          return new TurnExecutor({
            ...this.params,
            state: nextState}).execute();
        }

        const fallbackMessage = buildProviderFallbackMessage(this.state);
        this.state = completeTurnState(this.state, fallbackMessage);

        this.params.trace({
          sessionId: this.params.session.id,
          turn: this.state.turn,
          step: this.state.step,
          scope: 'provider',
          phase: 'provider.empty',
          message: 'provider completed without final assistant message',
          data: {
            chunkCount: this.state.assistantChunks.length}});

        return persistAssistantMessage({
          session: this.params.session,
          sessionManager: this.params.sessionManager,
          history: this.params.history,
          turn: this.state.turn,
          content: fallbackMessage,
          contextManager: this.params.contextManager}).pipe(
          tap(() => {
            this.params.trace({
              sessionId: this.params.session.id,
              turn: this.state.turn,
              step: this.state.step,
              scope: 'turn',
              phase: 'turn.complete',
              message: 'turn completed via fallback assistant message',
              data: {
                contentLength: fallbackMessage.length}});
          })
        );
      });

      return concat(budgetWarning$, provider$, continuation$);
    });
  }

  private processStreamedNonToolEvent(
    event: { type: string; text?: string; call?: unknown; usage?: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number } }
  ): Observable<RuntimeEvent> {
    // 首 token 计时：首个带文本事件产生 provider.first_chunk trace（每 turn 一次）。
    // turn 内 TTFT 可观测：/logs 或 logs show 可见 provider.start → first_chunk 间隔。
    const measured = consumeFirstChunkTrace(
      {
        startMs: this.firstChunkStartMs,
        sessionId: this.params.session.id,
        turn: this.state.turn,
        step: this.state.step,
        providerId: this.params.provider.id,
      },
      event
    );
    this.firstChunkStartMs = measured.next.startMs;
    if (measured.trace) {
      this.params.trace(measured.trace);
    }
    if (event.type === 'assistant_chunk' && event.text) {
      this.state = appendAssistantChunk(this.state, event.text);
      this.params.trace({
        sessionId: this.params.session.id,
        turn: this.state.turn,
        step: this.state.step,
        scope: 'provider',
        phase: 'provider.chunk',
        message: 'chunk received',
        data: { textLength: event.text.length, preview: event.text.slice(0, 50) }});
      return of<RuntimeEvent>({
        type: 'assistant_chunk',
        sessionId: this.params.session.id,
        turn: this.state.turn,
        chunk: event.text});
    }
    if (event.type === 'assistant_message') {
      const content = event.text ?? '';
      this.state = completeTurnState(this.state, content);
      this.nextAction = 'complete';
      this.params.trace({
        sessionId: this.params.session.id,
        turn: this.state.turn,
        step: this.state.step,
        scope: 'turn',
        phase: 'turn.complete',
        message: 'turn completed',
        data: { contentLength: content.length }});
      const assistantRecord = createAssistantRecord(this.state.turn, content);
      return from(
        this.params.sessionManager.appendRecord(this.params.session, assistantRecord)
      ).pipe(
        tap(() => {
          this.params.history.push(assistantRecord);
          this.params.contextManager.trackRecord(assistantRecord);
        }),
        map(
          (): RuntimeEvent => ({
            type: 'assistant_message',
            sessionId: this.params.session.id,
            turn: this.state.turn,
            content})
        )
      );
    }
    if (event.type === 'usage' && event.usage) {
      const usage = event.usage;
      this.params.contextManager.reportUsage(usage);
      let usageMessage = `Tokens: ↑${usage.promptTokens} ↓${usage.completionTokens} = ${usage.totalTokens}`;
      if (usage.cachedTokens != null && usage.promptTokens > 0) {
        const hitRate = Math.round((usage.cachedTokens / usage.promptTokens) * 100);
        usageMessage += ` (Cache Hit: ${usage.cachedTokens}, ${hitRate}%)`;
      }
      this.params.trace({
        sessionId: this.params.session.id,
        turn: this.state.turn,
        step: this.state.step,
        scope: 'provider',
        phase: 'provider.usage',
        message: usageMessage,
        data: { usage }});
      const usageEvent$ = from(
        this.params.sessionManager.appendRecord(
          this.params.session,
          createUsageRecord(this.params.session.id, this.state.turn, usage)
        )
      ).pipe(
        map(
          (): RuntimeEvent => ({
            type: 'usage_update',
            sessionId: this.params.session.id,
            turn: this.state.turn,
            usage})
        )
      );
      const compaction$ = defer(async () => {
        const ev = await maybeSummaryCompact({
          contextManager: this.params.contextManager,
          history: this.params.history,
          provider: this.params.provider,
          sessionId: this.params.session.id,
          turn: this.state.turn,
          cwd: this.params.cwd,
          summarizationEnabled:
            this.params.loadedSettings?.settings?.runtime?.contextSummarization ?? true});
        if (ev) persistCompactionRecord(this.params.sessionManager, this.params.session, ev);
        return ev;
      }).pipe(mergeMap((ev) => (ev ? of(ev) : EMPTY)));
      return concat(compaction$, usageEvent$);
    }
    return EMPTY;
  }

  private processProviderTail(): Observable<RuntimeEvent> {
    return defer(() => {
      if (this.toolCallBuffer.length === 0) {
        return EMPTY;
      }

      for (const { event } of this.toolCallBuffer) {
        this.state = recordToolCall(this.state, event.call);
      }
      this.nextAction = 'tool';

      const spawnEvents = this.toolCallBuffer.filter(
        (tc) => tc.event.call.toolName === 'spawn_agent'
      );
      const otherEvents = this.toolCallBuffer.filter(
        (tc) => tc.event.call.toolName !== 'spawn_agent'
      );

      type Collected = {
        call: { id: string; toolName: string; input: Record<string, unknown> };
        event: RuntimeEvent & { type: 'tool_result' | 'tool_failed' };
        originalIndex: number;
      };
      const collected: Collected[] = [];

      const wrap = (
        call: { id: string; toolName: string; input: Record<string, unknown> },
        idx: number
      ): Observable<RuntimeEvent> =>
        this.dispatchSingleToolCall(call, this.state, idx).pipe(
          tap((ev) => {
            if (ev.type === 'tool_result' || ev.type === 'tool_failed') {
              collected.push({ call, event: ev as Collected['event'], originalIndex: idx });
            }
          })
        );

      const spawnStreams$: Observable<RuntimeEvent> =
        spawnEvents.length > 0
          ? merge(...spawnEvents.map(({ event, index }) => wrap(event.call, index)))
          : EMPTY;

      const otherStreams$: Observable<RuntimeEvent> =
        otherEvents.length > 0
          ? concat(...otherEvents.map(({ event, index }) => wrap(event.call, index)))
          : EMPTY;

      const streaming$: Observable<RuntimeEvent> =
        spawnEvents.length > 0 && otherEvents.length > 0
          ? concat(spawnStreams$, otherStreams$)
          : spawnEvents.length > 0
            ? spawnStreams$
            : otherStreams$;

      const historyPart$ = defer((): Observable<RuntimeEvent> => {
        if (collected.length === 0) return EMPTY;
        collected.sort((a, b) => a.originalIndex - b.originalIndex);
        const compactionEvents: RuntimeEvent[] = [];
        for (const { call, event } of collected) {
          const toolCallRecord: SessionToolCallRecord = createToolCallRecord(
            this.params.session,
            this.state.turn,
            call
          );
          this.params.history.push(toolCallRecord);
          this.params.contextManager.trackRecord(toolCallRecord);

          if (event.type === 'tool_result') {
            const rec: SessionToolResultRecord = createToolResultRecord({
              session: this.params.session,
              turn: this.state.turn,
              call,
              status: event.status,
              output: truncateToolOutput(event.output)});
            this.params.history.push(rec);
            this.params.contextManager.trackRecord(rec);
            this.state = recordToolResult(this.state, {
              callId: call.id,
              toolName: event.toolName,
              input: call.input,
              status: event.status,
              output: event.output});
          } else {
            const rec: SessionToolResultRecord = createToolResultRecord({
              session: this.params.session,
              turn: this.state.turn,
              call,
              status: event.status,
              error: truncateToolOutput(event.error)});
            this.params.history.push(rec);
            this.params.contextManager.trackRecord(rec);
            this.state = recordToolResult(this.state, {
              callId: call.id,
              toolName: event.toolName,
              input: call.input,
              status: event.status,
              error: event.error});
          }

          const compaction = maybeCompactContext({
            contextManager: this.params.contextManager,
            history: this.params.history,
            sessionId: this.params.session.id,
            turn: this.state.turn});
          if (compaction) {
            persistCompactionRecord(this.params.sessionManager, this.params.session, compaction);
            compactionEvents.push(compaction);
          }
        }
        return compactionEvents.length > 0 ? from(compactionEvents) : EMPTY;
      });

      return concat(streaming$, historyPart$);
    });
  }

  private dispatchSingleToolCall(
    call: { id: string; toolName: string; input: Record<string, unknown> },
    currentState: TurnState,
    _originalIndex: number
  ): Observable<RuntimeEvent> {
    if (!this.params.toolRegistry || !this.params.permissionGate) {
      const error = t('runtime.noToolRegistry');
      this.params.trace({
        sessionId: this.params.session.id,
        turn: this.state.turn,
        step: this.state.step,
        scope: 'tool',
        phase: 'tool.result',
        message: 'tool execution failed before dispatch',
        data: { tool: call.toolName, status: 'error' }});
      this.state = recordToolResult(this.state, {
        callId: call.id,
        toolName: call.toolName,
        input: call.input,
        status: 'error',
        error});
      return of<RuntimeEvent>({
        type: 'tool_failed',
        sessionId: this.params.session.id,
        turn: this.state.turn,
        callId: call.id,
        toolName: call.toolName,
        status: 'error',
        error});
    }

    const startedAt = Date.now();

    return dispatchToolCall({
      session: this.params.session,
      sessionManager: this.params.sessionManager,
      turn: this.state.turn,
      call,
      registry: this.params.toolRegistry,
      permissionGate: this.params.permissionGate,
      cwd: this.params.cwd,
      turnState: currentState,
      provider: this.params.provider,
      history: this.params.history,
      providerRegistry: this.params.providerRegistry,
      providerSettings: this.params.providerSettings,
      childAgentTimeout: this.params.childAgentTimeout,
      userInputBridge: this.params.userInputBridge,
      loadedSettings: this.params.loadedSettings,
      spawnDepth: this.params.spawnDepth}).pipe(
      tap((event) => {
        if (event.type === 'tool_started') {
          this.params.trace({
            sessionId: this.params.session.id,
            turn: this.state.turn,
            step: this.state.step,
            scope: 'tool',
            phase: 'call',
            message: 'tool execution started',
            data: { toolName: event.toolName, callId: event.callId }});
        } else if (event.type === 'permission_decision') {
          this.params.trace({
            sessionId: this.params.session.id,
            turn: this.state.turn,
            step: this.state.step,
            scope: 'tool',
            phase: 'permission',
            message: 'permission decision resolved',
            data: {
              toolName: event.toolName,
              decision: event.decision,
              mode: event.mode,
              callId: event.callId}});
        } else if (event.type === 'tool_result') {
          this.params.trace({
            sessionId: this.params.session.id,
            turn: this.state.turn,
            step: this.state.step,
            scope: 'tool',
            phase: 'success',
            message: 'tool execution completed',
            data: {
              toolName: event.toolName,
              status: event.status,
              ms: Date.now() - startedAt,
              callId: event.callId}});
        } else if (event.type === 'tool_failed') {
          this.params.trace({
            sessionId: this.params.session.id,
            turn: this.state.turn,
            step: this.state.step,
            scope: 'tool',
            phase: 'error',
            message: 'tool execution failed',
            data: {
              toolName: event.toolName,
              status: event.status,
              ms: Date.now() - startedAt,
              error: event.error,
              callId: event.callId}});
        }
      })
    );
  }
}
