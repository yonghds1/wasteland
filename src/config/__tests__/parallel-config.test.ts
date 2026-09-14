import { describe, it, expect } from 'vitest';
import { DEFAULT_WASTELAND_SETTINGS } from '../settings-types.js';

describe('Parallel Configuration', () => {
  it('has default parallel settings', () => {
    expect(DEFAULT_WASTELAND_SETTINGS.parallel).toBeDefined();
    expect(DEFAULT_WASTELAND_SETTINGS.parallel.maxConcurrency).toBe(-1);
  });

  it('parallel settings are configurable', () => {
    const settings = {
      ...DEFAULT_WASTELAND_SETTINGS,
      parallel: {
        maxConcurrency: 3,
      },
    };

    expect(settings.parallel.maxConcurrency).toBe(3);
  });

  it('parallel settings support unlimited concurrency', () => {
    const settings = {
      ...DEFAULT_WASTELAND_SETTINGS,
      parallel: {
        maxConcurrency: -1,
      },
    };

    expect(settings.parallel.maxConcurrency).toBe(-1);
  });
});
