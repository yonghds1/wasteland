/**
 * AgentTabs 工具函数与纯逻辑
 *
 * 包含 tab 构造、视口计算、样式决策、状态图标映射等纯函数。
 * 从 AgentTabs.tsx 解耦出来，便于单独测试与复用。
 */

import type { AgentNode, FocusArea } from '../../context/AppContext.js';
import { wastelandTheme } from '@theme/wasteland/index.js';
import { t } from '@locales/index.js';
import type { Skin } from '@skins/types.js';

// ============================================================
// 类型定义
// ============================================================

/**
 * Tab 项(包含 Main 合成项与 sub-agent 真实项)
 */
export interface AgentTab {
  /** 唯一标识:Main 用 'main' 标识,sub-agent 用 agent.id */
  id: string;
  /** 渲染名 */
  name: string;
  /** 状态图标(running/completed/failed/timeout) */
  status: AgentNode['status'];
  /** 是否 Main(影响 viewFilter 设值语义) */
  isMain: boolean;
}

/**
 * 视口计算结果
 */
export interface ViewportResult {
  /** 可见 tab(原数组切片视图) */
  visibleTabs: AgentTab[];
  /** 原始 tab 在视口里的索引映射(用于 ▶ 标记定位) */
  visibleIndices: number[];
  /** 是否显示左侧溢出指示器 ◀ */
  showLeft: boolean;
  /** 是否显示右侧溢出指示器 ▶ */
  showRight: boolean;
}

/**
 * AgentTabs 单 tab 的 4 态视觉决策(07-31 feat-tui-agenttabs-agent-4 引入)
 *
 * 4 种互斥状态:
 *
 * | isSelected | isActive | state           | 视觉                                |
 * |------------|----------|-----------------|-------------------------------------|
 * | false      | false    | 'idle'          | muted 色,无 bold,无前缀,无后缀     |
 * | true       | false    | 'selected'      | ▶ 前缀,primary 色,bold             |
 * | false      | true     | 'active'        | ● 后缀,primary 色,bold             |
 * | true       | true     | 'selectedActive'| ▶ 前缀 + ● 后缀,primary 色,bold    |
 *
 * - **isSelected**: 用户方向键移到的 tab(`selectedIdx === originalIdx`)
 * - **isActive**: 当前 viewFilter 匹配的 tab(消息过滤目标)
 *
 * 提取为纯函数的目的:visual 决策本身可单测,避免 Ink 渲染快照。
 */
export type AgentTabVisualState = 'idle' | 'selected' | 'active' | 'selectedActive';

export interface AgentTabStyle {
  /** 4 态之一,用于单测断言 */
  state: AgentTabVisualState;
  /** wastelandTheme.colors.{muted|primary|textEmphasized} 的语义标识 */
  colorKey: 'muted' | 'primary' | 'textEmphasized';
  /** 是否加粗 */
  bold: boolean;
  /** ◆ 后缀(激活态显示;不用 ●,避免与 running 状态图标冲突) */
  hasActiveMarker: boolean;
}

/**
 * AgentTabs 右侧 prose 决策(07-31 statusbar 合并后引入)
 *
 * 当前会话状态(`state.session.isThinking` + `state.session.isStreaming`)在
 * AgentTabs strip 右侧 flexGrow Box 中显示对应文案:
 *
 * - `isThinking === true` → 取一个 `skin.thinkingKey` 随机元素
 *   (复用了原 StatusBar 的 prose 文案路径)
 * - `isStreaming === true` → `tui.session.messages.streaming` 文本
 * - 两者可同时为 true,均渲染(先后顺序:thinking 在前,streaming 在后)
 * - 都不为 true → 返回空数组(右侧 Box 不渲染任何 Text)
 *
 * 函数为纯函数;返回数组内 item 包含 text 与 wastelandTheme color 标识,
 * 由调用方决定 color hex(`wastelandTheme.colors.warning` /
 * `wastelandTheme.colors.success`)。
 *
 * 注入 `randomThinkingKey` 与 `streamingLabelKey` 参数便于单测避免依赖
 * 随机性 & locale 副作用。
 */
