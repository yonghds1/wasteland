/**
 * TUI Color Constants
 *
 * Uses ink color names (not ANSI codes) for React TUI components.
 * Gets colors from the theme system.
 */

import { theme } from '../../ui/themes/index.js';

// ============================================================
// Primary Colors (from theme)
// ============================================================

/** Primary accent color */
export const PRIMARY = theme.primary;

/** Secondary accent color */
export const SECONDARY = theme.secondary;

/** Muted/dim text color */
export const MUTED = theme.muted;

/** Border and divider color */
export const BORDER = theme.border;

// ============================================================
// Status Colors (from theme)
// ============================================================

/** Success color */
export const SUCCESS = theme.success;

/** Error color */
export const ERROR = theme.error;

/** Warning color */
export const WARNING = theme.warning;

/** Info color */
export const INFO = theme.info;

// ============================================================
// Message Type Colors (from theme)
// ============================================================

/** User messages */
export const USER_MSG = theme.user;

/** Assistant messages */
export const ASSISTANT_MSG = theme.assistant;

/** Tool messages */
export const TOOL_MSG = theme.tool;

/** System messages */
export const SYSTEM_MSG = theme.system;

// ============================================================
// Background Colors (OpenCode style)
// ============================================================

/** Main background color */
export const BACKGROUND = theme.background;

/** Secondary background */
export const BACKGROUND_SECONDARY = theme.backgroundSecondary;

/** Darker background */
export const BACKGROUND_DARKER = theme.backgroundDarker;

// ============================================================
// Text Colors (OpenCode style)
// ============================================================

/** Main text color */
export const TEXT = theme.text;

/** Emphasized text */
export const TEXT_EMPHASIZED = theme.textEmphasized;

// ============================================================
// Border Colors (OpenCode style)
// ============================================================

/** Normal border color */
export const BORDER_NORMAL = theme.borderNormal;

/** Focused border color */
export const BORDER_FOCUSED = theme.borderFocused;

/** Dim border color */
export const BORDER_DIM = theme.borderDim;

// ============================================================
// Message Border Colors (OpenCode style)
// ============================================================

/** Left border color for user messages */
export const MSG_BORDER_USER = theme.messageBorderUser;

/** Left border color for assistant messages */
export const MSG_BORDER_ASSISTANT = theme.messageBorderAssistant;

/** Left border color for tool messages */
export const MSG_BORDER_TOOL = theme.messageBorderTool;

/** Left border color for system messages */
export const MSG_BORDER_SYSTEM = theme.messageBorderSystem;

// ============================================================
// Ink Color Names (for use with ink components)
// ============================================================

/**
 * Map theme colors for ink components
 * (ink supports hex colors directly)
 */
export const TUI_COLORS = {
  // Primary
  primary: PRIMARY,
  secondary: SECONDARY,
  border: BORDER,

  // Status
  success: SUCCESS,
  error: ERROR,
  warning: WARNING,
  info: INFO,

  // Message types
  user: USER_MSG,
  assistant: ASSISTANT_MSG,
  tool: TOOL_MSG,
  system: SYSTEM_MSG,

  // Backgrounds (OpenCode style)
  background: BACKGROUND,
  backgroundSecondary: BACKGROUND_SECONDARY,
  backgroundDarker: BACKGROUND_DARKER,

  // Text (OpenCode style)
  text: TEXT,
  textEmphasized: TEXT_EMPHASIZED,

  // Borders (OpenCode style)
  borderNormal: BORDER_NORMAL,
  borderFocused: BORDER_FOCUSED,
  borderDim: BORDER_DIM,

  // Message borders (OpenCode style)
  msgBorderUser: MSG_BORDER_USER,
  msgBorderAssistant: MSG_BORDER_ASSISTANT,
  msgBorderTool: MSG_BORDER_TOOL,
  msgBorderSystem: MSG_BORDER_SYSTEM,

  // UI elements
  headerTitle: PRIMARY,
  headerDim: MUTED,
  tabActive: PRIMARY,
  tabInactive: 'gray',
  borderDefault: 'gray',
  borderAccent: BORDER,

  // Agent status
  agentRunning: 'green',
  agentIdle: 'gray',
  agentCompleted: 'green',
  agentFailed: 'red',
  agentTimeout: 'yellow',
} as const;

// ============================================================
// Message Prefixes (from theme)
// ============================================================

/** User message prefix */
export const USER_PREFIX = theme.prefix.user;

/** Assistant message prefix */
export const ASSISTANT_PREFIX = theme.prefix.assistant;

/** System message prefix */
export const SYSTEM_PREFIX = theme.prefix.system;

/** Streaming cursor */
export const STREAMING_CURSOR = '▌';

/** Message separator line */
export const MESSAGE_SEPARATOR = '─'.repeat(48);

// ============================================================
// Status Icons
// ============================================================

export const STATUS_ICONS = {
  running: '●',
  idle: '○',
  completed: '✓',
  failed: '✗',
  timeout: '⏱',
  success: '✓',
  error: '✗',
} as const;

// ============================================================
// Tool Icons (matching tools)
// ============================================================

export const TOOL_ICONS: Record<string, string> = {
  'read-file': '📖',
  read_file: '📖',
  'write-file': '✍️',
  write_file: '✍️',
  'edit-file': '✏️',
  edit_file: '✏️',
  bash: '💻',
  terminal: '💻',
  'search-files': '🔎',
  search_files: '🔎',
  'web-search': '🔍',
  web_search: '🔍',
  default: '⚡',
} as const;

// ============================================================
// Tool Verbs (for display)
// ============================================================

export const TOOL_VERBS: Record<string, string> = {
  'read-file': 'read',
  read_file: 'read',
  'write-file': 'write',
  write_file: 'write',
  'edit-file': 'edit',
  edit_file: 'edit',
  bash: 'exec',
  terminal: 'exec',
  default: 'tool',
} as const;

// ============================================================
// Prompt Symbols
// ============================================================

export const PROMPT_SYMBOL = theme.prefix.user;

export const INPUT_PROMPT = theme.prefix.user;

// ============================================================
// Separator Characters
// ============================================================

export const SEPARATORS = {
  /** Used between help items */
  item: ' ┊ ',
  /** Line separator */
  line: '─',
  /** Tree branch */
  branch: '└─',
  /** Tree vertical */
  vertical: '│',
  /** Tool prefix */
  tool: '┊',
} as const;
