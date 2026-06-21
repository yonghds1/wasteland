/**
 * Theme Type Definitions
 *
 * Defines the Theme interface for the theming system.
 * Inspired by OpenCode's comprehensive theme system.
 */

/**
 * Theme interface defining all color and style properties
 */
export interface Theme {
  /** Theme name (used for identification) */
  name: string;

  /** Human-readable description */
  description: string;

  // ============================================================
  // Primary Colors
  // ============================================================

  /** Primary accent color (headers, highlights) */
  primary: string;

  /** Secondary accent color (section headers, labels) */
  secondary: string;

  /** Muted/dim text color */
  muted: string;

  /** Border and divider color */
  border: string;

  // ============================================================
  // Status Colors
  // ============================================================

  /** Success color */
  success: string;

  /** Error color */
  error: string;

  /** Warning color */
  warning: string;

  /** Info color */
  info: string;

  // ============================================================
  // Message Type Colors
  // ============================================================

  /** User message color */
  user: string;

  /** Assistant message color */
  assistant: string;

  /** Tool message color */
  tool: string;

  /** System message color */
  system: string;

  // ============================================================
  // Background Colors (OpenCode style)
  // ============================================================

  /** Main background color */
  background: string;

  /** Secondary background (cards, sidebars) */
  backgroundSecondary: string;

  /** Darker background (status bar, headers) */
  backgroundDarker: string;

  // ============================================================
  // Text Colors (OpenCode style)
  // ============================================================

  /** Main text color */
  text: string;

  /** Emphasized text (bold, highlights) */
  textEmphasized: string;

  // ============================================================
  // Border Colors (OpenCode style)
  // ============================================================

  /** Normal border color */
  borderNormal: string;

  /** Focused border color (primary) */
  borderFocused: string;

  /** Dim border color */
  borderDim: string;

  // ============================================================
  // UI Elements
  // ============================================================

  /** Prompt symbol color */
  prompt: string;

  /** Message prefixes */
  prefix: {
    user: string;
    assistant: string;
    system: string;
  };

  // ============================================================
  // Message Border Colors (OpenCode style)
  // ============================================================

  /** Left border color for user messages */
  messageBorderUser: string;

  /** Left border color for assistant messages */
  messageBorderAssistant: string;

  /** Left border color for tool messages */
  messageBorderTool: string;

  /** Left border color for system messages */
  messageBorderSystem: string;
}
