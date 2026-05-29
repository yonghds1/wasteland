/**
 * Theme Manager
 *
 * Manages theme selection and provides access to the current theme.
 * Supports environment variable WASTELAND_THEME for theme selection.
 */

import type { Theme } from "./types.js";
import { defaultTheme } from "./default.js";
import { nordTheme } from "./nord.js";
import { monokaiTheme } from "./monokai.js";

// ============================================================
// Theme Registry
// ============================================================

/** All available themes */
export const themes: Record<string, Theme> = {
  default: defaultTheme,
  nord: nordTheme,
  monokai: monokaiTheme,
};

/** Theme names for display */
export const themeNames = Object.keys(themes);

// ============================================================
// Theme Selection
// ============================================================

/**
 * Get theme by name
 */
export function getTheme(name: string): Theme {
  return themes[name] ?? defaultTheme;
}

/**
 * Get current theme from environment variable
 *
 * Priority:
 * 1. WASTELAND_THEME environment variable
 * 2. Default theme
 */
export function getCurrentTheme(): Theme {
  const themeName = process.env.WASTELAND_THEME ?? process.env.JOE_THEME ?? "default";
  return getTheme(themeName);
}

// ============================================================
// Convenience Exports
// ============================================================

/** Current active theme (singleton) */
export const theme = getCurrentTheme();

// Re-export types and individual themes
export { type Theme } from "./types.js";
export { defaultTheme } from "./default.js";
export { nordTheme } from "./nord.js";
export { monokaiTheme } from "./monokai.js";
