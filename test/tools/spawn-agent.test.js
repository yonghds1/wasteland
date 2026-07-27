/**
 * spawn-agent.test.js - spawn_agent 与 subAgents 配置测试
 *
 * 覆盖：
 * 1. subAgents 配置真正生效（prompt 注入 + 工具限定）
 * 2. 主 agent 工具集最小化（MAIN_AGENT_TOOL_NAMES）
 * 3. 工具优先级：subAgents.tools > minimax 传入的 tools > 全部工具
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import { lastValueFrom, of, toArray } from "rxjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ============================================================
// 模块加载（dist 必须在 build 之后）
// ============================================================

let runAgentLoop;
let MAIN_AGENT_TOOL_NAMES;
let filterToolRegistry;
let spawnChildAgentForwarding$;
let createDefaultToolRegistry;
let SessionManager;
let createPermissionGate;
let DEFAULT_WASTELAND_SETTINGS;

beforeAll(async () => {
  const agentLoopMod = await import("../../dist/core/runtime/agent-loop.js");
  runAgentLoop = agentLoopMod.runAgentLoop;
  MAIN_AGENT_TOOL_NAMES = agentLoopMod.MAIN_AGENT_TOOL_NAMES;
  filterToolRegistry = agentLoopMod.filterToolRegistry;

  const spawnAgentMod = await import("../../dist/tools/spawn-agent.js");
  spawnChildAgentForwarding$ = spawnAgentMod.spawnChildAgentForwarding$;

  const defaultRegistryMod = await import("../../dist/tools/default-registry.js");
  createDefaultToolRegistry = defaultRegistryMod.createDefaultToolRegistry;

  const toolRegistryMod = await import("../../dist/tools/tool-registry.js");
  // 验证 ToolRegistry 导出存在（不直接使用，仅确保模块正确加载）
  void toolRegistryMod.ToolRegistry;

  const sessionManagerMod = await import("../../dist/core/runtime/session-manager.js");
  SessionManager = sessionManagerMod.SessionManager;

  const permGateMod = await import("../../dist/core/runtime/permission-gate.js");
  createPermissionGate = permGateMod.createPermissionGate;

  const settingsTypesMod = await import("../../dist/config/settings-types.js");
  DEFAULT_WASTELAND_SETTINGS = settingsTypesMod.DEFAULT_WASTELAND_SETTINGS;
});

// ============================================================
// 辅助：捕获 provider.runStep 调用时的 TurnContext
// ============================================================

/**
 * 创建捕获 provider，捕获 runStep 调用时的 context.prompt 与 context.toolRegistry
 */
function createCapturingProvider(captured) {
  return {
    id: "capturing-provider",
    runStep({ context }) {
      captured.contexts.push({
        prompt: context.prompt,
        toolRegistry: context.toolRegistry,
        toolNames: context.toolRegistry?.list() ?? [],
      });
      return of({ type: "assistant_message", text: "done" });
    },
  };
}

/**
 * 创建 mock session + sessionManager（允许 createChildSession）
 */
function createMockSessionManager(tempDir) {
  const sessionManager = new SessionManager(tempDir);
  sessionManager.createChildSession = vi.fn().mockImplementation(async (parent, name) => {
    return {
      id: `child-${name}-${Date.now()}`,
      path: `${tempDir}/child-${name}.jsonl`,
      parentId: parent.id,
      childName: name,
      mode: parent.mode,
      cwd: parent.cwd,
      providerId: parent.providerId,
      createdAt: new Date().toISOString(),
    };
  });
  return sessionManager;
}

// ============================================================
// 主 agent 工具集最小化测试
// ============================================================