export interface AgentTabsRightSideItem {
  text: string;
  /** wastelandTheme.colors.{warning|success} 的语义标识,组件渲染时 resolve 为 hex */
  colorKey: 'warning' | 'success';
}

// ============================================================
// 纯函数(可独立单测)
// ============================================================

/**
 * 状态图标映射(running/completed/failed/timeout → ●/✓/✗/⏱)
 */
export function statusIcon(status: AgentNode['status']): string {
  switch (status) {
    case 'running':
      return '⠋';
    case 'completed':
      return '✓';
    case 'failed':
      return '✗';
    case 'timeout':
      return '⏱';
    case 'idle':
    default:
      return '';
  }
}

/**
 * 计算单个 tab 的字符宽度
 *
 * 视觉结构:`[Name ●]` = `[`(1) + name(n) + ` `(1) + icon(1) + `]`(1) = name.length + 4
 * - tab 间无间隙(Ink 同 Box row 内多 Text 拼接无自动 gap)
 * - 选中时 ▶ 前缀单独计算(由 visibleSelectedIdx 标记的那一个 Text 多 1 列 ▶ 替换 1 列空格)
 *   不计入此函数宽度(影响 viewport 算法的边界对齐)
 */
export function tabWidth(name: string): number {
  // '[Name ●]' = 1([) + name + 1(空格) + 1(icon) + 1(]) = name.length + 4
  return name.length + 4;
}

/**
 * 视口算法:把 tabs 切割成可见窗口,保证 selectedIdx 可见,
 * 且左/右溢出指示器按需出现。
 *
 * 算法:
 * 1. 计算每 tab 字符宽度,累加前缀位置(prefix 数组)
 * 2. visibleWidth = terminalWidth - RESERVED(留 ◀▶ + 左右 padding 位置)
 * 3. 若 totalWidth ≤ visibleWidth:全部显示,无溢出
 * 4. 否则:让 selectedIdx 居中略偏左(前面至少留 1-2 个可见),
 *    visibleStart = max(0, min(selectedIdx - 1, totalWidth - visibleWidth))
 *    找到第一个 prefix[i] >= visibleStart 的 i 作为起点
 * 5. 从起点往后累加宽度,直到超 visibleWidth
 */
export function computeViewport(
  tabs: ReadonlyArray<AgentTab>,
  selectedIdx: number,
  terminalWidth: number,
  reserved: number = 8
): ViewportResult {
  // 边界:无 tab 或终端无效 → 返回空视口(无溢出)
  if (tabs.length === 0 || terminalWidth <= reserved) {
    return { visibleTabs: [], visibleIndices: [], showLeft: false, showRight: false };
  }

  // 计算每 tab 的 prefix 起始位置(prefix[i] = 第 i 个 tab 的左边界)
  const widths = tabs.map((t) => tabWidth(t.name));
  const prefix: number[] = [];
  let acc = 0;
  for (const w of widths) {
    prefix.push(acc);
    acc += w;
  }
  const totalWidth = acc;
  const visibleWidth = terminalWidth - reserved;

  // 全部可见:无溢出
  if (totalWidth <= visibleWidth) {
    return {
      visibleTabs: [...tabs],
      visibleIndices: tabs.map((_, i) => i),
      showLeft: false,
      showRight: false,
    };
  }

  // 需要视口切割:让 selectedIdx 略偏左可见
  // 思路:visibleStart 设为 prefix[selectedIdx] - 一个 tab 宽度(让前面露 1 个)
  // 但不能 < 0,也不能 > totalWidth - visibleWidth
  // (selectedIdx 已在调用前保证 < tabs.length,且 tabs 非空,故 prefix/widths 索引安全)
  const safePrefix = (i: number): number => prefix[i] ?? 0;
  const safeWidth = (i: number): number => widths[i] ?? 0;
  const candidateStart = safePrefix(selectedIdx) - safeWidth(selectedIdx);
  const maxStart = totalWidth - visibleWidth;
  const visibleStart = Math.max(0, Math.min(candidateStart, maxStart));
  const visibleEnd = visibleStart + visibleWidth;

  // 找到第一个 prefix[i] >= visibleStart 的 i
  let startIdx = 0;
  for (let i = 0; i < prefix.length; i++) {
    if (safePrefix(i) + safeWidth(i) > visibleStart) {
      startIdx = i;
      break;
    }
    startIdx = i + 1;
  }

  // 从 startIdx 往后累加宽度,直到超 visibleEnd
  const visibleIndices: number[] = [];
  let widthAcc = 0;
  for (let i = startIdx; i < tabs.length; i++) {
    const w = safeWidth(i);
    if (widthAcc + w > visibleWidth && visibleIndices.length > 0) {
      break;
    }
    visibleIndices.push(i);
    widthAcc += w;
  }

  return {
    visibleTabs: visibleIndices.map((i) => tabs[i]).filter((t): t is AgentTab => t !== undefined),
    visibleIndices,
    showLeft: visibleStart > 0,
    showRight: visibleEnd < totalWidth,
  };
}

