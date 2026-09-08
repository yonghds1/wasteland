import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useInput, useApp, useStdout } from 'ink';
import { ChatArea } from './components/ChatArea.js';
import { LogsPage } from './components/LogsPage.js';
import { LogBusProvider } from './components/LogBusProvider.js';
import { AppContext, type AppState, type PageName, type FocusArea, type HelpView, type LogPageFilter } from './context/AppContext.js';
import { useRuntimeEvents } from './hooks/useRuntimeEvents.js';
import { useUserInput } from './hooks/useUserInput.js';
import { executeCommand, isLocalCommand, type ActionResult } from '@core/shared/command-executor.js';
import { getCommandManager } from '@core/shared/command-manager.js';
import { routeLogsCommand, toPageName } from './route-logs-command.js';
import fs from 'node:fs';
import path from 'node:path';
import { resolveUserConfigDir } from '@config/paths.js';
import { getKeymapRegistry } from './keymap/index.js';
import { updateRuntimeMode, updateRuntimePermissionMode } from '@config/config-writer.js';
import { setAgentMode } from '@config/agent-mode-state.js';
import type { PermissionMode } from '@core/engine/permission-gate.js';
import { t } from '@locales/index.js';
import type { TuiRuntimeContext, TuiFullConfig } from './types.js';
import { buildTabs, selectTabViewFilter, type AgentTab } from './components/AgentTabs.js';

export function shouldEnterInputModeOnReturn(state: {
  inputMode: boolean;
  showHelp: HelpView;
  exitConfirmPending: boolean;
  focusArea: FocusArea;
}): boolean {
  return (
    !state.inputMode &&
    state.showHelp === null &&
    !state.exitConfirmPending &&
    state.focusArea !== 'agentTabs'
  );
}

// 初始状态
const createInitialState = (
  config: TuiRuntimeContext['config'],
  session: TuiRuntimeContext['session'],
  providerId: string,
  fullConfig: TuiFullConfig
): AppState => ({
  currentPage: 'session',
  focusArea: 'inputBar', // 默认焦点在输入框
  inputMode: true, // 默认进入输入模式
  exitConfirmPending: false,
  showHelp: null,
  filterMode: false,
  editMode: false,
  permissionSelection: 0,
  permission: { pending: null, queue: [], history: [] },

  logPageFilter: {},

  session: {
    agents: [],
    messages: [],
    tools: [],
    isThinking: false,
    isStreaming: false,
    streamingContent: '',
    streamingMessageId: null,
    permission: { pending: null, queue: [], history: [] },
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
    },
    context: {
      isCompacting: false,
    },
  },

  debug: {
    traces: [],
    filter: {},
  },

  config,
  fullConfig,
  configEdit: {
    field: null,
    originalValue: '',
  },
  configHasChanges: false,

  sessionMetadata: {
    id: session.id,
    providerId,
  },
});

interface AppProps {
  runtime: TuiRuntimeContext;
}

