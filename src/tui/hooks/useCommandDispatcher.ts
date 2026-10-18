import { useCallback } from 'react';
import { Buffer } from 'node:buffer';
import { executeCommand, isLocalCommand, type ActionResult } from '@core/shared/command-executor.js';
import { getCommandManager } from '@core/shared/command-manager.js';
import { routeLogsCommand, toPageName } from '../route-logs-command.js';
import { updateRuntimeMode, updateRuntimePermissionMode } from '@config/config-writer.js';
import { setAgentMode } from '@config/agent-mode-state.js';
import type { PermissionMode } from '@core/engine/permission-gate.js';
import { t } from '@locales/index.js';
import { buildTabs, selectTabViewFilter, type AgentTab } from '../components/AgentTabs.js';
import type { AppState, PageName, HelpView, LogPageFilter } from '../context/AppContext.js';
import type { TuiRuntimeContext } from '../types.js';

export interface UseCommandDispatcherProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  runtime: TuiRuntimeContext;
  rawSendMessage: (content: string) => void;
  peekTurn: () => number;
  setCurrentPage: (page: PageName) => void;
  setExitConfirmPending: (pending: boolean) => void;
  setShowHelp: (view: HelpView) => void;
  setLogPageFilter: (patch: Partial<LogPageFilter>) => void;
}

export interface UseCommandDispatcherReturn {
  sendMessage: (content: string) => Promise<void>;
  cyclePermissionMode: () => void;
}

function pushSystemMessage(
  setState: React.Dispatch<React.SetStateAction<AppState>>,
  content: string,
  prefix = 'system',
): void {
  setState((prev) => ({
    ...prev,
    session: {
      ...prev.session,
      messages: [
        ...prev.session.messages,
        {
          id: `${prefix}-${Date.now()}`,
          timestamp: new Date().toISOString(),
          agentId: 'system',
          type: 'system' as const,
          content,
        },
      ],
    },
  }));
}

