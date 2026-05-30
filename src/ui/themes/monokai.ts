/**
 * Monokai Theme - Classic Editor Style
 *
 * Based on the classic Monokai color scheme.
 * A vibrant, high-contrast theme popular in code editors.
 */

import type { Theme } from './types.js';

export const monokaiTheme: Theme = {
  name: 'monokai',
  description: 'Monokai - Classic editor style with vibrant colors',

  // Primary Colors (Monokai palette)
  primary: '#F92672', // Pink/Magenta
  secondary: '#66D9EF', // Cyan
  muted: '#75715E', // Comment gray
  border: '#49483E', // Background dark gray

  // Status Colors
  success: '#A6E22E', // Green
  error: '#F92672', // Pink/Red
  warning: '#FD971F', // Orange
  info: '#66D9EF', // Cyan

  // Message Type Colors
  user: '#66D9EF', // Cyan
  assistant: '#A6E22E', // Green
  tool: '#F92672', // Pink
  system: '#75715E', // Comment gray

  // UI Elements
  prompt: '#F92672',

  prefix: {
    user: '❯',
    assistant: '▸',
    system: '○',
  },
};
