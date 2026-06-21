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

  // ============================================================
  // Primary Colors (Monokai palette)
  // ============================================================
  primary: '#F92672', // Pink/Magenta
  secondary: '#66D9EF', // Cyan
  muted: '#75715E', // Comment gray
  border: '#49483E', // Background dark gray

  // ============================================================
  // Status Colors
  // ============================================================
  success: '#A6E22E', // Green
  error: '#F92672', // Pink/Red
  warning: '#FD971F', // Orange
  info: '#66D9EF', // Cyan

  // ============================================================
  // Message Type Colors
  // ============================================================
  user: '#66D9EF', // Cyan
  assistant: '#A6E22E', // Green
  tool: '#F92672', // Pink
  system: '#75715E', // Comment gray

  // ============================================================
  // Background Colors (OpenCode style)
  // ============================================================
  background: '#272822', // Monokai background
  backgroundSecondary: '#3E3D32', // Slightly lighter
  backgroundDarker: '#1E1F1A', // Darker variant

  // ============================================================
  // Text Colors (OpenCode style)
  // ============================================================
  text: '#F8F8F2', // Monokai text
  textEmphasized: '#FFFFFF', // Bright white

  // ============================================================
  // Border Colors (OpenCode style)
  // ============================================================
  borderNormal: '#49483E', // Monokai border
  borderFocused: '#F92672', // Primary color
  borderDim: '#3E3D32', // Dim border

  // ============================================================
  // UI Elements
  // ============================================================
  prompt: '#F92672',

  prefix: {
    user: '❯',
    assistant: '▸',
    system: '○',
  },

  // ============================================================
  // Message Border Colors (OpenCode style)
  // ============================================================
  messageBorderUser: '#66D9EF', // Cyan for user
  messageBorderAssistant: '#A6E22E', // Green for assistant
  messageBorderTool: '#75715E', // Comment gray for tool
  messageBorderSystem: '#FD971F', // Orange for system
};
