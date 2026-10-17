import { getAsyncTaskManager } from "../core/runtime/async-task-manager.js";
import path from "node:path";
/**
 * wiring.ts - workflow runtime 接线层
 *
 * 把 WorkflowScheduler 接到真实运行时：
 * - spawn 适配到 spawnChildAgentForwarding$（真子 Agent，非 mock）
 * - Skill 依赖装配（list/submit/query）
 * - workflow 工具重注册（带 submit 的可执行版，覆盖占位）
 *
 * P1 约束（诚实记录）：
 * - scheduler 按 session.id 缓存单例；workflow 工具经 skill 路径调用时同 session 命中。
 * - 模型直调 workflow 工具但本 session 未跑过 skill 时，返回引导错误（要求先 /workflows）。
 * - 完成通知目前只落 journal/final-state + 内存事件环；向 live loop 回灌 user 消息是 P2。
 */

import { randomUUID } from "node:crypto";
import { zodToJsonSchema } from "@alcyone-labs/zod-to-json-schema";
import type { ZodTypeAny } from "zod";
import { WorkflowScheduler } from "./scheduler.js";
import { estimateTokens } from "./budget.js";
import {
  defaultGlobalDir,
  defaultProjectDir,
  scanManifests,
} from "./loader.js";
import { setWorkflowsDeps } from "../skills/workflows-skill.js";
import { createWorkflowTool } from "../tools/workflow/workflow-tool.js";
import { spawnChildAgentForwarding$ } from "../tools/agent/spawn-agent/index.js";
import type { SpawnAgentContext } from "../tools/agent/spawn-agent/types.js";
import type { ToolRegistry } from "../tools/core/tool-registry.js";
import type { PermissionGate } from "../core/engine/permission-gate.js";
import type {
  SessionManager,
  SessionMetadata,
} from "../core/session/session-manager.js";
import type { AgentProvider } from "../providers/provider-types.js";
import type { ProviderRegistry } from "../providers/provider-registry.js";
import type { LoadedWastelandSettings } from "../config/settings-types.js";
import type { RuntimeEvent } from "../core/runtime/event-types.js";

export interface WorkflowsHostConfig {
  cwd: string;
  sessionDir: string;
  sessionManager: SessionManager;
  provider: AgentProvider;
  providerRegistry?: ProviderRegistry;
  toolRegistry: ToolRegistry;
  permissionGate: PermissionGate;
  loadedSettings?: LoadedWastelandSettings;
}

const schedulers = new Map<string, WorkflowScheduler>();
const eventRing: unknown[] = [];
let host: WorkflowsHostConfig | null = null;

function emit(event: unknown): void {
  eventRing.push(event);
  if (eventRing.length > 200) eventRing.shift();

  const e = event as {
    type?: string;
    taskId?: string;
    runId?: string;
    name?: string;
    result?: unknown;
    error?: unknown;
  };
  if (!e || !e.type || !e.taskId) return;

  const taskManager = getAsyncTaskManager();
  if (e.type === "workflow.start") {
    taskManager.register("workflow:" + (e.name ?? "workflow"), undefined, {
      taskId: e.taskId,
      runId: e.runId,
    });
  } else if (e.type === "workflow.done") {
    taskManager.complete(e.taskId, e.result);
  } else if (e.type === "workflow.fail") {
    taskManager.fail(
      e.taskId,
      e.error instanceof Error ? e.error.message : String(e.error),
    );
  }
}

/** 内存事件环（P1 观测口；TUI 订阅是 P2）。 */
export function getWorkflowEvents(): readonly unknown[] {
  return eventRing;
}

export function getSchedulerFor(sessionId: string): WorkflowScheduler | undefined {
  return schedulers.get(sessionId);
}

