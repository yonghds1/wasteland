import { describe, expect, it } from 'vitest';

import { formatCompactStatus } from '../CompactStatusBar.js';

describe('formatCompactStatus', () => {
  it('renders one-line mode/tokens/tools summary', () => {
    expect(
      formatCompactStatus({
        modeLabel: 'Mode',
        mode: 'multi',
        tokensLabel: 'Tokens',
        usedK: '1.2',
        windowK: '200',
        ratioPct: 1,
        toolsLabel: 'Tools',
        success: 3,
        errors: 1,
      }),
    ).toBe('Mode: multi · Tokens: 1.2/200 (1%) · Tools: 3✓ 1✗');
  });
});
