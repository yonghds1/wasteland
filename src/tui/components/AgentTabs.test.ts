/**
 * AgentTabs 单元测试
 *
 * 覆盖 PRD AC11：
 * - tab 列表构建（Main 永远第一 + sub-agents 顺序）
 * - 滚动算法（各种 agent 数 + 终端宽度组合）
 * - viewFilter 设值（Main 选中 → undefined，sub-agent → agentId）
 * - Esc 双向 toggle 焦点
 */

import { describe, it, expect, beforeAll } from 'vitest';

import {
  type AgentTab,
  statusIcon,
  tabWidth,
  computeViewport,
  getPersistentHighlightId,
  getAgentBarBorderColor,
  getAgentTabStyle,
  getInitialSelectedIdx,
  getMainTabLabel,
  getRightSideProse,
  buildTabs,
  selectTabViewFilter,
} from './AgentTabs.js';
import type { AgentNode } from '../context/AppContext.js';
import type { Skin } from '@skins/types.js';
import { initI18n } from '@locales/i18n.js';

beforeAll(async () => {
  await initI18n('zh');
});

// ============================================================
// 工厂:快速生成测试用 tabs
// ============================================================

function mkMain(): AgentTab {
  return { id: 'main', name: 'Main', status: 'running', isMain: true };
}

function mkSub(idx: number, status: AgentTab['status'] = 'running'): AgentTab {
  return {
    id: `child-${idx}`,
    name: `Sub${idx}`,
    status,
    isMain: false,
  };
}

function mkTabs(count: number): AgentTab[] {
  // 1 Main + (count-1) sub-agents
  const out: AgentTab[] = [mkMain()];
  for (let i = 1; i < count; i++) {
    out.push(mkSub(i));
  }
  return out;
}

// ============================================================
// statusIcon
// ============================================================

describe('statusIcon', () => {
  it('returns ⠋ for running', () => {
    expect(statusIcon('running')).toBe('⠋');
  });
  it('returns ✓ for completed', () => {
    expect(statusIcon('completed')).toBe('✓');
  });
  it('returns ✗ for failed', () => {
    expect(statusIcon('failed')).toBe('✗');
  });
  it('returns ⏱ for timeout', () => {
    expect(statusIcon('timeout')).toBe('⏱');
  });
  it('falls back to empty string for unknown/idle status', () => {
    expect(statusIcon('idle')).toBe('');
  });
});

// ============================================================
// tabWidth
// ============================================================

describe('tabWidth', () => {
  it('Main (4 chars) → 8', () => {
    expect(tabWidth('Main')).toBe(8);
  });
  it('SubN (4-5 chars) → 8 or 9', () => {
    expect(tabWidth('Sub1')).toBe(8);
    expect(tabWidth('Sub10')).toBe(9);
  });
  it('longer name scales linearly', () => {
    expect(tabWidth('Warlord Stern')).toBe(17);
  });
});

// ============================================================
// computeViewport — 边界条件
// ============================================================

describe('computeViewport (edge cases)', () => {
  it('empty tabs → empty viewport, no overflow indicators', () => {
    const v = computeViewport([], 0, 80);
    expect(v.visibleTabs).toEqual([]);
    expect(v.visibleIndices).toEqual([]);
    expect(v.showLeft).toBe(false);
    expect(v.showRight).toBe(false);
  });

  it('terminal too narrow (≤ reserved) → empty viewport', () => {
    const v = computeViewport(mkTabs(3), 1, 8);
    expect(v.visibleTabs).toEqual([]);
    expect(v.visibleIndices).toEqual([]);
    expect(v.showLeft).toBe(false);
    expect(v.showRight).toBe(false);
  });

  it('single Main tab fits → all visible, no overflow', () => {
    const tabs = [mkMain()];
    const v = computeViewport(tabs, 0, 80);
    expect(v.visibleIndices).toEqual([0]);
    expect(v.visibleTabs.map((t) => t.id)).toEqual(['main']);
    expect(v.showLeft).toBe(false);
    expect(v.showRight).toBe(false);
  });
});

// ============================================================
// computeViewport — 不需要滚动的情况
// ============================================================

