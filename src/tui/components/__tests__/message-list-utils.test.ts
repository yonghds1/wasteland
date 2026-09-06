import { describe, expect, it } from 'vitest';

import { countNewLines, formatTimeHHMM, parseLocalDate } from '../chat-message-utils.js';

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

describe('formatTimeHHMM（本地时区）', () => {
  it('renders local HH:MM instead of UTC slice', () => {
    const d = new Date('2026-09-06T10:37:22.000+08:00');
    const p2 = (n: number): string => String(n).padStart(2, '0');
    expect(formatTimeHHMM('2026-09-06T10:37:22.000+08:00')).toBe(
      `${p2(d.getHours())}:${p2(d.getMinutes())}`,
    );
  });

  it('returns empty for invalid input', () => {
    expect(formatTimeHHMM('nope')).toBe('');
    expect(formatTimeHHMM('')).toBe('');
  });

  it('parseLocalDate rejects garbage', () => {
    expect(parseLocalDate('')).toBeNull();
    expect(parseLocalDate('not-a-date')).toBeNull();
  });
});