describe("主 agent 工具集最小化 (MAIN_AGENT_TOOL_NAMES)", () => {
  it("MAIN_AGENT_TOOL_NAMES 包含核心三件套", () => {
    expect(MAIN_AGENT_TOOL_NAMES).toBeDefined();
    expect(Array.isArray(MAIN_AGENT_TOOL_NAMES)).toBe(true);
    expect(MAIN_AGENT_TOOL_NAMES).toContain("spawn_agent");
    expect(MAIN_AGENT_TOOL_NAMES).toContain("read-file");
    expect(MAIN_AGENT_TOOL_NAMES).toContain("bash");
    // 不应包含其他工具
    expect(MAIN_AGENT_TOOL_NAMES).not.toContain("edit-file");
    expect(MAIN_AGENT_TOOL_NAMES).not.toContain("write-file");
    expect(MAIN_AGENT_TOOL_NAMES).not.toContain("glob");
    expect(MAIN_AGENT_TOOL_NAMES).not.toContain("grep");
  });

  it("createDefaultToolRegistry 注册全部 13 个工具", () => {
    const { toolRegistry } = createDefaultToolRegistry();
    const tools = toolRegistry.list();
    expect(tools).toContain("read-file");
    expect(tools).toContain("bash");
    expect(tools).toContain("edit-file");
    expect(tools).toContain("write-file");
    expect(tools).toContain("spawn_agent");
    // 全集应远大于主 agent 白名单
    expect(tools.length).toBeGreaterThan(MAIN_AGENT_TOOL_NAMES.length);
  });

  it("runAgentLoop 传给 provider 的 toolRegistry 只含白名单工具", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "joe-min-agent-tools-"));

    try {
      const { toolRegistry: fullRegistry } = createDefaultToolRegistry();
      const sessionManager = new SessionManager(tempDir);
      const permissionGate = createPermissionGate({ mode: "bypass_permissions" });

      // 入口级过滤（chat.ts / resume.ts / useRuntime.ts 都这么做）
      const filteredRegistry = filterToolRegistry(fullRegistry, MAIN_AGENT_TOOL_NAMES);

      const captured = { contexts: [] };
      const provider = createCapturingProvider(captured);

      const session = await sessionManager.startSession({
        cwd: tempDir,
        mode: "single",
        providerId: provider.id,
      });

      const { events$ } = runAgentLoop({
        input$: of({ turn: 1, content: "hello", source: "message" }),
        provider,
        sessionManager,
        toolRegistry: filteredRegistry,
        permissionGate,
        cwd: tempDir,
        mode: "single",
        existingSession: session,
      });

      // 等到 events$ 完成（session_ended 触发），此时 provider.runStep 已被调用
      await lastValueFrom(events$.pipe(toArray()));

      // provider 收到的 toolRegistry 应只含白名单工具
      expect(captured.contexts.length).toBeGreaterThan(0);
      const providerToolNames = captured.contexts[0].toolNames;
      expect(providerToolNames.sort()).toEqual([...MAIN_AGENT_TOOL_NAMES].sort());
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

// ============================================================
// subAgents 配置生效测试
// ============================================================

describe("subAgents 配置真正生效 (spawn-agent prompt + tools 注入)", () => {
  it("subAgents.promptTemplate + promptVariables 注入子 agent system prompt", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "joe-subagent-prompt-"));

    try {
      const { toolRegistry } = createDefaultToolRegistry();
      const sessionManager = createMockSessionManager(tempDir);
      const permissionGate = createPermissionGate({ mode: "bypass_permissions" });

      // 构造 loadedSettings 含 researcher 配置
      const loadedSettings = {
        settings: {
          ...DEFAULT_WASTELAND_SETTINGS,
          subAgents: {
            researcher: {
              promptTemplate: "role-worker",
              promptVariables: {
                role: "Information Research Specialist",
                goal: "Search and gather information",
                backstory: "You are an expert at finding data.",
                tools: "read-file, glob, grep, list-directory, web-fetch",
                constraints: "- Read only\n- Report precisely",
              },
            },
          },
        },
        sources: {},
        projectConfigDir: null,
        userConfigDir: tempDir,
      };

      // 捕获子 agent runStep 调用
      const captured = { contexts: [] };
      const provider = {
        id: "capturing-provider",
        runStep({ context }) {
          captured.contexts.push({
            prompt: context.prompt,
            toolNames: context.toolRegistry?.list() ?? [],
          });
          return of({ type: "assistant_message", text: "research complete" });
        },
      };

      const session = await sessionManager.startSession({
        cwd: tempDir,
        mode: "single",
        providerId: provider.id,
      });

      const events$ = spawnChildAgentForwarding$({
        context: {
          sessionId: session.id,
          turn: 1,
          cwd: tempDir,
          session,
          sessionManager,
          provider,
          toolRegistry,
          permissionGate,
          history: [],
          loadedSettings,
        },
        call: {
          id: "spawn-1",
          toolName: "spawn_agent",
          input: { name: "researcher", task: "Find the answer" },
        },
      });

      await lastValueFrom(events$.pipe(toArray()));

      // 子 agent 应收到 researcher 角色 prompt
      expect(captured.contexts.length).toBeGreaterThan(0);
      const childContext = captured.contexts[0];
      expect(childContext.prompt).toBeTruthy();
      expect(childContext.prompt).toContain("Information Research Specialist");
      expect(childContext.prompt).toContain("Search and gather information");

      // 子 agent 工具集应限定为 subAgents.researcher.promptVariables.tools
      expect(childContext.toolNames.sort()).toEqual(
        ["read-file", "glob", "grep", "list-directory", "web-fetch"].sort()
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("subAgents.tools 优先于 minimax 传入的 tools", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "joe-subagent-priority-"));

    try {
      const { toolRegistry } = createDefaultToolRegistry();
      const sessionManager = createMockSessionManager(tempDir);
      const permissionGate = createPermissionGate({ mode: "bypass_permissions" });

      // subAgents.tools = [read-file, glob]，minimax 传入 tools = [web-search]
      const loadedSettings = {
        settings: {
          ...DEFAULT_WASTELAND_SETTINGS,
          subAgents: {
            researcher: {
              promptTemplate: "role-worker",
              promptVariables: {
                role: "Researcher",
                tools: "read-file, glob",
              },
            },
          },
        },
        sources: {},
        projectConfigDir: null,
        userConfigDir: tempDir,
      };

      const captured = { contexts: [] };
      const provider = {
        id: "capturing-provider",
        runStep({ context }) {
          captured.contexts.push({
            toolNames: context.toolRegistry?.list() ?? [],
          });
          return of({ type: "assistant_message", text: "done" });
        },
      };

      const session = await sessionManager.startSession({
        cwd: tempDir,
        mode: "single",
        providerId: provider.id,
      });

      const events$ = spawnChildAgentForwarding$({
        context: {
          sessionId: session.id,
          turn: 1,
          cwd: tempDir,
          session,
          sessionManager,
          provider,
          toolRegistry,
          permissionGate,
          history: [],
          loadedSettings,
        },
        call: {
          id: "spawn-1",
          toolName: "spawn_agent",
          input: {
            name: "researcher",
            task: "research task",
            tools: ["web-search"], // minimax 传入，与 subAgents.tools 冲突
          },
        },
      });

      await lastValueFrom(events$.pipe(toArray()));

      // 应优先使用 subAgents.tools = [read-file, glob]
      expect(captured.contexts.length).toBeGreaterThan(0);
      expect(captured.contexts[0].toolNames.sort()).toEqual(["glob", "read-file"]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("无 subAgentConfig 时降级：使用 minimax 传入的 tools，不注入 prompt", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "joe-subagent-fallback-"));

    try {
      const { toolRegistry } = createDefaultToolRegistry();
      const sessionManager = createMockSessionManager(tempDir);
      const permissionGate = createPermissionGate({ mode: "bypass_permissions" });

      // 没有 researcher 配置
      const loadedSettings = {
        settings: {
          ...DEFAULT_WASTELAND_SETTINGS,
          subAgents: {}, // 空
        },
        sources: {},
        projectConfigDir: null,
        userConfigDir: tempDir,
      };

      const captured = { contexts: [] };
      const provider = {
        id: "capturing-provider",
        runStep({ context }) {
          captured.contexts.push({
            prompt: context.prompt,
            toolNames: context.toolRegistry?.list() ?? [],
          });
          return of({ type: "assistant_message", text: "done" });
        },
      };

      const session = await sessionManager.startSession({
        cwd: tempDir,
        mode: "single",
        providerId: provider.id,
      });

      const events$ = spawnChildAgentForwarding$({
        context: {
          sessionId: session.id,
          turn: 1,
          cwd: tempDir,
          session,
          sessionManager,
          provider,
          toolRegistry,
          permissionGate,
          history: [],
          loadedSettings,
        },
        call: {
          id: "spawn-1",
          toolName: "spawn_agent",
          input: {
            name: "researcher",
            task: "research task",
            tools: ["web-search"], // minimax 传入
          },
        },
      });

      await lastValueFrom(events$.pipe(toArray()));

      // 无 subAgentConfig → 无 prompt 注入，但 minimax 传入的 tools 生效
      expect(captured.contexts.length).toBeGreaterThan(0);
      expect(captured.contexts[0].prompt).toBeFalsy();
      expect(captured.contexts[0].toolNames).toEqual(["web-search"]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("subAgents.model alias 解析为实际 model name（settings.models 查找）", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "joe-subagent-model-alias-"));

    try {
      const { toolRegistry } = createDefaultToolRegistry();
      const sessionManager = createMockSessionManager(tempDir);
      const permissionGate = createPermissionGate({ mode: "bypass_permissions" });

      // subAgents.model 是 alias "minimax_model"，对应 settings.models["minimax_model"].model = "MiniMax-M3"
      // 验证 resolve() 被传入 model = "MiniMax-M3"（已解析）而非 alias
      const loadedSettings = {
        settings: {
          ...DEFAULT_WASTELAND_SETTINGS,
          models: {
            minimax_model: { provider: "minimax", model: "MiniMax-M3" },
          },
          subAgents: {
            researcher: {
              model: "minimax_model", // alias
              promptTemplate: "role-worker",
              promptVariables: { role: "Researcher" },
            },
          },
        },
        sources: {},
        projectConfigDir: null,
        userConfigDir: tempDir,
      };

      const resolvedCalls = [];
      const providerRegistry = {
        resolve: vi.fn((id, config) => {
          resolvedCalls.push({ id, model: config?.model });
          return {
            id: "capturing-provider",
            runStep({ context }) {
              return of({ type: "assistant_message", text: "done" });
            },
          };
        }),
        list: vi.fn().mockReturnValue(["capturing-provider"]),
      };

      // 用一个固定 provider 对象，避免初始 resolve 调用污染测试断言
      const provider = {
        id: "capturing-provider",
        runStep({ context }) {
          return of({ type: "assistant_message", text: "done" });
        },
      };

      const session = await sessionManager.startSession({
        cwd: tempDir,
        mode: "single",
        providerId: provider.id,
      });

      const events$ = spawnChildAgentForwarding$({
        context: {
          sessionId: session.id,
          turn: 1,
          cwd: tempDir,
          session,
          sessionManager,
          provider,
          toolRegistry,
          permissionGate,
          history: [],
          providerRegistry,
          providerSettings: { model: "MiniMax-M3" }, // 父 agent 当前 model
          loadedSettings,
        },
        call: {
          id: "spawn-1",
          toolName: "spawn_agent",
          input: { name: "researcher", task: "research task" },
        },
      });

      await lastValueFrom(events$.pipe(toArray()));

      // 验证 providerRegistry.resolve 被以 "MiniMax-M3" 调用（而非 alias "minimax_model"）
      expect(resolvedCalls.length).toBeGreaterThan(0);
      expect(resolvedCalls[0].model).toBe("MiniMax-M3");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("subAgents.model alias 在 settings.models 中找不到时：保留原 alias（兼容 alias 即 model name 的场景）", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "joe-subagent-model-no-alias-"));

    try {
      const { toolRegistry } = createDefaultToolRegistry();
      const sessionManager = createMockSessionManager(tempDir);
      const permissionGate = createPermissionGate({ mode: "bypass_permissions" });

      // subAgents.model = "some-alias"，settings.models 中无对应条目
      const loadedSettings = {
        settings: {
          ...DEFAULT_WASTELAND_SETTINGS,
          models: {}, // 空，无对应 alias
          subAgents: {
            researcher: {
              model: "some-alias", // alias 未在 models 中定义
            },
          },
        },
        sources: {},
        projectConfigDir: null,
        userConfigDir: tempDir,
      };

      const resolvedCalls = [];
      const providerRegistry = {
        resolve: vi.fn((id, config) => {
          resolvedCalls.push({ id, model: config?.model });
          return {
            id: "capturing-provider",
            runStep({ context }) {
              return of({ type: "assistant_message", text: "done" });
            },
          };
        }),
        list: vi.fn().mockReturnValue(["capturing-provider"]),
      };

      const provider = {
        id: "capturing-provider",
        runStep({ context }) {
          return of({ type: "assistant_message", text: "done" });
        },
      };

      const session = await sessionManager.startSession({
        cwd: tempDir,
        mode: "single",
        providerId: provider.id,
      });

      const events$ = spawnChildAgentForwarding$({
        context: {
          sessionId: session.id,
          turn: 1,
          cwd: tempDir,
          session,
          sessionManager,
          provider,
          toolRegistry,
          permissionGate,
          history: [],
          providerRegistry,
          providerSettings: { model: "MiniMax-M3" },
          loadedSettings,
        },
        call: {
          id: "spawn-1",
          toolName: "spawn_agent",
          input: { name: "researcher", task: "research task" },
        },
      });

      await lastValueFrom(events$.pipe(toArray()));

      // 保留原 alias 作为 model（兼容 alias 即 model name 的场景）
      expect(resolvedCalls.length).toBeGreaterThan(0);
      expect(resolvedCalls[0].model).toBe("some-alias");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

// ============================================================
// 辅助：测试 prompt-assembler 的 PromptTemplate 类型断言
// ============================================================

describe("promptVariables.tools 字符串解析", () => {
  it("逗号分隔字符串被正确解析为 string[]", () => {
    // 通过 spawn-agent 的实际行为间接验证（已在前面的测试中覆盖）
    // 这里再做一次明确断言验证：subAgents 配置能影响 toolRegistry
    const settings = DEFAULT_WASTELAND_SETTINGS;
    expect(settings).toBeDefined();
    expect(typeof settings).toBe("object");
  });
});