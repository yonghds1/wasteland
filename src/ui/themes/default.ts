/**
 * Default Theme - Modern Clean Style
 *
 * A modern, clean theme with cyan-blue primary color.
 * Inspired by modern CLI tools with a fresh, vibrant look.
 */

import type { Theme } from "./types.js";

export const defaultTheme: Theme = {
  name: "default",
  description: "Modern clean theme with cyan-blue accent",

  // Primary Colors
  primary: "#00D4FF",      // Cyan-blue
  secondary: "#7C3AED",    // Purple
  muted: "#6B7280",        // Gray
  border: "#374151",       // Dark gray

  // Status Colors
  success: "#10B981",      // Green
  error: "#EF4444",        // Red
  warning: "#F59E0B",      // Amber
  info: "#3B82F6",         // Blue

  // Message Type Colors
  user: "cyan",
  assistant: "green",
  tool: "magenta",
  system: "gray",

  // UI Elements
  prompt: "#00D4FF",

  prefix: {
    user: "❯",
    assistant: "◆",
    system: "ℹ",
  },
};
