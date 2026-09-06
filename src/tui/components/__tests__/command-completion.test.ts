import { describe, expect, it } from 'vitest';

import {
  applyCompletion,
  filterCompletions,
  moveCompletionIndex,
  navigateHistory,
  type CompletionItem,
} from '../command-completion.js';

const items: CompletionItem[] = [
  { name: '/help', aliases: ['/h', '/?'], description: 'skills.help.description' },
  { name: '/logs', aliases: ['/log'], description: 'skills.logsHelp.helpText' },
  { name: '/clear', aliases: [], description: 'x' },
];

describe('filterCompletions', () => {
  it('returns first N for bare slash', () => {
    expect(filterCompletions('/', 1, items).length).toBe(3);
  });

  it('prefix-matches name and aliases case-insensitively', () => {
    expect(filterCompletions('/H', 2, items).map((i) => i.name)).toContain('/help');
    expect(filterCompletions('/lo', 3, items).map((i) => i.name)).toEqual(['/logs']);
  });

  it('returns empty on exact match or non-command input', () => {
    expect(filterCompletions('/help', 5, items)).toEqual([]);
    expect(filterCompletions('hello', 5, items)).toEqual([]);
    expect(filterCompletions('/help foo', 9, items)).toEqual([]);
  });
});

describe('moveCompletionIndex', () => {
  it('wraps around', () => {
    expect(moveCompletionIndex(2, 1, 3)).toBe(0);
    expect(moveCompletionIndex(0, -1, 3)).toBe(2);
  });

  it('returns 0 for empty list', () => {
    expect(moveCompletionIndex(0, 1, 0)).toBe(0);
  });
});

describe('applyCompletion', () => {
  it('replaces command word and appends space', () => {
    const r = applyCompletion('/he', 3, items[0]!);
    expect(r.input).toBe('/help ');
    expect(r.cursor).toBe('/help '.length);
  });
});

describe('navigateHistory', () => {
  it('up from draft goes to last, down at end returns to draft', () => {
    expect(navigateHistory(3, null, -1)).toBe(2);
    expect(navigateHistory(3, 0, -1)).toBe(0);
    expect(navigateHistory(3, 2, 1)).toBeNull();
    expect(navigateHistory(3, 1, 1)).toBe(2);
  });

  it('empty history stays draft', () => {
    expect(navigateHistory(0, null, -1)).toBeNull();
  });
});