export function App({ runtime }: AppProps): React.ReactElement {
  const [state, setState] = useState<AppState>(() =>
    createInitialState(runtime.config, runtime.session, runtime.providerId, runtime.fullConfig)
  );

  // 终端标题通知：根据状态设置 window title，让用户在 tab/任务栏一眼看到状态
  // - 流式/子 Agent 执行中：⠋ wasteland
  // - 思考中：⏳ wasteland
  // 终端标题通知：根据状态设置 window title，让用户在 tab/任务栏一眼看到状态（对齐 OpenCode 规范）
  const { stdout } = useStdout();

  const isSubAgentRunning = useMemo(
    () => state.session.agents.some((a) => a.depth >= 1 && a.status === 'running'),
    [state.session.agents]
  );

  useEffect(() => {
    const isPendingPermission = Boolean(runtime.userInputBridge?.isPending());
    const runningTool = state.session.tools.find((t) => t.status === 'running');
    const isThinking = state.session.isThinking && !isPendingPermission;
    const isStreaming = state.session.isStreaming && !isPendingPermission;

    let statusText = 'wasteland';
    if (isPendingPermission) {
      const toolName = runningTool?.name ?? 'bash';
      statusText = `? Permission (${toolName}) · wasteland`;
    } else if (runningTool) {
      statusText = `Run ${runningTool.name} · wasteland`;
    } else if (isSubAgentRunning) {
      statusText = `SubAgent · wasteland`;
    } else if (isThinking) {
      statusText = `Thinking · wasteland`;
    } else if (isStreaming) {
      statusText = `Generating... · wasteland`;
    }

    // 事件驱动写入：仅在状态真正变更时写入 1 次，彻底告别 100ms 高频定时器对宿主机任务栏造成的剧烈抖动与闪烁
    stdout?.write(`\x1b]0;${statusText}\x07`);
  }, [
    state.session.isThinking,
    state.session.isStreaming,
    state.session.tools,
    isSubAgentRunning,
    runtime.userInputBridge,
    stdout,
  ]);

  // 加载用户自定义快捷键 (~/.wasteland/keybindings.json)
  useEffect(() => {
    try {
      const userConfigDir = resolveUserConfigDir();
      const keybindingsPath = path.join(userConfigDir, 'keybindings.json');
      if (fs.existsSync(keybindingsPath)) {
        const content = fs.readFileSync(keybindingsPath, 'utf8');
        getKeymapRegistry().loadUserBindings(JSON.parse(content));
      }
    } catch {
      // ignore
    }
  }, []);

  // 订阅 runtime 事件
  useRuntimeEvents(runtime.events$, runtime.debug$, setState, runtime.fullConfig.multiAgent);

  // 用户输入处理（带本地命令拦截）
  const { sendMessage: rawSendMessage, peekTurn } = useUserInput(runtime.input$);

  const setCurrentPage = useCallback((page: PageName) => {
    setState((prev) => ({ ...prev, currentPage: page, focusArea: 'inputBar' }));
  }, []);

  const setFocusArea = useCallback((area: FocusArea) => {
    setState((prev) => ({ ...prev, focusArea: area }));
  }, []);

  const setInputMode = useCallback((mode: boolean) => {
    setState((prev) => ({ ...prev, inputMode: mode }));
  }, []);

  const setExitConfirmPending = useCallback((pending: boolean) => {
    setState((prev) => ({ ...prev, exitConfirmPending: pending }));
  }, []);

  const setShowHelp = useCallback((view: HelpView) => {
    setState((prev) => ({ ...prev, showHelp: view }));
  }, []);

  // setLogPageFilter 与 dispatchLogsRoute 必须在 sendMessage 之前声明，
  // 否则 sendMessage 闭包会拿到 TDZ 引用。
  const setLogPageFilter = useCallback((patch: Partial<LogPageFilter>) => {
    setState((prev) => ({
      ...prev,
      logPageFilter: { ...prev.logPageFilter, ...patch },
    }));
  }, []);

  // 清空所有 log filter（/logs all 使用）
  const resetLogFilter = useCallback(() => {
    setState((prev) => ({ ...prev, logPageFilter: {} }));
  }, []);

  // AgentTabs filter 切换：undefined = 全部消息（Main 选中）
  const setViewFilter = useCallback((filter: string | undefined) => {
    setState((prev) => ({ ...prev, viewFilter: filter }));
  }, []);

  // Logs page 命令分发（注入 i18n 帮助文本）
  const dispatchLogsRoute = useCallback(
    (content: string): boolean => {
      const trimmed = content.trim();
      if (!trimmed.startsWith('/')) return false;
      const parts = trimmed.slice(1).split(/\s+/);
      const cmd = parts[0] ?? '';
      // 从 CommandManager 单一来源判断是否为 logs 根命令
      const cmdDef = getCommandManager().get(cmd);
      if (cmdDef?.name !== '/logs') return false;

      const helpText = t('skills.logsHelp.helpText');
      const echoInChat = (msg: string): void => {
        setState((prev) => ({
          ...prev,
          session: {
            ...prev.session,
            messages: [
              ...prev.session.messages,
              {
                id: `logs-${Date.now()}`,
                timestamp: new Date().toISOString(),
                agentId: 'system',
                type: 'system' as const,
                content: msg,
              },
            ],
          },
        }));
      };

      const handled = routeLogsCommand(
        cmd,
        parts.slice(1),
        {
          dispatchPage: (p) => setCurrentPage(toPageName(p)),
          applyFilter: setLogPageFilter,
          resetFilter: resetLogFilter,
          echo: echoInChat,
          helpText,
        },
      );
      return handled;
    },
    [setCurrentPage, setLogPageFilter, resetLogFilter],
  );

  // 权限模式循环切换辅助（Shift+Tab 快捷键与 /permission 命令共用）
  const cyclePermissionMode = useCallback(() => {
    const modes: ReadonlyArray<PermissionMode> = ['default', 'accept_edits', 'bypass_permissions'];
    const currentMode = (state.config.permissionMode as PermissionMode) || 'default';
    const nextIdx = (modes.indexOf(currentMode) + 1) % modes.length;
    const nextMode = modes[nextIdx] ?? 'default';

    runtime.permissionGate?.setMode?.(nextMode);
    runtime.config.permissionMode = nextMode;

    const notifyMsg =
      nextMode === 'bypass_permissions'
        ? '⚠️ 权限模式已切换为: bypass_permissions (全自动免确认模式)'
        : nextMode === 'accept_edits'
        ? '✏️ 权限模式已切换为: accept_edits (信任编辑模式)'
        : '🛡️ 权限模式已切换为: default (标准安全模式)';

    setState((prev) => ({
      ...prev,
      config: { ...prev.config, permissionMode: nextMode },
      session: {
        ...prev.session,
        messages: [
          ...prev.session.messages,
          {
            id: `perm-${Date.now()}`,
            timestamp: new Date().toISOString(),
            agentId: 'system',
            type: 'system' as const,
            content: notifyMsg,
          },
        ],
      },
    }));

    void updateRuntimePermissionMode(nextMode).catch(() => {});
  }, [state.config.permissionMode, runtime]);

  // 显式设置指定权限模式
  const setExplicitPermissionMode = useCallback((targetMode: PermissionMode) => {
    runtime.permissionGate?.setMode?.(targetMode);
    runtime.config.permissionMode = targetMode;

    const notifyMsg =
      targetMode === 'bypass_permissions'
        ? '⚠️ 权限模式已切换为: bypass_permissions (全自动免确认模式)'
        : targetMode === 'accept_edits'
        ? '✏️ 权限模式已切换为: accept_edits (信任编辑模式)'
        : '🛡️ 权限模式已切换为: default (标准安全模式)';

    setState((prev) => ({
      ...prev,
      config: { ...prev.config, permissionMode: targetMode },
      session: {
        ...prev.session,
        messages: [
          ...prev.session.messages,
          {
            id: `perm-${Date.now()}`,
            timestamp: new Date().toISOString(),
            agentId: 'system',
            type: 'system' as const,
            content: notifyMsg,
          },
        ],
      },
    }));

    void updateRuntimePermissionMode(targetMode).catch(() => {});
  }, [runtime]);

  // 本地命令拦截的 sendMessage 包装
  const sendMessage = useCallback(
    async (content: string) => {
      // 优先处理交互式权限确认/用户输入桥接（如 bash 执行权限确认）
      if (runtime.userInputBridge?.isPending()) {
        runtime.userInputBridge.provideInput(content.trim());
        return;
      }

      // 优先 /logs 系列路由（在 executeCommand 之前，避免 /log 被误判）
      if (dispatchLogsRoute(content)) {
        return;
      }

      const trimmedContent = content.trim();

      // 处理 /stop 命令：中止当前生成流
      if (trimmedContent === '/stop' || trimmedContent === '/cancel') {
        if (runtime.abort$) {
          runtime.abort$.next();
          return;
        }
      }

      const firstWord = trimmedContent.split(/\s+/)[0]?.toLowerCase();
      if (firstWord === '/permission' || firstWord === '/permissions' || firstWord === '/perm') {
        const arg = trimmedContent.split(/\s+/)[1]?.toLowerCase();
        if (!arg) {
          cyclePermissionMode();
        } else if (arg === 'default') {
          setExplicitPermissionMode('default');
        } else if (arg === 'accept_edits' || arg === 'edit' || arg === 'edits') {
          setExplicitPermissionMode('accept_edits');
        } else if (arg === 'bypass_permissions' || arg === 'bypass' || arg === 'skip' || arg === 'all') {
          setExplicitPermissionMode('bypass_permissions');
        } else {
          setState((prev) => ({
            ...prev,
            session: {
              ...prev.session,
              messages: [
                ...prev.session.messages,
                {
                  id: `perm-invalid-${Date.now()}`,
                  timestamp: new Date().toISOString(),
                  agentId: 'system',
                  type: 'system' as const,
                  content: `⚠️ 无效的权限模式: "${arg}"。可选值: default | accept_edits | bypass_permissions`,
                },
              ],
            },
          }));
        }
        return;
      }

      // 处理 /copy 复制命令（Claude Code / OpenCode 模式：将最新大模型回答一键拷入系统剪贴板）
      if (firstWord === '/copy' || firstWord === '/cp') {
        const lastAssistant = [...state.session.messages].reverse().find((m) => m.type === 'assistant');
        if (!lastAssistant || !lastAssistant.content) {
          setState((prev) => ({
            ...prev,
            session: {
              ...prev.session,
              messages: [
                ...prev.session.messages,
                {
                  id: `copy-empty-${Date.now()}`,
                  timestamp: new Date().toISOString(),
                  agentId: 'system',
                  type: 'system' as const,
                  content: 'ℹ️ 当前没有可复制的助手回答。',
                },
              ],
            },
          }));
          return;
        }

        // 提取纯净正文（剥离 <think> 标签）
        const cleanContent = lastAssistant.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

        // 触发 OSC 52 终端剪贴板协议写入
        if (process.stdout.isTTY) {
          const b64 = Buffer.from(cleanContent, 'utf8').toString('base64');
          process.stdout.write(`\x1b]52;c;${b64}\x07`);
        }

        setState((prev) => ({
          ...prev,
          session: {
            ...prev.session,
            messages: [
              ...prev.session.messages,
              {
                id: `copy-success-${Date.now()}`,
                timestamp: new Date().toISOString(),
                agentId: 'system',
                type: 'system' as const,
                content: `✓ 已将最新回答（共 ${cleanContent.length} 字符）复制到系统剪贴板！`,
              },
            ],
          },
        }));
        return;
      }

      // 处理 /tab 和 /agent 切换命令（支持通过序号或名称快速切至目标子 Agent）
      if (firstWord === '/tab' || firstWord === '/agent') {
        const arg = trimmedContent.split(/\s+/)[1];
        const tabs = buildTabs(state.session.agents);
        if (!arg) {
          const listStr = tabs
            .map((t, idx) => `[Alt+${idx + 1}: ${t.isMain ? 'Main Agent' : t.name}]`)
            .join('  ');
          setState((prev) => ({
            ...prev,
            session: {
              ...prev.session,
              messages: [
                ...prev.session.messages,
                {
                  id: `tab-list-${Date.now()}`,
                  timestamp: new Date().toISOString(),
                  agentId: 'system',
                  type: 'system' as const,
                  content: `当前可用 Agent 列表：\n${listStr}\n提示：按 Alt+1~${tabs.length} 或输入 /tab <序号> 直接切换。`,
                },
              ],
            },
          }));
          return;
        }

        const num = parseInt(arg, 10);
        let targetTab: AgentTab | undefined;
        if (!isNaN(num) && num >= 1 && num <= tabs.length) {
          targetTab = tabs[num - 1];
        } else {
          targetTab = tabs.find((t) => t.name.toLowerCase().includes(arg.toLowerCase()));
        }

        if (targetTab) {
          const filter = selectTabViewFilter(targetTab);
          setState((prev) => ({ ...prev, viewFilter: filter }));
          setState((prev) => ({
            ...prev,
            session: {
              ...prev.session,
              messages: [
                ...prev.session.messages,
                {
                  id: `tab-switch-${Date.now()}`,
                  timestamp: new Date().toISOString(),
                  agentId: 'system',
                  type: 'system' as const,
                  content: `✓ 已切换至视口: [${targetTab.isMain ? 'Main Agent' : targetTab.name}]`,
                },
              ],
            },
          }));
        } else {
          setState((prev) => ({
            ...prev,
            session: {
              ...prev.session,
              messages: [
                ...prev.session.messages,
                {
                  id: `tab-err-${Date.now()}`,
                  timestamp: new Date().toISOString(),
                  agentId: 'system',
                  type: 'system' as const,
                  content: `⚠️ 未找到匹配的 Agent: "${arg}"。`,
                },
              ],
            },
          }));
        }
        return;
      }

      // 检查是否为本地命令
      if (isLocalCommand(content)) {
        const result = await executeCommand(content, {
          input: content,
          args: {},
          context: { mode: 'tui' },
        });

        // 添加系统消息到 TUI 显示
        if (result.type === 'output' && result.output) {
          const output = result.output;
          setState((prev) => ({
            ...prev,
            session: {
              ...prev.session,
              messages: [
                ...prev.session.messages,
                {
                  id: `local-${Date.now()}`,
                  timestamp: new Date().toISOString(),
                  agentId: 'system',
                  type: 'system' as const,
                  content: output,
                },
              ],
            },
          }));
        }

        // 处理动作类型结果
        if (result.type === 'action') {
          const actionResult = result as ActionResult;

          // 处理清屏
          if (actionResult.needsClearScreen) {
            setState((prev) => ({ ...prev, session: { ...prev.session, messages: [] } }));
          }

          // 处理退出（由 ExitConfirm 组件处理）
          if (actionResult.needsExit) {
            setExitConfirmPending(true);
          }

          // 处理页面切换
          if (actionResult.pageTransition) {
            setCurrentPage(actionResult.pageTransition as PageName);
          }

          // 处理帮助对话框
          if (actionResult.showHelpDialog) {
            setShowHelp(actionResult.showHelpDialog as HelpView);
          }

          // 处理 /mode：解析参数 → 校验 single|multi → 实时切换 + 异步写回配置
          if (actionResult.modeSwitch) {
          const echoModeMessage = (msg: string): void => {
            setState((prev) => ({
              ...prev,
              session: {
                ...prev.session,
                messages: [
                  ...prev.session.messages,
                  {
                    id: `mode-${Date.now()}`,
                    timestamp: new Date().toISOString(),
                    agentId: 'system',
                    type: 'system' as const,
                    content: msg,
                  },
                ],
              },
            }));
          };

          // 解析 /mode 后的第一个参数
          const arg = content.trim().slice(1).split(/\s+/)[1];
          if (arg !== 'single' && arg !== 'multi') {
            echoModeMessage(t('commands.modeCommand.invalid', { mode: arg ?? '' }));
            return;
          }
          const targetMode = arg;
          // 实时切换：立即更新内存状态，下一个 turn 生效
          setAgentMode(targetMode);
          setState((prev) => ({
            ...prev,
            config: {
              ...prev.config,
              mode: targetMode,
            },
          }));
          // 异步写回 settings.json（持久化，重启后也生效）
          void updateRuntimeMode(targetMode)
            .then(() =>
              echoModeMessage(t('commands.modeCommand.switched', { mode: targetMode }))
            )
            .catch((err: unknown) =>
              echoModeMessage(
                t('commands.modeCommand.failed', {
                  error: err instanceof Error ? err.message : String(err),
                })
              )
            );
        }

          // 处理 skill 类命令（context/status/init/review/skills）：
          // 写入系统消息，提示用户该命令由 SkillExecutor 处理（占位实现）
          const skillActionHandlers: Record<string, string> = {
            context: t('commands.skillCommand.context'),
            status: t('commands.skillCommand.status'),
            init: t('commands.skillCommand.init'),
            review: t('commands.skillCommand.review'),
            skills: t('commands.skillCommand.skills'),
          };
          const skillMsg = skillActionHandlers[actionResult.action];
          if (skillMsg) {
            setState((prev) => ({
              ...prev,
              session: {
                ...prev.session,
                messages: [
                  ...prev.session.messages,
                  {
                    id: `${actionResult.action}-${Date.now()}`,
                    timestamp: new Date().toISOString(),
                    agentId: 'system',
                    type: 'system' as const,
                    content: skillMsg,
                  },
                ],
              },
            }));
          }
        }

        return;
      }

      // 非本地命令，发送到 agent loop。
      // 乐观回显：首个 chunk 到达前（模型 TTFT 常以秒计）界面会白屏，
      // 这里先落本地用户消息 + isThinking，runtime 的 user_turn 到达时去重。
      if (content.trim()) {
        const turn = peekTurn();
        setState((prev) => ({
          ...prev,
          session: {
            ...prev.session,
            isThinking: true,
            messages: [
              ...prev.session.messages,
              {
                id: `msg-user-${turn}-local`,
                timestamp: new Date().toISOString(),
                agentId: prev.sessionMetadata.id,
                type: 'user' as const,
                content: content.trim(),
              },
            ],
          },
        }));
      }
      rawSendMessage(content);
    },
    [rawSendMessage, peekTurn, setExitConfirmPending, setCurrentPage, dispatchLogsRoute, setShowHelp]
  );

  const setFilterMode = useCallback((mode: boolean) => {
    setState((prev) => ({ ...prev, filterMode: mode }));
  }, []);

  const setEditMode = useCallback((mode: boolean) => {
    setState((prev) => ({ ...prev, editMode: mode }));
  }, []);

  const updateConfig = useCallback((updates: Partial<AppState['config']>) => {
    setState((prev) => ({
      ...prev,
      config: { ...prev.config, ...updates },
      configHasChanges: true,
    }));
  }, []);

  const clearTraces = useCallback(() => {
    setState((prev) => ({
      ...prev,
      debug: { ...prev.debug, traces: [] },
    }));
  }, []);

  // 全局键盘处理（统一接入 KeymapRegistry 调度）
  const { exit } = useApp();
  useInput((input, key) => {
    const action = getKeymapRegistry().findAction(input, key, {
      activeModal: state.showHelp ? 'help' : null,
      focusArea: state.focusArea,
      inputMode: state.inputMode,
    });

    // 1. 全局强制退出动作（Ctrl+C）
    if (action === 'app.force_exit') {
      // 若在生成中，优先打断而非退出程序
      if (state.session.isStreaming || state.session.isThinking) {
        if (runtime.abort$) {
          runtime.abort$.next();
          return;
        }
      }

      if (state.exitConfirmPending) {
        exit();
      } else {
        setInputMode(false);
        setExitConfirmPending(true);
      }
      return;
    }

    // 2. 退出确认弹窗处理
    if (state.exitConfirmPending) {
      if (input === 'y' || input === 'Y') {
        exit();
      } else {
        setExitConfirmPending(false);
      }
      return;
    }

    // 3. 模态框关闭动作
    if (action === 'modal.close') {
      setShowHelp(null);
      return;
    }

    // 4. 全局/穿透权限模式切换动作 (Shift+Tab)
    if (action === 'app.cycle_permissions') {
      cyclePermissionMode();
      return;
    }

    // 5. 退出应用动作 (q)
    if (action === 'app.quit') {
      setExitConfirmPending(true);
      return;
    }

    // 6. 页面轮播循环动作 (T)
    if (action === 'app.cycle_page') {
      const cycle: ReadonlyArray<PageName> = ['session', 'sessions', 'logs'];
      const idx = cycle.indexOf(state.currentPage);
      const nextIdx = idx < 0 ? 0 : (idx + 1) % cycle.length;
      const nextPage = cycle[nextIdx];
      if (nextPage) {
        setCurrentPage(nextPage);
      }
      return;
    }

    // Enter 重新进入输入模式
    if (key.return && !state.inputMode && state.showHelp === null && !state.exitConfirmPending) {
      setInputMode(true);
      setFocusArea('inputBar');
      return;
    }

    // Tab / Shift+Tab 在当前页面的可聚焦区域间循环切换
    if (key.tab) {
      const focusCycle: Record<PageName, FocusArea[]> = {
        session: ['inputBar', 'agentTabs'],
        debug: ['traceLog'],
        config: ['configList'],
        sessions: [],
        logs: [],
      };
      const cycle = focusCycle[state.currentPage] ?? [];
      if (cycle.length > 1) {
        const currentIdx = state.focusArea ? cycle.indexOf(state.focusArea) : -1;
        const direction = key.shift ? -1 : 1;
        const nextIdx =
          currentIdx < 0
            ? direction > 0
              ? 0
              : cycle.length - 1
            : (currentIdx + direction + cycle.length) % cycle.length;
        const nextArea = cycle[nextIdx];
        setFocusArea(nextArea);
        // 同步 inputMode：进入输入框自动开启输入模式；离开则关闭
        if (nextArea === 'inputBar') {
          setInputMode(true);
        } else if (state.focusArea === 'inputBar') {
          setInputMode(false);
        }
      }
      return;
    }

    // Esc 双向 toggle（session 页 inputBar ↔ agentTabs，不清 viewFilter；
    // 权限待确认时跳过，Esc 语义归权限卡（允许/拒绝），避免误切焦点）
    if (
      key.escape &&
      state.currentPage === 'session' &&
      state.showHelp === null &&
      !state.exitConfirmPending &&
      !runtime.userInputBridge?.isPending()
    ) {
      if (state.focusArea === 'agentTabs') {
        setFocusArea('inputBar');
        setInputMode(true);
      } else {
        setFocusArea('agentTabs');
        setInputMode(false);
      }
      return;
    }

    // Esc 在 sessions 页退出（回到 session 页，sessions 页没有输入框所以 Esc 走这里）
    if (key.escape && state.currentPage === 'sessions' && !state.exitConfirmPending) {
      setCurrentPage('session');
      return;
    }

    // 8. Alt+1..9 一键直接切换 Agent Tab 视口
    // ESC + [1-9] 序列：用 charCode 显式判断，避免正则控制字符 lint
    let altNum: number | null = null;
    if (key.meta && input && input >= '1' && input <= '9') {
      altNum = parseInt(input, 10);
    } else if (
      input &&
      input.length === 3 &&
      input.charCodeAt(0) === 27 &&
      input.charAt(1) === '[' &&
      input.charAt(2) >= '1' &&
      input.charAt(2) <= '9'
    ) {
      altNum = parseInt(input.charAt(2), 10);
    }

    if (altNum !== null && state.currentPage !== 'logs') {
      const targetIdx = altNum - 1;
      const tabs = buildTabs(state.session.agents);
      if (targetIdx >= 0 && targetIdx < tabs.length) {
        const targetTab = tabs[targetIdx];
        if (!targetTab) return;
        const filter = selectTabViewFilter(targetTab);
        setState((prev) => ({ ...prev, viewFilter: filter }));
        return;
      }
    }
  });

  return (
    <LogBusProvider>
      <AppContext.Provider
        value={{
          state,
          setState,
          setCurrentPage,
          setFocusArea,
          setInputMode,
          setExitConfirmPending,
          setShowHelp,
          setFilterMode,
          setEditMode,
          updateConfig,
          clearTraces,
          setLogPageFilter,
          setViewFilter,
        }}
      >
        {state.currentPage === 'logs' ? (
          <LogsPage />
        ) : (
          <ChatArea runtime={runtime} sendMessage={sendMessage} />
        )}
      </AppContext.Provider>
    </LogBusProvider>
  );
}