export function useCommandDispatcher({
  state,
  setState,
  runtime,
  rawSendMessage,
  peekTurn,
  setCurrentPage,
  setExitConfirmPending,
  setShowHelp,
  setLogPageFilter,
}: UseCommandDispatcherProps): UseCommandDispatcherReturn {
  const resetLogFilter = useCallback(() => {
    setState((prev) => ({ ...prev, logPageFilter: {} }));
  }, [setState]);

  // Logs page 命令分发（注入 i18n 帮助文本）
  const dispatchLogsRoute = useCallback(
    (content: string): boolean => {
      const trimmed = content.trim();
      if (!trimmed.startsWith('/')) return false;
      const parts = trimmed.slice(1).split(/\s+/);
      const cmd = parts[0] ?? '';
      const cmdDef = getCommandManager().get(cmd);
      if (cmdDef?.name !== '/logs') return false;

      const helpText = t('skills.logsHelp.helpText');
      return routeLogsCommand(cmd, parts.slice(1), {
        dispatchPage: (p) => setCurrentPage(toPageName(p)),
        applyFilter: setLogPageFilter,
        resetFilter: resetLogFilter,
        echo: (msg) => pushSystemMessage(setState, msg, 'logs'),
        helpText,
      });
    },
    [setCurrentPage, setLogPageFilter, resetLogFilter, setState],
  );

  // 设置指定权限模式
  const applyPermissionMode = useCallback(
    (targetMode: PermissionMode) => {
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
    },
    [runtime, setState],
  );

  // 权限模式循环切换辅助（Shift+Tab 快捷键与 /permission 命令共用）
  const cyclePermissionMode = useCallback(() => {
    const modes: ReadonlyArray<PermissionMode> = ['default', 'accept_edits', 'bypass_permissions'];
    const currentMode = (state.config.permissionMode as PermissionMode) || 'default';
    const nextIdx = (modes.indexOf(currentMode) + 1) % modes.length;
    applyPermissionMode(modes[nextIdx] ?? 'default');
  }, [state.config.permissionMode, applyPermissionMode]);

  // 本地命令拦截的 sendMessage 包装
  const sendMessage = useCallback(
    async (content: string) => {
      // 优先处理交互式权限确认/用户输入桥接
      if (runtime.userInputBridge?.isPending()) {
        runtime.userInputBridge.provideInput(content.trim());
        return;
      }

      // 优先 /logs 系列路由
      if (dispatchLogsRoute(content)) {
        return;
      }

      const trimmedContent = content.trim();

      // 处理 /stop 与 /cancel 命令：中止当前生成流
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
          applyPermissionMode('default');
        } else if (arg === 'accept_edits' || arg === 'edit' || arg === 'edits') {
          applyPermissionMode('accept_edits');
        } else if (arg === 'bypass_permissions' || arg === 'bypass' || arg === 'skip' || arg === 'all') {
          applyPermissionMode('bypass_permissions');
        } else {
          pushSystemMessage(
            setState,
            `⚠️ 无效的权限模式: "${arg}"。可选值: default | accept_edits | bypass_permissions`,
            'perm-invalid',
          );
        }
        return;
      }

      // 处理 /copy 复制命令
      if (firstWord === '/copy' || firstWord === '/cp') {
        const lastAssistant = [...state.session.messages].reverse().find((m) => m.type === 'assistant');
        if (!lastAssistant || !lastAssistant.content) {
          pushSystemMessage(setState, 'ℹ️ 当前没有可复制的助手回答。', 'copy-empty');
          return;
        }

        const cleanContent = lastAssistant.content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

        if (process.stdout.isTTY) {
          const b64 = Buffer.from(cleanContent, 'utf8').toString('base64');
          process.stdout.write(`\x1b]52;c;${b64}\x07`);
        }

        pushSystemMessage(
          setState,
          `✓ 已将最新回答（共 ${cleanContent.length} 字符）复制到系统剪贴板！`,
          'copy-success',
        );
        return;
      }

      // 处理 /tab 和 /agent 切换命令
      if (firstWord === '/tab' || firstWord === '/agent') {
        const arg = trimmedContent.split(/\s+/)[1];
        const tabs = buildTabs(state.session.agents);
        if (!arg) {
          const listStr = tabs
            .map((t, idx) => `[Alt+${idx + 1}: ${t.isMain ? 'Main Agent' : t.name}]`)
            .join('  ');
          pushSystemMessage(
            setState,
            `当前可用 Agent 列表：\n${listStr}\n提示：按 Alt+1~${tabs.length} 或输入 /tab <序号> 直接切换。`,
            'tab-list',
          );
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
          pushSystemMessage(
            setState,
            `✓ 已切换至视口: [${targetTab.isMain ? 'Main Agent' : targetTab.name}]`,
            'tab-switch',
          );
        } else {
          pushSystemMessage(setState, `⚠️ 未找到匹配的 Agent: "${arg}"。`, 'tab-err');
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

        if (result.type === 'output' && result.output) {
          pushSystemMessage(setState, result.output, 'local');
        }

        if (result.type === 'action') {
          const actionResult = result as ActionResult;

          if (actionResult.needsClearScreen) {
            setState((prev) => ({ ...prev, session: { ...prev.session, messages: [] } }));
          }

          if (actionResult.needsExit) {
            setExitConfirmPending(true);
          }

          if (actionResult.pageTransition) {
            setCurrentPage(actionResult.pageTransition as PageName);
          }

          if (actionResult.showHelpDialog) {
            setShowHelp(actionResult.showHelpDialog as HelpView);
          }

          if (actionResult.modeSwitch) {
            const echoModeMessage = (msg: string): void => pushSystemMessage(setState, msg, 'mode');

            const arg = content.trim().slice(1).split(/\s+/)[1];
            if (arg !== 'single' && arg !== 'multi') {
              echoModeMessage(t('commands.modeCommand.invalid', { mode: arg ?? '' }));
              return;
            }
            const targetMode = arg;
            setAgentMode(targetMode);
            setState((prev) => ({
              ...prev,
              config: {
                ...prev.config,
                mode: targetMode,
              },
            }));
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

          const skillActionHandlers: Record<string, string> = {
            context: t('commands.skillCommand.context'),
            status: t('commands.skillCommand.status'),
            init: t('commands.skillCommand.init'),
            review: t('commands.skillCommand.review'),
            skills: t('commands.skillCommand.skills'),
          };
          const skillMsg = skillActionHandlers[actionResult.action];
          if (skillMsg) {
            pushSystemMessage(setState, skillMsg, actionResult.action);
          }
        }

        return;
      }

      // 非本地命令，发送到 agent loop 并在本地乐观回显
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
    [
      runtime,
      dispatchLogsRoute,
      cyclePermissionMode,
      applyPermissionMode,
      state.session.messages,
      state.session.agents,
      setExitConfirmPending,
      setCurrentPage,
      setShowHelp,
      peekTurn,
      rawSendMessage,
      setState,
    ],
  );

  return { sendMessage, cyclePermissionMode };
}