function schedulerFor(session: SessionMetadata): WorkflowScheduler {
  const hit = schedulers.get(session.id);
  if (hit) return hit;
  if (!host) throw new Error("workflows host not configured");
  const h = host;
  const spawn = async (
    prompt: string,
    opts: { model?: string; tools?: string[]; timeoutMs?: number; schema?: ZodTypeAny },
  ): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }> => {
    const task = opts.schema
      ? `${prompt}\n\n[workflow 约束]你必须只返回 JSON，不要输出多余文本。JSON 须符合以下 schema：\n${JSON.stringify(
          zodToJsonSchema(opts.schema),
        )}`
      : prompt;
    const call = {
      id: `wf-${randomUUID().slice(0, 8)}`,
      toolName: "spawn_agent",
      input: {
        name: "wf-agent",
        task,
        ...(opts.model ? { model: opts.model } : {}),
        ...(opts.tools ? { tools: opts.tools } : {}),
      },
    };
    const context: SpawnAgentContext = {
      sessionId: session.id,
      turn: 0,
      cwd: session.cwd,
      session,
      sessionManager: h.sessionManager,
      provider: h.provider,
      toolRegistry: h.toolRegistry,
      permissionGate: h.permissionGate,
      history: [],
      providerRegistry: h.providerRegistry,
      childAgentTimeout: opts.timeoutMs,
      depth: 0,
      loadedSettings: h.loadedSettings,
    };
    const text = await new Promise<string>((resolve, reject) => {
      let settled = false;
      spawnChildAgentForwarding$({ context, call }).subscribe({
        next: (event: RuntimeEvent) => {
          if (event.type === "agent_completed") {
            settled = true;
            if (event.status === "success") resolve(event.result ?? "");
            else reject(new Error(event.error ?? `child agent ${event.status}`));
          } else if (event.type === "tool_failed") {
            settled = true;
            reject(new Error(event.error));
          }
        },
        error: (e: unknown) => {
          if (!settled) {
            settled = true;
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        },
        complete: () => {
          if (!settled) {
            settled = true;
            reject(new Error("child agent stream completed without result"));
          }
        },
      });
    });
    return {
      text,
      usage: { inputTokens: estimateTokens(prompt), outputTokens: estimateTokens(text) },
    };
  };
  const scheduler = new WorkflowScheduler({
    spawn,
    sessionDir: h.sessionDir,
    journalAppend: () => undefined,
    emit,
  });
  schedulers.set(session.id, scheduler);
  return scheduler;
}

/** Skill/Tool 共用的提交入口（session 亲和）。 */
export async function workflowsSubmit(
  input: { name?: string; target?: string; args?: string[] },
  session: SessionMetadata,
  cwd: string,
): Promise<{ taskId: string; runId: string }> {
  const scheduler = schedulerFor(session);
  return scheduler.submit(
    {
      name: input.name,
      args: { target: input.target, argv: input.args ?? [] },
    },
    { cwd },
  );
}

export function configureWorkflowsHost(config: WorkflowsHostConfig): void {
  host = config;
  setWorkflowsDeps({
    list: async () => {
      const manifests = await scanManifests([
        { dir: defaultGlobalDir(), scope: "global" },
        { dir: path.join(config.cwd, "workflows/builtin"), scope: "global" as const },
        { dir: defaultProjectDir(config.cwd), scope: "project" },
      ]);
      return manifests.map((m) => ({ name: m.name, path: m.path }));
    },
    submit: async (input) => {
      const session = (input as { session?: SessionMetadata }).session;
      if (!session) throw new Error("workflow submit requires session (call /workflows first)");
      return workflowsSubmit(input, session, session.cwd);
    },
    query: async (id: string) => {
      for (const s of schedulers.values()) {
        try {
          return s.query(id);
        } catch {
          // try next
        }
      }
      throw new Error(`run not found: ${id}`);
    },
  });
  config.toolRegistry.register(
    createWorkflowTool({
      submit: async (toolInput, ctx) => {
        const scheduler = [...schedulers.values()].pop();
        if (!scheduler)
          throw new Error("no workflow session yet; run /workflows <name> first");
        return scheduler.submit(
          {
            name: toolInput.name,
            script: toolInput.script,
            scriptPath: toolInput.scriptPath,
            args: { argv: toolInput.args ?? [] },
          },
          { cwd: ctx.cwd },
        );
      },
    }),
  );
}
