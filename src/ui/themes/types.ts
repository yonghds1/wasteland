/**
 * Theme Type Definitions
 *
 * Defines the Theme interface for the theming system.
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
}
