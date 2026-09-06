import { describe, expect, it } from 'vitest';

import { buildShortcutsSection, formatKeyCombo } from '../HelpCommandsView.js';

describe('formatKeyCombo', () => {
  it('formats modifiers and arrows', () => {
    expect(formatKeyCombo({ ctrl: true, key: 'c' })).toBe('Ctrl+C');
    expect(formatKeyCombo({ key: 'upArrow' })).toBe('↑');
    expect(formatKeyCombo({ key: 'return' })).toBe('Enter');
  });

  it('decodes shift+tab raw input', () => {
    expect(formatKeyCombo({ rawInput: '\x1b[Z' })).toBe('Shift+Tab');
  });
});

describe('buildShortcutsSection', () => {
  it('includes registry bindings and manual supplements', () => {
    const lines = buildShortcutsSection();
    const text = lines.join('\n');
    expect(text).toContain('Ctrl+C');
    expect(text).toContain('Tab');
    expect(text).toContain('Ctrl+O');
    expect(text).toContain('Alt+1~9');
  });
});
