import { describe, expect, it } from 'vitest';

import { getInitialSelectedIdx, moveTabIndex, selectTabViewFilter, type AgentTab } from '../AgentTabs.js';

function tab(id: string, isMain = false): AgentTab {
  return { id, name: id, status: 'running', isMain };
}

describe('moveTabIndex', () => {
  it('moves right within bounds', () => {
    expect(moveTabIndex(0, 1, 3)).toBe(1);
  });

  it('moves left within bounds', () => {
    expect(moveTabIndex(2, -1, 3)).toBe(1);
  });

  it('clamps at edges instead of wrapping', () => {
    expect(moveTabIndex(0, -1, 3)).toBe(0);
    expect(moveTabIndex(2, 1, 3)).toBe(2);
  });

  it('returns 0 for empty list', () => {
    expect(moveTabIndex(0, 1, 0)).toBe(0);
  });
});

describe('tab selection semantics', () => {
  it('selects Main as filter-cancel (undefined)', () => {
    expect(selectTabViewFilter(tab('main', true))).toBeUndefined();
  });

  it('selects sub-agent by id', () => {
    expect(selectTabViewFilter(tab('abc'))).toBe('abc');
  });

  it('initial index follows viewFilter with fallback 0', () => {
    const tabs = [tab('main', true), tab('a'), tab('b')];
    expect(getInitialSelectedIdx(tabs, undefined)).toBe(0);
    expect(getInitialSelectedIdx(tabs, 'b')).toBe(2);
    expect(getInitialSelectedIdx(tabs, 'missing')).toBe(0);
  });
});
