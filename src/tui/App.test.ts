import { describe, it, expect } from 'vitest';
import { shouldEnterInputModeOnReturn } from './App.js';

describe('shouldEnterInputModeOnReturn', () => {
  it('returns true for navigation mode outside agentTabs', () => {
    expect(
      shouldEnterInputModeOnReturn({
        inputMode: false,
        showHelp: null,
        exitConfirmPending: false,
        focusArea: 'inputBar',
      })
    ).toBe(true);
  });

  it('returns false when focusArea is agentTabs', () => {
    expect(
      shouldEnterInputModeOnReturn({
        inputMode: false,
        showHelp: null,
        exitConfirmPending: false,
        focusArea: 'agentTabs',
      })
    ).toBe(false);
  });

  it('returns false when already in inputMode', () => {
    expect(
      shouldEnterInputModeOnReturn({
        inputMode: true,
        showHelp: null,
        exitConfirmPending: false,
        focusArea: 'inputBar',
      })
    ).toBe(false);
  });
});
