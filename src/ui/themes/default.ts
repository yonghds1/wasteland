/**
 * Default Theme - Modern Clean Style
 *
 * A modern, clean theme with cyan-blue primary color.
 * Inspired by modern CLI tools with a fresh, vibrant look.
 */

import type { Theme } from './types.js';

export const defaultTheme: Theme = {
  name: 'default',
  description: 'Modern clean theme with cyan-blue accent',

  // ============================================================
  // Primary Colors
  // ============================================================
  primary: '#00D4FF', // Cyan-blue
  secondary: '#7C3AED', // Purple
  muted: '#6B7280', // Gray
  border: '#374151', // Dark gray

  // ============================================================
  // Status Colors
  // ============================================================
  success: '#10B981', // Green
  error: '#EF4444', // Red
  warning: '#F59E0B', // Amber
  info: '#3B82F6', // Blue

  // ============================================================
  // Message Type Colors
  // ============================================================
  user: 'cyan',
  assistant: 'green',
  tool: 'magenta',
  system: 'gray',

  // ============================================================
  // Background Colors (OpenCode style)
  // ============================================================
  background: '#1E1E2E', // Dark background
  backgroundSecondary: '#2D2D3F', // Slightly lighter
  backgroundDarker: '#15151F', // Darker for status bar

  // ============================================================
  // Text Colors (OpenCode style)
  // ============================================================
  text: '#CDD6F4', // Light text
  textEmphasized: '#FFFFFF', // Bright white for emphasis

  // ============================================================
  // Border Colors (OpenCode style)
  // ============================================================
  borderNormal: '#45475A', // Normal borders
  borderFocused: '#00D4FF', // Focused (primary color)
  borderDim: '#313244', // Dim borders

  // ============================================================
  // UI Elements
  // ============================================================
  prompt: '#00D4FF',

  prefix: {
    user: '❯',
    assistant: '◆',
    system: 'ℹ',
  },

  // ============================================================
  // Message Border Colors (OpenCode style)
  // ============================================================
  messageBorderUser: '#7C3AED', // Purple for user
  messageBorderAssistant: '#00D4FF', // Cyan for assistant
  messageBorderTool: '#6B7280', // Gray for tool
  messageBorderSystem: '#F59E0B', // Amber for system
};