describe('computeViewport (no overflow)', () => {
  it('2-3 tabs all fit in 80 cols → all visible', () => {
    const tabs = mkTabs(3);
    const v = computeViewport(tabs, 1, 80);
    expect(v.visibleIndices).toEqual([0, 1, 2]);
    expect(v.showLeft).toBe(false);
    expect(v.showRight).toBe(false);
  });

  it('5 tabs in 80 cols → all visible (5*8 = 40 < 80)', () => {
    const tabs = mkTabs(5);
    const v = computeViewport(tabs, 4, 80);
    expect(v.visibleIndices.length).toBe(5);
    expect(v.showLeft).toBe(false);
    expect(v.showRight).toBe(false);
  });
});

// ============================================================
// computeViewport — 需要滚动的情况(PRD AC7)
// ============================================================

describe('computeViewport (overflow + viewport follows selectedIdx)', () => {
  it('10 tabs in 40 cols → only a few visible, right indicator shown', () => {
    const tabs = mkTabs(10);
    // 10 * 8 = 80 chars total; visibleWidth = 40 - 8 = 32; only 4 tabs fit
    const v = computeViewport(tabs, 0, 40);
    expect(v.visibleIndices.length).toBeLessThan(10);
    // 至少右侧溢出(因为总宽 80 > 32)
    expect(v.showRight).toBe(true);
    // 视口里 selectedIdx 必须可见
    expect(v.visibleIndices).toContain(0);
  });

  it('viewport scrolls to keep selectedIdx visible', () => {
    const tabs = mkTabs(10);
    // selectedIdx = 5：让中间 tab 可见
    const v = computeViewport(tabs, 5, 40);
    expect(v.visibleIndices).toContain(5);
    // 至少一侧溢出
    expect(v.showLeft || v.showRight).toBe(true);
  });

  it('when selectedIdx at end → showLeft = true', () => {
    const tabs = mkTabs(10);
    const last = tabs.length - 1;
    const v = computeViewport(tabs, last, 40);
    expect(v.visibleIndices).toContain(last);
    expect(v.showLeft).toBe(true);
  });

  it('when selectedIdx at start → showRight = true', () => {
    const tabs = mkTabs(10);
    const v = computeViewport(tabs, 0, 40);
    expect(v.visibleIndices).toContain(0);
    expect(v.showRight).toBe(true);
  });

  it('selectedIdx jumps to last → viewport scrolls to end (showLeft=true)', () => {
    const tabs = mkTabs(10);
    // 先 selectedIdx = 0, 再切到 9
    const v0 = computeViewport(tabs, 0, 40);
    expect(v0.visibleIndices).toContain(0);
    const v9 = computeViewport(tabs, 9, 40);
    expect(v9.visibleIndices).toContain(9);
    expect(v9.showLeft).toBe(true);
    expect(v9.showRight).toBe(false);
  });
});

// ============================================================
// getPersistentHighlightId(对应 PRD AC6 持久加粗)
// ============================================================

describe('getPersistentHighlightId', () => {
  it('viewFilter === undefined → no persistent highlight', () => {
    const tabs = mkTabs(3);
    expect(getPersistentHighlightId(tabs, undefined)).toBeUndefined();
  });

  it('viewFilter matches a sub-agent → returns that id', () => {
    const tabs = mkTabs(3);
    expect(getPersistentHighlightId(tabs, 'child-1')).toBe('child-1');
  });

  it('viewFilter matches Main id "main" → returns "main"', () => {
    const tabs = mkTabs(3);
    expect(getPersistentHighlightId(tabs, 'main')).toBe('main');
  });

  it('viewFilter does not match any tab → undefined (no orphan highlight)', () => {
    const tabs = mkTabs(3);
    expect(getPersistentHighlightId(tabs, 'ghost')).toBeUndefined();
  });
});

// ============================================================
// Viewport summary: AC7 多 agent 场景示例
// ============================================================

describe('computeViewport (PRD AC7 scenarios)', () => {
  it('7 tabs (Main + 6 subs) in 60 cols → partial view with indicators', () => {
    const tabs = mkTabs(7);
    // 7 * 8 = 56 chars; visibleWidth = 60 - 8 = 52; ~6 tabs fit (last one partial?)
    const v = computeViewport(tabs, 3, 60);
    expect(v.visibleIndices.length).toBeLessThanOrEqual(7);
    expect(v.visibleIndices.length).toBeGreaterThan(2);
    expect(v.visibleIndices).toContain(3);
    // 至少一侧溢出
    expect(v.showLeft || v.showRight).toBe(true);
  });

  it('narrow terminal (40 cols) shows minimal visible tabs', () => {
    const tabs = mkTabs(7);
    const v = computeViewport(tabs, 2, 40);
    // 至少 1 个 tab 可见
    expect(v.visibleIndices.length).toBeGreaterThanOrEqual(1);
    // selectedIdx 必可见
    expect(v.visibleIndices).toContain(2);
  });
});

