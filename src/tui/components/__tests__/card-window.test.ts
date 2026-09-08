/**
 * card-window.test.ts - 行预算测量与窗口切片
 *
 * 覆盖：
 * - wrapRowCount 与 Ink 同管线（短文本/长行换行/CJK/空串）
 * - truncateToWidth 不断宽字符
 * - measureCard 折叠/展开行计划
 * - sliceCardWindow 总行数恒 ≤ 预算（含单张超大卡截断）
 */

import { describe, it, expect } from 'vitest';

import {
  displayWidth,
  measureCard,
  planRows,
  sliceCardWindow,
  truncateToWidth,
  wrapRowCount,
} from '../card-window.js';
import type { LogEntry } from '@core/logger/index.js';

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    version: 1,
    timestamp: '2026-09-08T12:00:00.000Z',
    level: 'info',
    scope: 'tool',
    sessionId: 's1',
    message: 'hello',
    ...overrides,
  } as LogEntry;
}

describe('wrapRowCount', () => {
  it('短文本 1 行，空串 0 行', () => {
    expect(wrapRowCount('hello', 76)).toBe(1);
    expect(wrapRowCount('', 76)).toBe(0);
  });

  it('长行按宽度换行（与 Ink 同算法）', () => {
    expect(wrapRowCount('x'.repeat(200), 76)).toBe(3); // 76+76+48
    expect(wrapRowCount('x'.repeat(76), 76)).toBe(1);
    expect(wrapRowCount('x'.repeat(77), 76)).toBe(2);
  });

  it('CJK 按 2 列计宽', () => {
    expect(displayWidth('中')).toBe(2);
    expect(wrapRowCount('中'.repeat(40), 76)).toBe(2); // 80 列占 2 行
  });
});

describe('truncateToWidth', () => {
  it('短串原样返回', () => {
    expect(truncateToWidth('abc', 10)).toBe('abc');
  });

  it('超长截断不断宽字符', () => {
    const out = truncateToWidth('中'.repeat(10), 7);
    expect(displayWidth(out)).toBeLessThanOrEqual(7);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('measureCard', () => {
  it('折叠长消息：最多 5 原始行 + 1 提示行', () => {
    const entry = makeEntry({ message: Array.from({ length: 10 }, (_, i) => `line${i}`).join('\n') });
    const plan = measureCard(entry, {
      contentWidth: 56,
      isExpanded: false,
      contextWindow: null,
      relativeTimeStr: '',
      isCurrentCard: false,
    });
    expect(plan.messageLines.length).toBe(5);
    expect(plan.messageMore).toContain('5 more lines');
    expect(plan.detailLines).toHaveLength(0);
  });

  it('展开态含详情 JSON 行', () => {
    const entry = makeEntry({ message: 'hi' });
    const plan = measureCard(entry, {
      contentWidth: 56,
      isExpanded: true,
      contextWindow: null,
      relativeTimeStr: '',
      isCurrentCard: false,
    });
    expect(plan.detailLines.length).toBeGreaterThan(5);
    expect(plan.messageMore).toBeNull();
  });
});

describe('sliceCardWindow', () => {
  function entries(): LogEntry[] {
    return [
      makeEntry({ message: 'short one' }),
      makeEntry({ message: 'x'.repeat(500), level: 'error', error: { name: 'E', message: 'boom' } }),
      makeEntry({ message: Array.from({ length: 60 }, (_, i) => `row-${i}-${'y'.repeat(30)}`).join('\n') }),
      makeEntry({ message: 'short four' }),
    ];
  }

  it('预算内整卡装，超了就停，总行数恒 ≤ 预算', () => {
    const list = entries();
    for (const budget of [6, 12, 20, 40]) {
      const win = sliceCardWindow(list, 0, {
        contentWidth: 56,
        budgetRows: budget,
        isExpanded: () => false,
        contextWindowOf: () => null,
        relativeTimeOf: () => '',
        isCurrentCard: () => false,
      });
      expect(win.length).toBeGreaterThanOrEqual(1);
      const total = win.reduce((s, it) => s + it.rows, 0);
      expect(total).toBeLessThanOrEqual(budget);
      // rows 与 planRows 自洽
      for (const it of win) {
        expect(it.rows).toBe(planRows(it.plan, 56));
      }
    }
  });

  it('单张超大卡（展开 60 行）截断打标，总行数仍 ≤ 预算', () => {
    const list = entries();
    const win = sliceCardWindow(list, 2, {
      contentWidth: 56,
      budgetRows: 12,
      isExpanded: () => true,
      contextWindowOf: () => null,
      relativeTimeOf: () => '',
      isCurrentCard: () => false,
    });
    expect(win).toHaveLength(1);
    expect(win[0]?.rows).toBeLessThanOrEqual(12);
    expect(win[0]?.plan.truncated).toBe(true);
    expect(win[0]?.plan.detailMore ?? win[0]?.plan.messageMore).not.toBeNull();
  });

  it('空列表返回空窗口', () => {
    expect(
      sliceCardWindow([], 0, {
        contentWidth: 56,
        budgetRows: 12,
        isExpanded: () => false,
        contextWindowOf: () => null,
        relativeTimeOf: () => '',
        isCurrentCard: () => false,
      })
    ).toEqual([]);
  });
});