/**
 * 根据 viewFilter 与 tab 列表解析出当前高亮的 tab id。
 *
 * - viewFilter 为 undefined:不持久高亮(只有 selectedIdx 决定 ▶)
 * - viewFilter === tab.id:持久加粗 + 主色
 * - viewFilter 与任何 tab 都不匹配:不持久高亮
 */
export function getPersistentHighlightId(
  tabs: ReadonlyArray<AgentTab>,
  viewFilter: string | undefined
): string | undefined {
  if (viewFilter === undefined) return undefined;
  return tabs.some((t) => t.id === viewFilter) ? viewFilter : undefined;
}

/**
 * 从 runtime agents 构造 tab 列表(对应 PRD AC2)
 *
 * 规则:
 * - **Main Agent 已包含在 `agents` 里**(由 `session_started` 事件 push,
 *   `name: 'Main Agent'`,depth=0),不再合成。契约:Main 永远是 [0]。
 * - 第 0 个 tab(就是 Main Agent)标记 `isMain: true`,决定 viewFilter 语义。
 * - 后续为 agents 中 `depth >= 1` 的 sub-agent(原顺序)。
 * - `depth < 0` 的 agent 被过滤(预留未来语义,本任务不需要)。
 *
 * @param agents runtime 推上来的 agents(`state.session.agents`)
 * @returns tab 列表(可能为空 if runtime 还没推 Main;正常情况 ≥ 1 项)
 */
export function buildTabs(agents: ReadonlyArray<AgentNode>): AgentTab[] {
  return agents
    .filter((a) => a.depth >= 0)
    .map<AgentTab>((a, i) => ({
      id: a.id,
      name: i === 0 ? a.name : (a.roleName || a.name),
      status: a.status,
      isMain: i === 0,
    }));
}

/**
 * AgentTabs 底线视觉决策(08-01 样式简化引入)
 *
 * - `focusArea === 'agentTabs'` 时:底线用 `borderFocused`(#E6B450),
 *   作为 Esc 退出输入框后焦点落点的可见反馈。
 * - 其他 focusArea:底线用 `borderDim`(#3D3328),保持轻分隔感。
 *
 * 不再画完整边框,只保留底部一条轻线,使 agentbar 更像导航带而非面板。
 *
 * @param focusArea `AppState.focusArea`(来自 `useAppContext()`)
 * @returns 底线颜色 hex
 */
export function getAgentBarBorderColor(focusArea: FocusArea): string {
  return focusArea === 'agentTabs'
    ? wastelandTheme.colors.borderFocused
    : wastelandTheme.colors.borderDim;
}