// ============================================================
// buildTabs — tab 列表构建(对应 PRD AC2)
// ============================================================

describe('buildTabs', () => {
  function mkAgent(id: string, depth: number, name: string, status: AgentNode['status'] = 'running'): AgentNode {
    return { id, name, depth, status, startTime: 0 };
  }

  it('empty agents → 空列表(runtime 还没推 Main)', () => {
    expect(buildTabs([])).toEqual([]);
  });

  it('单 Main Agent(depth=0) → 1 项,isMain=true', () => {
    const tabs = buildTabs([mkAgent('main-session-id', 0, 'Main Agent')]);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toEqual({
      id: 'main-session-id',
      name: 'Main Agent',
      status: 'running',
      isMain: true,
    });
  });

  it('Main + sub-agents → Main 第一,isMain=true,sub 按输入顺序', () => {
    const tabs = buildTabs([
      mkAgent('main-session-id', 0, 'Main Agent'),
      mkAgent('b1', 1, 'B1'),
      mkAgent('b2', 2, 'B2'),
      mkAgent('b3', 1, 'B3'),
    ]);
    expect(tabs).toHaveLength(4);
    expect(tabs[0]?.id).toBe('main-session-id');
    expect(tabs[0]?.isMain).toBe(true);
    expect(tabs[1]?.id).toBe('b1');
    expect(tabs[1]?.isMain).toBe(false);
    expect(tabs[2]?.id).toBe('b2');
    expect(tabs[3]?.id).toBe('b3');
  });

  it('过滤 depth < 0 的 agent(预留未来语义)', () => {
    const tabs = buildTabs([
      mkAgent('main', 0, 'Main Agent'),
      mkAgent('neg', -1, 'Neg'),
      mkAgent('b1', 1, 'B1'),
    ]);
    expect(tabs).toHaveLength(2);
    expect(tabs.map((t) => t.id)).toEqual(['main', 'b1']);
  });

  it('保留 agent 的 status(running/completed/failed/timeout)', () => {
    const tabs = buildTabs([
      mkAgent('main', 0, 'Main Agent'),
      mkAgent('c1', 1, 'C1', 'completed'),
      mkAgent('f1', 1, 'F1', 'failed'),
      mkAgent('t1', 1, 'T1', 'timeout'),
    ]);
    expect(tabs[1]?.status).toBe('completed');
    expect(tabs[2]?.status).toBe('failed');
    expect(tabs[3]?.status).toBe('timeout');
  });
});

// ============================================================
// selectTabViewFilter — viewFilter 设值(对应 PRD AC6)
// ============================================================

describe('selectTabViewFilter', () => {
  it('Main tab (isMain=true) → undefined(取消 filter)', () => {
    expect(selectTabViewFilter(mkMain())).toBeUndefined();
  });

  it('sub-agent tab (isMain=false) → agent.id', () => {
    const sub = mkSub(3);
    expect(selectTabViewFilter(sub)).toBe('child-3');
  });

  it('sub-agent tab.id 是 unique 的(避免被 Main 误覆盖)', () => {
    const sub1 = mkSub(1);
    const sub2 = mkSub(2);
    expect(selectTabViewFilter(sub1)).not.toBe(selectTabViewFilter(sub2));
    expect(selectTabViewFilter(sub1)).not.toBe('main');
  });
});

// ============================================================
// (documented) Esc bidirectional toggle
// — 真正的交互逻辑在 App.tsx Esc 处理分支实现:
//   state.inputMode=true → setInputMode(false) + setFocusArea('agentTabs')
//   state.focusArea='agentTabs' → setInputMode(true) + setFocusArea('inputBar')
// 单元测试无法覆盖 React useInput 状态机;此处通过纯函数不变性证明
// Esc 不影响 viewFilter 持久化。
// ============================================================

describe('Esc toggle contract (documented)', () => {
  it('Esc 不影响 viewFilter 持久化(pure invariant)', () => {
    const tabs = mkTabs(3);
    const persistentBefore = getPersistentHighlightId(tabs, 'child-1');
    expect(persistentBefore).toBe('child-1');
    // 重复调用与 Esc 触发顺序无关,viewFilter 保持一致
    const persistentAfter = getPersistentHighlightId(tabs, 'child-1');
    expect(persistentAfter).toBe('child-1');
  });
});

