/**
 * Nord Theme - Arctic, bluish, clean color palette
 *
 * Based on the Nord color scheme - an arctic, bluish, clean color palette.
 * https://www.nordtheme.com/
 */

import type { Theme } from './types.js';

export const nordTheme: Theme = {
  name: 'nord',
  description: 'Nord - Arctic, bluish, clean color palette',

  // Primary Colors (Nord palette)
  primary: '#88C0D0', // Nord6 - Snow storm (light blue)
  secondary: '#81A1C1', // Nord9 - Aurora (medium blue)
  muted: '#D8DEE9', // Nord4 - Snow storm (light gray)
  border: '#4C566A', // Nord3 - Polar Night (dark gray)

  // Status Colors
  success: '#A3BE8C', // Nord14 - Aurora (green)
  error: '#BF616A', // Nord11 - Aurora (red)
  warning: '#EBCB8B', // Nord13 - Aurora (yellow)
  info: '#88C0D0', // Nord6 - Snow storm (light blue)

  // Message Type Colors
  user: '#88C0D0', // Nord6 - Snow storm
  assistant: '#A3BE8C', // Nord14 - Aurora (green)
  tool: '#B48EAD', // Nord15 - Aurora (purple)
  system: '#616E88', // Nord8 - Polar Night (medium gray)

  // UI Elements
  prompt: '#88C0D0',

  prefix: {
    user: '❯',
    assistant: '◇',
    system: '○',
  },
};
