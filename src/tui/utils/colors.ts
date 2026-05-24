/**
 * TUI Color Constants (Hermes-inspired theme)
 *
 * Uses ink color names (not ANSI codes) for React TUI components.
 * Based on Hermes default skin: gold/amber theme.
 */

// ============================================================
// Primary Colors (Hermes gold theme)
// ============================================================

/** Gold - primary accent for headers and highlights */
export const GOLD = "#FFD700";

/** Amber - secondary accent for section headers */
export const AMBER = "#FFBF00";

/** Bronze - borders and dividers */
export const BRONZE = "#CD7F32";

/** Dark goldenrod - dim/muted text */
export const DARK_GOLDENROD = "#B8860B";

/** Goldenrod - labels */
export const GOLDENROD = "#DAA520";

/** Cornsilk - body text */
export const CORNSILK = "#FFF8DC";

// ============================================================
// Status Colors
// ============================================================

/** Success green */
export const SUCCESS = "#4caf50";

/** Error red */
export const ERROR = "#ef5350";

/** Warning orange */
export const WARNING = "#ffa726";

// ============================================================
// Message Type Colors
// ============================================================

/** User messages - cyan */
export const USER_MSG = "cyan";

/** Assistant messages - green */
export const ASSISTANT_MSG = "green";

/** Tool messages - magenta */
export const TOOL_MSG = "magenta";

/** System messages - gray */
export const SYSTEM_MSG = "gray";

// ============================================================
// Ink Color Names (for use with ink components)
// ============================================================

/**
 * Map hex colors to ink color names where possible,
 * or use hex directly (ink supports hex colors)
 */
export const TUI_COLORS = {
  // Primary
  gold: GOLD,
  amber: AMBER,
  bronze: BRONZE,

  // Status
  success: SUCCESS,
  error: ERROR,
  warning: WARNING,

  // Message types
  user: USER_MSG,
  assistant: ASSISTANT_MSG,
  tool: TOOL_MSG,
  system: SYSTEM_MSG,

  // UI elements
  headerTitle: GOLD,
  headerDim: DARK_GOLDENROD,
  tabActive: GOLD,
  tabInactive: "gray",
  borderDefault: "gray",
  borderAccent: BRONZE,

  // Agent status
  agentRunning: "green",
  agentIdle: "gray",
  agentCompleted: "green",
  agentFailed: "red",
  agentTimeout: "yellow",
} as const;

// ============================================================
// Message Prefixes (Hermes style)
// ============================================================

/** User message prefix */
export const USER_PREFIX = "❯";

/** Assistant message prefix */
export const ASSISTANT_PREFIX = "✦";

/** System message prefix */
export const SYSTEM_PREFIX = "ℹ";

/** Streaming cursor */
export const STREAMING_CURSOR = "▌";

/** Message separator line */
export const MESSAGE_SEPARATOR = "─".repeat(48);

// ============================================================
// Status Icons
// ============================================================

export const STATUS_ICONS = {
  running: "●",
  idle: "○",
  completed: "✓",
  failed: "✗",
  timeout: "⏱",
  success: "✓",
  error: "✗",
} as const;

// ============================================================
// Tool Icons (matching tools)
// ============================================================

export const TOOL_ICONS: Record<string, string> = {
  "read-file": "📖",
  "read_file": "📖",
  "write-file": "✍️",
  "write_file": "✍️",
  "edit-file": "✏️",
  "edit_file": "✏️",
  bash: "💻",
  terminal: "💻",
  "search-files": "🔎",
  search_files: "🔎",
  "web-search": "🔍",
  web_search: "🔍",
  default: "⚡",
} as const;

// ============================================================
// Tool Verbs (for display)
// ============================================================

export const TOOL_VERBS: Record<string, string> = {
  "read-file": "read",
  "read_file": "read",
  "write-file": "write",
  "write_file": "write",
  "edit-file": "edit",
  "edit_file": "edit",
  bash: "exec",
  terminal: "exec",
  default: "tool",
} as const;

// ============================================================
// Prompt Symbols
// ============================================================

export const PROMPT_SYMBOL = "❯";

export const INPUT_PROMPT = "❯";

// ============================================================
// Separator Characters
// ============================================================

export const SEPARATORS = {
  /** Used between help items */
  item: " ┊ ",
  /** Line separator */
  line: "─",
  /** Tree branch */
  branch: "└─",
  /** Tree vertical */
  vertical: "│",
  /** Tool prefix (Hermes style) */
  tool: "┊",
} as const;
