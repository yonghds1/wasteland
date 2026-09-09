/**
 * useLogsKeymap - LogsPage 全键盘交互
 *
 * 从 `LogsPage.tsx` 搬出的本页 useInput 处理（Omnibox 编辑态 / Esc /
 * 上下 Tab / Home End / PgUp PgDn / Enter / / / ] [ / K / Alt+1-3 /
 * G X C T N B / ?），纯搬运零逻辑改动。
 *
 * 约定：入参全部用与 LogsPage 本地同名的解构字段，handler 正文逐字搬运；
 * 新增按键只改本文件，LogsPage 只负责组装 api 对象。
 */

import { useInput } from 'ink';

import type { LogEntry, LogLevel } from '@core/logger/index.js';
import type { SessionSummaryOnDisk } from '@core/logger/file-log-loader.js';
import type { LogExportFormat } from '../components/log-export.js';
import type { UseScrollResult } from '../components/ScrollableBox.js';
import {
  cycleSessionIndex,
  findNextErrorIndex,
  scrollToReveal,
  toggleTimelineMetric,
  type LogsView,
  type TimelineMode,
  type TimelineMetric,
} from '../components/logs-page-utils.js';

export type LogsKeymapApi = {
  // 状态值
  isSearching: boolean;
  view: LogsView;
  timelineMode: TimelineMode;
  timelineMetric: TimelineMetric;
  selectedSessionIdx: number;
  selectedCardIdx: number;
  cardWindowSize: number;
  sessions: SessionSummaryOnDisk[];
  diskSessions: SessionSummaryOnDisk[];
  sessionCards: LogEntry[];
  globalTimelineRecords: Array<{ sessionId: string }>;
  minLevel: LogLevel;
  sessionFilter: string;
  errorFocus: boolean;
  focusedPane: 'left' | 'right';
  keywordFilter: string;
  // setters
  setFocusedPane: (v: 'left' | 'right') => void;
  setSearchDraft: (v: string | ((prev: string) => string)) => void;
  setIsSearching: (v: boolean) => void;
  setSelectedSessionIdx: (v: number) => void;
  setSelectedCardIdx: (v: number) => void;
  setSessionFilter: (v: string) => void;
  setTimelineMode: (v: TimelineMode) => void;
  setView: (v: LogsView) => void;
  setTimelineMetric: (v: (cur: TimelineMetric) => TimelineMetric) => void;
  setShowConversation: (v: boolean | ((cur: boolean) => boolean)) => void;
  setHelpVisible: (v: boolean | ((cur: boolean) => boolean)) => void;
  setExportStatus: (v: string) => void;
  // 回调
  commitSearchDraft: () => void;
  closePage: () => void;
  moveSelection: (target: number) => void;
  resetRightPaneScroll: () => void;
  toggleCardExpand: (key: string) => void;
  handleExport: (format: LogExportFormat) => void;
  cardKeyOf: (entry: LogEntry) => string;
  // 滚动体
  sessionScroll: UseScrollResult;
  cardScroll: UseScrollResult;
  timelineScroll: UseScrollResult;
  globalTimelineScroll: UseScrollResult;
  globalStatsScroll: UseScrollResult;
};