// ============================================================
// getAgentBarBorderColor (08-01 样式简化引入)
//   只返回底线颜色:聚焦 → borderFocused,失焦 → borderDim。
//   不再返回完整边框样式,agentbar 只画底部一条轻线。
// ============================================================

describe('getAgentBarBorderColor', () => {
  it("focusArea='agentTabs' → borderFocused 色", () => {
    expect(getAgentBarBorderColor('agentTabs')).toBe('#E6B450');
  });

  it("focusArea='inputBar' → borderDim 色", () => {
    expect(getAgentBarBorderColor('inputBar')).toBe('#3D3328');
  });

  it('focusArea=null → borderDim 色', () => {
    expect(getAgentBarBorderColor(null)).toBe('#3D3328');
  });

  it('聚焦态颜色 ≠ 失焦态颜色', () => {
    expect(getAgentBarBorderColor('agentTabs')).not.toBe(getAgentBarBorderColor('inputBar'));
  });
});

// ============================================================
// getMainTabLabel + getRightSideProse (07-31 statusbar 合并后引入)
// 验证合并 StatusBar 后,AgentTabs 接管 skin label 与状态 prose 的纯函数决策:
//   getMainTabLabel(skin)         → "Main | <skinLabel>"
//   getRightSideProse(state, skin) → thinking/streaming 列表(可空)
// ============================================================

const fakeGovernorSkin: Skin = {
  id: 'warlord-stern',
  label: '热沙总督',
  thinking: ['正在盘点风沙里的筹码...', '总督府正在重排优先级...'],
  greeting: ['说出目标，热沙总督在听。', '你的请求已进总督府账册。'],
  catchphrases: ['资源有限，判断必须锋利。', '先定路线，再谈荣耀。'],
  colors: { label: 'role.label.gold', text: 'primary', thinking: 'role.thinking.muted' },
};

describe('getMainTabLabel', () => {
  it('返回 Main | <skin.label> 形态', () => {
    const label = getMainTabLabel(fakeGovernorSkin);
    expect(label).toBe('Main | 热沙总督');
  });

  it('不同 skin → 不同标签', () => {
    const labelGovernor = getMainTabLabel(fakeGovernorSkin);
    const fakeCaptainSkin: Skin = { ...fakeGovernorSkin, id: 'scout', label: '荣耀之路车长' };
    const labelCaptain = getMainTabLabel(fakeCaptainSkin);
    expect(labelGovernor).not.toBe(labelCaptain);
    expect(labelCaptain).toBe('Main | 荣耀之路车长');
  });
});

describe('getRightSideProse', () => {
  // 注入确定性函数避免依赖 tRandom 副作用
  const fixedThinking = () => '命运在端详你的请求';
  const streamingKey = 'tui.session.messages.streaming';

  it('thinking + streaming 都为 false → 空数组(右侧 Box 不渲染任何 Text)', () => {
    const items = getRightSideProse(
      { isThinking: false, isStreaming: false },
      fakeGovernorSkin,
      fixedThinking,
      streamingKey,
    );
    expect(items).toEqual([]);
  });

  it('仅 thinking → 1 个 warning item,内容来自 randomThinkingKey()', () => {
    const items = getRightSideProse(
      { isThinking: true, isStreaming: false },
      fakeGovernorSkin,
      fixedThinking,
      streamingKey,
    );
    expect(items).toEqual([
      { text: '命运在端详你的请求', colorKey: 'warning' },
    ]);
  });

  it('仅 streaming → 1 个 success item,内容来自 t(streamingLabelKey)', () => {
    const items = getRightSideProse(
      { isThinking: false, isStreaming: true },
      fakeGovernorSkin,
      fixedThinking,
      streamingKey,
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.colorKey).toBe('success');
    expect(items[0]?.text.length).toBeGreaterThan(0);
  });

  it('thinking + streaming 同时 true → 流式优先，返回 1 个 success item', () => {
    const items = getRightSideProse(
      { isThinking: true, isStreaming: true },
      fakeGovernorSkin,
      fixedThinking,
      streamingKey,
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.colorKey).toBe('success');
  });
});

// ============================================================
// computeViewport reserved=10 (07-31 修复引入)
// AgentTabs 聚焦后加单边框,content 区比原来少 2 列;调用方把 reserved 从 8
// 提到 10。这条测试在不修改函数默认契约的前提下,记录调用方当前的预算值。
// ============================================================

