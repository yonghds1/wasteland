import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'ink';
import { Scrollbar } from '../Scrollbar.js';

describe('Scrollbar', () => {
  it('当内容未超出视口时渲染静态轨道 │', () => {
    const output = renderToString(
      <Scrollbar
        height={10}
        totalItems={5}
        visibleItems={10}
        offset={0}
      />
    );
    expect(output).toContain('│');
    expect(output).not.toContain('█');
  });

  it('当内容超出视口时渲染滑块 █ 与轨道 │', () => {
    const output = renderToString(
      <Scrollbar
        height={10}
        totalItems={20}
        visibleItems={10}
        offset={0}
      />
    );
    expect(output).toContain('█');
    expect(output).toContain('│');
  });
});
