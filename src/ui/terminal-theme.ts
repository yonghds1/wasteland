export const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  black: "\x1b[30m",
  brightWhite: "\x1b[97m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
  bgGray: "\x1b[100m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
} as const;

const DEFAULT_TERMINAL_COLUMNS = 80;
const MIN_PANEL_WIDTH = 24;
const MAX_PANEL_WIDTH = 72;
const STATUS_LABEL_WIDTH = 5;

export function paint(text: string, ...styles: string[]): string {
  if (styles.length === 0) {
    return text;
  }

  return `${styles.join("")}${text}${ANSI.reset}`;
}

export const PANEL_GUTTER = `${paint("│", ANSI.dim, ANSI.gray)}  `;

export function indentBlock(text: string, prefix = "  "): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

export function resolvePanelWidth(columns?: number): number {
  const terminalColumns = resolveTerminalWidth(columns);

  return Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, terminalColumns - 8));
}

export function resolveTerminalWidth(columns?: number): number {
  return typeof columns === "number" && Number.isFinite(columns) && columns > 0 ? columns : DEFAULT_TERMINAL_COLUMNS;
}

export function formatStatusLabel(label: string): string {
  return label.padEnd(STATUS_LABEL_WIDTH, " ");
}

export function wrapText(text: string, width: number): string {
  return text
    .split("\n")
    .map((line) => wrapLine(line, width))
    .join("\n");
}

function wrapLine(line: string, width: number): string {
  if (line.length === 0) {
    return "";
  }

  const chars = Array.from(line);
  const chunks: string[] = [];

  for (let index = 0; index < chars.length; index += width) {
    chunks.push(chars.slice(index, index + width).join(""));
  }

  return chunks.join("\n");
}