export function useLogsKeymap(api: LogsKeymapApi): void {
  const {
    isSearching,
    view,
    timelineMode,
    timelineMetric,
    selectedSessionIdx,
    selectedCardIdx,
    cardWindowSize,
    sessions,
    diskSessions,
    sessionCards,
    globalTimelineRecords,
    minLevel,
    sessionFilter,
    errorFocus,
    focusedPane,
    keywordFilter,
    setFocusedPane,
    setSearchDraft,
    setIsSearching,
    setSelectedSessionIdx,
    setSelectedCardIdx,
    setSessionFilter,
    setTimelineMode,
    setView,
    setTimelineMetric,
    setShowConversation,
    setHelpVisible,
    setExportStatus,
    commitSearchDraft,
    closePage,
    moveSelection,
    resetRightPaneScroll,
    toggleCardExpand,
    handleExport,
    cardKeyOf,
    sessionScroll,
    cardScroll,
    timelineScroll,
    globalTimelineScroll,
    globalStatsScroll,
  } = api;

  // 本页 useInput
  useInput((inputChar, key) => {
    // 综合搜索框 (Omnibox) 编辑态
    if (isSearching) {
      if (key.return) {
        commitSearchDraft();
        return;
      }
      if (key.escape) {
        setSearchDraft('');
        setIsSearching(false);
        return;
      }
      if (key.backspace || key.delete) {
        setSearchDraft((prev) => prev.slice(0, -1));
        return;
      }
      if (
        inputChar &&
        !key.ctrl &&
        !key.meta &&
        inputChar !== '\r' &&
        inputChar !== '\n' &&
        !key.tab &&
        inputChar.length === 1
      ) {
        setSearchDraft((prev) => prev + inputChar);
      }
      return;
    }

    // Esc → 回到 chat page
    if (key.escape) {
      closePage();
      return;
    }

    // ↑/↓：切换 session（左栏滚动保证选中可见，右栏回到顶部）或右侧上下移动光标
    if (key.upArrow) {
      if (focusedPane === 'right' && view !== 'timeline' && sessionCards.length > 0) {
        const newIdx = Math.max(0, selectedCardIdx - 1);
        setSelectedCardIdx(newIdx);
        if (newIdx < cardScroll.offset) {
          cardScroll.setOffset(newIdx);
        } else if (newIdx >= cardScroll.offset + cardWindowSize) {
          cardScroll.setOffset(newIdx - cardWindowSize + 1);
        }
      } else {
        moveSelection(selectedSessionIdx + 1);
      }
      return;
    }
    if (key.leftArrow) {
      setFocusedPane('left');
      return;
    }
    if (key.rightArrow) {
      setFocusedPane('right');
      return;
    }
    if (key.downArrow) {
      if (focusedPane === 'right' && view !== 'timeline' && sessionCards.length > 0) {
        const newIdx = Math.min(sessionCards.length - 1, selectedCardIdx + 1);
        setSelectedCardIdx(newIdx);
        if (newIdx < cardScroll.offset) {
          cardScroll.setOffset(newIdx);
        } else if (newIdx >= cardScroll.offset + cardWindowSize) {
          cardScroll.setOffset(newIdx - cardWindowSize + 1);
        }
      } else {
        moveSelection(selectedSessionIdx - 1);
      }
      return;
    }

    // Tab / Shift+Tab：在当前 filter 下循环下一个/上一个 session（尾部环绕）。
    // App 全局 Tab handler 对 logs 页 focus cycle 为空（见 App.tsx），不冲突。
    if (key.tab) {
      moveSelection(cycleSessionIndex(selectedSessionIdx, sessions.length, key.shift ? -1 : 1));
      return;
    }

    // Home/End：跳转到右侧日志流最晚/最早位置（cards 最新在上：
    // Home=顶部=最晚，End=底部=最早）。scrollToTop/scrollToBottom 即
    // jumpOffset(totalItems, visible, 'latest'/'earliest') 的等价实现（见导出区）。
    // 时间线视图跳转各自时间线滚动。
    if (key.home) {
      if (view === 'timeline' && timelineMode === 'global') {
        (timelineMetric === 'calls' ? globalTimelineScroll : globalStatsScroll).scrollToTop();
      } else if (view === 'timeline') {
        timelineScroll.scrollToTop();
      } else {
        cardScroll.scrollToTop();
      }
      return;
    }
    if (key.end) {
      if (view === 'timeline' && timelineMode === 'global') {
        (timelineMetric === 'calls' ? globalTimelineScroll : globalStatsScroll).scrollToBottom();
      } else if (view === 'timeline') {
        timelineScroll.scrollToBottom();
      } else {
        cardScroll.scrollToBottom();
      }
      return;
    }

    // PgUp/PgDown：滚动右侧卡片
    if (key.pageUp) {
      cardScroll.scrollUp();
      return;
    }
    if (key.pageDown) {
      cardScroll.scrollDown();
      return;
    }

    // Enter：展开/收起卡片详情
    // 全局时间线（calls 时序）模式下：Enter 定位到顶部可见记录所属 session
    // （切回该 session 的时间线；stats 分布视图不响应，避免滚动偏移语义错位）
    if (key.return) {
      if (view === 'timeline' && timelineMode === 'global' && timelineMetric === 'calls') {
        const firstVisible = globalTimelineRecords[globalTimelineScroll.offset];
        if (firstVisible) {
          const targetId = firstVisible.sessionId;
          // 按 sessionFilter 的过滤规则（.includes 子串）复算收窄后的列表，
          // 再用 sessionId 精确匹配目标索引：即使目标是其他 sessionId 的子串
          // （子串碰撞）也不会定位错；同时按目标所在分页设置选中索引，避免越界。
          const trimmed = targetId.trim();
          const narrowed = trimmed
            ? diskSessions.filter((s) => s.sessionId.includes(trimmed))
            : diskSessions;
          const exactIdx = narrowed.findIndex((s) => s.sessionId === targetId);
          if (exactIdx >= 0) {
            setSelectedSessionIdx(exactIdx);
            // 无限滚动下直接揭示目标行
            sessionScroll.setOffset(
              scrollToReveal(sessionScroll.offset, exactIdx, sessionScroll.maxVisible, narrowed.length),
            );
          }
          setSessionFilter(targetId);
          setTimelineMode('session');
          setView('timeline');
          sessionScroll.scrollToTop();
          resetRightPaneScroll();
        }
        return;
      }
      const selectedCard = sessionCards[selectedCardIdx];
      if (selectedCard) {
        toggleCardExpand(cardKeyOf(selectedCard));
      }
      return;
    }

    // /：进入 Omnibox 综合搜索编辑
    if (inputChar === '/') {
      const currentQuery = [
        minLevel !== 'info' ? `level:${minLevel}` : '',
        sessionFilter ? `sid:${sessionFilter}` : '',
        errorFocus ? 'focus:on' : '',
        keywordFilter
      ].filter(Boolean).join(' ');
      setSearchDraft(currentQuery);
      setIsSearching(true);
      return;
    }

    // ] / [：在错误条目间上下跳转（warn/error，基于当前过滤后的卡片流）
    // 聚焦模式下所有卡片都是错误，等价于逐卡片移动；非聚焦模式则跳到下一条错误。
    if (inputChar === ']') {
      const next = findNextErrorIndex(sessionCards, cardScroll.offset, 1);
      if (next >= 0) {
        // 同时移动选中标记：Enter 展开以 selectedCardIdx 为锚（见下方 Enter 分支
        // 与箭头键处理），只改 offset 会让跳转后可见但 Enter 展开到旧选中卡。
        setSelectedCardIdx(next);
        cardScroll.setOffset(next);
      }
      return;
    }
    if (inputChar === '[') {
      const prev = findNextErrorIndex(sessionCards, cardScroll.offset, -1);
      if (prev >= 0) {
        setSelectedCardIdx(prev);
        cardScroll.setOffset(prev);
      }
      return;
    }

    // K：切换全局时间线子视图（调用时序 ↔ 耗时分布/失败聚类），仅 global 模式生效
    if (inputChar === 'k' || inputChar === 'K') {
      if (view === 'timeline' && timelineMode === 'global') {
        setTimelineMetric((cur) => toggleTimelineMetric(cur));
        globalTimelineScroll.scrollToTop();
        globalStatsScroll.scrollToTop();
      }
      return;
    }

    // 仅支持 Alt+1/2/3：显式 Tab 切换（移除纯数字兼容，避免与输入冲突）
    // ESC + [1-3] 序列：用 charCode 显式判断，避免正则控制字符 lint
    let tabNum: number | null = null;
    if (key.meta && inputChar && inputChar >= '1' && inputChar <= '3') {
      tabNum = parseInt(inputChar, 10);
    } else if (
      inputChar &&
      inputChar.length === 3 &&
      inputChar.charCodeAt(0) === 27 &&
      inputChar.charAt(1) === '[' &&
      inputChar.charAt(2) >= '1' &&
      inputChar.charAt(2) <= '3'
    ) {
      tabNum = parseInt(inputChar.charAt(2), 10);
    }

    if (tabNum === 1) {
      setView('list');
      resetRightPaneScroll();
      return;
    }
    if (tabNum === 2) {
      setView('timeline');
      setTimelineMode('session');
      resetRightPaneScroll();
      return;
    }
    if (tabNum === 3) {
      setView('timeline');
      setTimelineMode('global');
      resetRightPaneScroll();
      return;
    }

    // G：导出当前过滤后的日志为 markdown（成功在状态行显示保存路径）
    if (inputChar === 'g' || inputChar === 'G') {
      void handleExport('markdown');
      return;
    }

    // X：导出当前过滤后的日志为 JSON
    if (inputChar === 'x' || inputChar === 'X') {
      void handleExport('json');
      return;
    }

    // C：复制当前聚焦日志到剪贴板
    if (inputChar === 'c' || inputChar === 'C') {
      if (view === 'list') {
        const currentEntry = sessionCards[selectedCardIdx];
        if (currentEntry) {
          const contentToCopy = `[${currentEntry.level}] ${currentEntry.timestamp} | ${currentEntry.scope}\nMessage: ${currentEntry.message}\nData: ${JSON.stringify(currentEntry.data, null, 2)}`;
          import('clipboardy').then(clipboard => {
            clipboard.default.writeSync(contentToCopy);
            setExportStatus(`✓ 已复制当前日志到剪贴板`);
          }).catch(err => setExportStatus(`✗ 剪贴板失败: ${err.message}`));
        }
      }
      return;
    }

    // T：切换对话合并视图（transcript 用户/助手消息按时间插入日志流）
    if (inputChar === 't' || inputChar === 'T') {
      if (view === 'list') {
        setShowConversation((cur) => !cur);
        resetRightPaneScroll();
      }
      return;
    }

    // N/B：会话列表翻页（无限滚动下改为滚动整屏）
    if (inputChar === 'n' || inputChar === 'N') {
      sessionScroll.scrollDown();
      return;
    }
    if (inputChar === 'b' || inputChar === 'B') {
      sessionScroll.scrollUp();
      return;
    }



    // ?：切换底部快捷键提示条 显示/隐藏（按当前视图列出可用按键）
    if (inputChar === '?') {
      setHelpVisible((cur) => !cur);
      return;
    }
  });
}
