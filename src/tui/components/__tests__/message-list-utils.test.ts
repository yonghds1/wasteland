import { describe, expect, it } from 'vitest';

import { countNewLines } from '../chat-message-utils.js';

describe('countNewLines', () => {
  it('is zero while pinned to bottom', () => {
    expect(countNewLines(100, 80, 20, true)).toBe(0);
  });

  it('counts rows below the viewport when scrolled up', () => {
    expect(countNewLines(100, 70, 20, false)).toBe(10);
  });

  it('is zero when viewport covers the tail', () => {
    expect(countNewLines(100, 80, 20, false)).toBe(0);
  });
});