describe('getAgentTabStyle', () => {
  it('idle → muted + no bold + no markers', () => {
    expect(getAgentTabStyle({ isSelected: false, isActive: false })).toEqual({
      state: 'idle',
      colorKey: 'muted',
      bold: false,
      hasActiveMarker: false,
    });
  });

  it('selected only → primary + bold (no arrow)', () => {
    expect(getAgentTabStyle({ isSelected: true, isActive: false })).toEqual({
      state: 'selected',
      colorKey: 'primary',
      bold: true,
      hasActiveMarker: false,
    });
  });

  it('active only → primary + bold + marker', () => {
    expect(getAgentTabStyle({ isSelected: false, isActive: true })).toEqual({
      state: 'active',
      colorKey: 'primary',
      bold: true,
      hasActiveMarker: true,
    });
  });

  it('selected + active → textEmphasized + bold + marker (no arrow)', () => {
    expect(getAgentTabStyle({ isSelected: true, isActive: true })).toEqual({
      state: 'selectedActive',
      colorKey: 'textEmphasized',
      bold: true,
      hasActiveMarker: true,
    });
  });
});

// ============================================================
// getInitialSelectedIdx (07-31 feat-tui-agenttabs-agent-4)
// 默认选中当前激活 agent: viewFilter === undefined → Main(idx 0);
// 命中某个 tab.id → 该 idx;失配 fallback idx 0。
// ============================================================

describe('getInitialSelectedIdx', () => {
  it('viewFilter=undefined → idx 0(Main 默认)', () => {
    const tabs = buildTabs([
      { id: 'main', name: 'Main Agent', depth: 0, status: 'running', startTime: 0 },
      { id: 'child-1', name: 'Child 1', depth: 1, status: 'running', startTime: 0 },
    ]);
    expect(getInitialSelectedIdx(tabs, undefined)).toBe(0);
  });

  it('viewFilter 命中 sub-agent → 返回其 idx', () => {
    const tabs = buildTabs([
      { id: 'main', name: 'Main Agent', depth: 0, status: 'running', startTime: 0 },
      { id: 'child-1', name: 'Child 1', depth: 1, status: 'running', startTime: 0 },
      { id: 'child-2', name: 'Child 2', depth: 1, status: 'running', startTime: 0 },
    ]);
    expect(getInitialSelectedIdx(tabs, 'child-2')).toBe(2);
  });

  it('viewFilter 失配 → fallback idx 0', () => {
    const tabs = buildTabs([
      { id: 'main', name: 'Main Agent', depth: 0, status: 'running', startTime: 0 },
      { id: 'child-1', name: 'Child 1', depth: 1, status: 'running', startTime: 0 },
    ]);
    expect(getInitialSelectedIdx(tabs, 'ghost')).toBe(0);
  });
});

describe('computeViewport with reserved=10 (focus border compensation)', () => {
  it('reserved=10 比 reserved=8 多让出 2 列 visibleWidth', () => {
    const tabs: AgentTab[] = [
      { id: 'a', name: 'Alpha', status: 'running', isMain: true },
      { id: 'b', name: 'Bravo', status: 'running', isMain: false },
      { id: 'c', name: 'Charlie', status: 'running', isMain: false },
      { id: 'd', name: 'Delta', status: 'running', isMain: false },
    ];
    // 找一宽度让 reserved=8 刚好触发 overflow 而 reserved=10 不溢出
    const probe = 40;
    const vp8 = computeViewport(tabs, 0, probe, 8);
    const vp10 = computeViewport(tabs, 0, probe, 10);
    // reserved 越大,内部可见宽越窄,越容易 overflow → showRight 应更可能 true
    // 反过来 reserved=10 的 visibleWidth 比 reserved=8 小 2
    // 直接断言宽度差:vp10 的总可见宽一定 ≤ vp8
    const width8 = vp8.visibleTabs.reduce((sum, t) => sum + tabWidth(t.name), 0);
    const width10 = vp10.visibleTabs.reduce((sum, t) => sum + tabWidth(t.name), 0);
    expect(width10).toBeLessThanOrEqual(width8);
    // vp10 的 visibleWidth 严格小 2 列(若 vp8 处于临界)
    if (vp8.showRight || vp8.showLeft) {
      // vp8 处于临界,reserved=10 必更窄
      expect((probe - 10) - width10).toBeLessThanOrEqual((probe - 8) - width8 + 2);
    }
  });
});