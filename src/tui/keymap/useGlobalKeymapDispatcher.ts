import { useEffect } from 'react';
import { useInput, useApp } from 'ink';
import fs from 'node:fs';
import path from 'node:path';
import { resolveUserConfigDir } from '@config/paths.js';
import { getKeymapRegistry } from './index.js';
import { buildTabs, selectTabViewFilter } from '../components/AgentTabs.js';
import { handlePermissionKey } from '../components/chat/PermissionPromptBar.js';
import { copyToClipboard } from '../clipboard/index.js';
import type { AppState, PageName, FocusArea, HelpView } from '../context/AppContext.js';
import type { TuiRuntimeContext } from '../types.js';

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
          id: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: new Date().toISOString(),
          agentId: 'system',
          type: 'system' as const,
          content,
        },
      ],
    },
  }));
}

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

export interface UseGlobalKeymapDispatcherProps {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  runtime: TuiRuntimeContext;
  cyclePermissionMode: () => void;
  setCurrentPage: (page: PageName) => void;
  setFocusArea: (area: FocusArea) => void;
  setInputMode: (mode: boolean) => void;
  setExitConfirmPending: (pending: boolean) => void;
  setShowHelp: (view: HelpView) => void;
  sendMessage?: (content: string) => void | Promise<void>;
  isInputEmpty?: () => boolean;
}

export function useGlobalKeymapDispatcher({
  state,
  setState,
  runtime,
  cyclePermissionMode,
  setCurrentPage,
  setFocusArea,
  setInputMode,
  setExitConfirmPending,
  setShowHelp,
  sendMessage,
  isInputEmpty,
}: UseGlobalKeymapDispatcherProps): void {
  const { exit } = useApp();

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

  useInput((input, key) => {
    // 0. 当有权限确认等待时，赋予单键拦截（1/2/3/y/a/n/Esc）最高处理优先级，无论当前 focusArea 在何处均能直接响应，彻底根除焦点死锁！
    if (runtime.userInputBridge?.isPending()) {
      if (key.ctrl && (input === 'c' || input === 'C')) {
        if (state.session.isStreaming || state.session.isThinking) {
          if (runtime.abort$) {
            runtime.abort$.next();
            return;
          }
        }
        setExitConfirmPending(true);
        return;
      }

      handlePermissionKey(
        input,
        key,
        state.permission?.pending ?? null,
        runtime,
        state.permissionSelection ?? 0,
        (next) => setState((prev) => ({ ...prev, permissionSelection: next })),
      );
      return;
    }

    // 快捷撤销与重做：在输入模式或正常按键处理中，当输入框为空且按下 Ctrl+Z 时触发 /undo；Ctrl+Y 触发 /redo
    const isBlank = isInputEmpty
      ? isInputEmpty()
      : !state.inputNonEmpty && (!state.inputDraft || state.inputDraft.trim() === '');

    if (key.ctrl && ((key as { name?: string }).name === 'z' || input === 'z' || input === '\x1a')) {
      if (isBlank && sendMessage) {
        void sendMessage('/undo');
        return;
      }
    }

    if (key.ctrl && ((key as { name?: string }).name === 'y' || input === 'y' || input === '\x19')) {
      if (isBlank && sendMessage) {
        void sendMessage('/redo');
        return;
      }
    }

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

    // 7. Ctrl+Y: 非输入模式下一键复制最新助手回答到系统剪贴板 (OSC 52)
    if (!state.inputMode && key.ctrl && (input === 'y' || input === 'Y' || input === '\x19')) {
      const lastAssistant = [...state.session.messages].reverse().find((m) => m.type === 'assistant');
      if (!lastAssistant || !lastAssistant.content) {
        pushSystemMessage(setState, 'ℹ️ 当前没有可复制的助手回答。', 'copy-empty');
        return;
      }
      const ok = copyToClipboard(lastAssistant.content);
      if (ok) {
        pushSystemMessage(setState, '✓ [OSC 52] 已将最新回答正文复制到系统剪贴板！', 'copy-success');
      } else {
        pushSystemMessage(setState, '⚠️ 复制失败：内容为空。', 'copy-fail');
      }
      return;
    }

    // Enter 重新进入输入模式
    if (key.return && shouldEnterInputModeOnReturn(state)) {
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
}