/**
 * 根据选中的 tab 推导 viewFilter(对应 PRD AC6)
 *
 * 语义:
 * - 选中 Main(isMain=true) → 返回 `undefined`,表示"取消 filter"
 * - 选中 sub-agent → 返回该 agent.id,ChatMessageList 据此过滤
 *
 * 这就是 `useInput` Enter 分支调用 `setViewFilter` 时传入的值。
 */
export function selectTabViewFilter(tab: AgentTab): string | undefined {
  return tab.isMain ? undefined : tab.id;
}

/**
 * Tab 索引移动（←/→ 导航，循环不回绕，钳制在 [0, len)）。
 *
 * 纯函数：供 `useInput` dispatch 与单测。
 */
export function moveTabIndex(current: number, dir: 1 | -1, len: number): number {
  if (len <= 0) return 0;
  const next = current + dir;
  if (next < 0) return 0;
  if (next >= len) return len - 1;
  return next;
}

/**
 * Main tab 的显示标签(07-31 statusbar 合并后引入)
 *
 * 渲染形式 `[Main | <skinLabel>]` —— "Main" 取自 locale
 * `tui.agentTabs.mainShortLabel`(zh/en 都为 "Main");"|" 字面分隔符;
 * `<skinLabel>` 取自 `skin.labelKey`(i18n key,运行时 resolve 成 "热沙总督" 等)。
 *
 * 函数为纯函数,不依赖 React/Ink,因此可以独立单测。
 *
 * @param skin 当前激活皮肤的 Skin 引用(从 `runtime.skin` 透传)
 * @returns 完整 Main tab 标签,如 `"Main | 热沙总督"`
 */
export function getMainTabLabel(skin: Skin): string {
  return `${t('tui.agentTabs.mainShortLabel')} | ${skin.label}`;
}

export function getAgentTabStyle(opts: {
  isSelected: boolean;
  isActive: boolean;
}): AgentTabStyle {
  if (opts.isSelected && opts.isActive) {
    return {
      state: 'selectedActive',
      colorKey: 'textEmphasized',
      bold: true,
      hasActiveMarker: true,
    };
  }
  if (opts.isActive) {
    return {
      state: 'active',
      colorKey: 'primary',
      bold: true,
      hasActiveMarker: true,
    };
  }
  if (opts.isSelected) {
    return {
      state: 'selected',
      colorKey: 'primary',
      bold: true,
      hasActiveMarker: false,
    };
  }
  return {
    state: 'idle',
    colorKey: 'muted',
    bold: false,
    hasActiveMarker: false,
  };
}

/**
 * 进入 AgentTabs 时的初始 selectedIdx 计算(07-31 feat-tui-agenttabs-agent-4)
 *
 * 规则:
 * - viewFilter === undefined → Main 默认选中(idx 0)
 * - viewFilter 命中某个 tab.id → 选中该 tab 的 idx
 * - viewFilter 失配 → fallback idx 0
 *
 * 纯函数化是为了单测默认选中逻辑,避免依赖 React effect。
 */
export function getInitialSelectedIdx(
  tabs: ReadonlyArray<AgentTab>,
  viewFilter: string | undefined
): number {
  if (tabs.length === 0) return 0;
  if (viewFilter === undefined) return 0;
  const found = tabs.findIndex((t) => t.id === viewFilter);
  return found >= 0 ? found : 0;
}

export function getRightSideProse(
  sessionState: { isThinking: boolean; isStreaming: boolean },
  skin: Skin,
  randomThinkingKey: () => string = () => skin.thinking[Math.floor(Math.random() * skin.thinking.length)] ?? '',
  streamingLabelKey: string = 'tui.session.messages.streaming',
): AgentTabsRightSideItem[] {
  const out: AgentTabsRightSideItem[] = [];
  // 保持单状态指示：流式优先（输出中），思考次之（等待中），避免同时出现多个 loading
  if (sessionState.isStreaming) {
    out.push({ text: t(streamingLabelKey), colorKey: 'success' });
  } else if (sessionState.isThinking) {
    out.push({ text: randomThinkingKey(), colorKey: 'warning' });
  }
  return out;
}
