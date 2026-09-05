import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToString, Text } from 'ink';
import { ScrollableBox } from '../ScrollableBox.js';

describe('ScrollableBox logic', () => {
  it('calculates maxVisible correctly', () => {
    const height = 20;
    const itemHeight = 2;
    const maxVisible = Math.floor(height / itemHeight);
    expect(maxVisible).toBe(10);
  });

  it('clamps offset to valid range', () => {
    const totalItems = 10;
    const maxVisible = 5;
    const offset = 100;
    const clamped = Math.max(0, Math.min(offset, Math.max(0, totalItems - maxVisible)));
    expect(clamped).toBe(5);
  });

  it('detects scroll indicators', () => {
    const totalItems = 20;
    const maxVisible = 5;
    const offset = 0;

    const hasMoreAbove = offset > 0;
    const hasMoreBelow = offset + maxVisible < totalItems;

    expect(hasMoreAbove).toBe(false);
    expect(hasMoreBelow).toBe(true);
  });

  it('slices children correctly', () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const offset = 3;
    const maxVisible = 4;

    const visible = items.slice(offset, offset + maxVisible);
    expect(visible).toEqual([3, 4, 5, 6]);
  });
});

// ============================================================
// windowed 模式：调用方预切好可见窗口，组件跳过二次切片
// ============================================================

describe('ScrollableBox windowed render', () => {
  it('windowed 模式透传调用方切好的可见窗口（不做二次切片）', () => {
    // 只有 8 个 children，但 offset=50 / totalItems=2000。
    // windowed 下组件原样渲染这 8 个（不再按 [offset, offset+maxVisible) 切空）。
    const output = renderToString(
      <ScrollableBox
        offset={50}
        onOffsetChange={() => {}}
        totalItems={2000}
        itemHeight={1}
        windowed
      >
        {Array.from({ length: 8 }, (_, i) => (
          <Text key={i}>{`item-${50 + i}`}</Text>
        ))}
      </ScrollableBox>,
      { columns: 80 },
    );
    expect(output).toContain('item-50');
    expect(output).toContain('item-57');
    expect(output).not.toContain('item-1999');
  });

  it('非 windowed 默认仍按 offset 二次切片（offset 超出 children 则切空）', () => {
    const output = renderToString(
      <ScrollableBox offset={50} onOffsetChange={() => {}} totalItems={2000} itemHeight={1}>
        {Array.from({ length: 8 }, (_, i) => (
          <Text key={i}>{`item-${i}`}</Text>
        ))}
      </ScrollableBox>,
      { columns: 80 },
    );
    // children 只有 8 个，offset=50 → slice 为空 → 不渲染任何 item
    expect(output).not.toContain('item-0');
    expect(output).not.toContain('item-7');
  });
});
