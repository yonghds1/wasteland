/**
 * text-buffer.ts
 * 纯数学与文本操作函数，提供一维/二维坐标映射、多行导航与视口窗口计算。
 * 零 JSX、零状态依赖。
 */

export interface LineMetrics {
  lines: string[];
  starts: number[];
  ends: number[];
}

export interface RowCol {
  row: number;
  col: number;
}

export interface VerticalMoveResult {
  nextOffset: number;
  escaped: boolean;
  newPreferredCol: number;
}

export interface TextEditResult {
  text: string;
  offset: number;
}

export interface VisibleLinesResult {
  visibleLines: string[];
  startLineIndex: number;
}

/**
 * 计算多行文本的行切片与各行起止 offset（ends 为每行末尾，不含换行符）
 */
export function getLineMetrics(text: string): LineMetrics {
  const lines = text.split('\n');
  const starts: number[] = new Array(lines.length);
  const ends: number[] = new Array(lines.length);

  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    starts[i] = pos;
    pos += (lines[i] ?? '').length;
    ends[i] = pos;
    pos += 1; // 跳过 '\n'
  }

  return { lines, starts, ends };
}

/**
 * 一维字符串 offset 转换为二维 row, col（0-indexed）
 */
export function offsetToRowCol(text: string, offset: number): RowCol {
  const { lines, starts, ends } = getLineMetrics(text);
  const clamped = Math.max(0, Math.min(offset, text.length));

  for (let i = 0; i < lines.length; i++) {
    if (i === lines.length - 1 || clamped <= (ends[i] ?? 0)) {
      return {
        row: i,
        col: clamped - (starts[i] ?? 0),
      };
    }
  }

  return { row: lines.length - 1, col: (lines[lines.length - 1] ?? '').length };
}

/**
 * 二维 row, col 转换为一维字符串 offset
 */
export function rowColToOffset(text: string, row: number, col: number): number {
  const { lines, starts } = getLineMetrics(text);
  const clampedRow = Math.max(0, Math.min(row, lines.length - 1));
  const lineLen = (lines[clampedRow] ?? '').length;
  const clampedCol = Math.max(0, Math.min(col, lineLen));
  return (starts[clampedRow] ?? 0) + clampedCol;
}

/**
 * 纵向跨行移动与历史逃逸：
 * - dir === -1 时，若处于首行 (row === 0) 则 escaped: true，否则上移一行
 * - dir === 1 时，若处于末行 (row === lines.length - 1) 则 escaped: true，否则下移一行
 * - 保留 preferredCol
 */
export function moveCursorVertical(
  text: string,
  offset: number,
  dir: -1 | 1,
  preferredCol?: number | null
): VerticalMoveResult {
  const { lines } = getLineMetrics(text);
  const { row, col } = offsetToRowCol(text, offset);
  const targetCol = preferredCol ?? col;

  if (dir === -1) {
    if (row === 0) {
      return { nextOffset: offset, escaped: true, newPreferredCol: targetCol };
    }
    const nextRow = row - 1;
    return {
      nextOffset: rowColToOffset(text, nextRow, targetCol),
      escaped: false,
      newPreferredCol: targetCol,
    };
  }

  if (row >= lines.length - 1) {
    return { nextOffset: offset, escaped: true, newPreferredCol: targetCol };
  }
  const nextRow = row + 1;
  return {
    nextOffset: rowColToOffset(text, nextRow, targetCol),
    escaped: false,
    newPreferredCol: targetCol,
  };
}

/**
 * 移动光标至当前行行首 (Home / Ctrl+A)
 */
export function moveToLineStart(text: string, offset: number): number {
  const { row } = offsetToRowCol(text, offset);
  const { starts } = getLineMetrics(text);
  return starts[row] ?? 0;
}

/**
 * 移动光标至当前行行尾 (End / Ctrl+E)
 */
export function moveToLineEnd(text: string, offset: number): number {
  const { row } = offsetToRowCol(text, offset);
  const { ends } = getLineMetrics(text);
  return ends[row] ?? text.length;
}

/**
 * 删除当前光标到当前行行首的内容 (Ctrl+U)
 */
export function deleteToLineStart(text: string, offset: number): TextEditResult {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const { row } = offsetToRowCol(text, clamped);
  const { starts } = getLineMetrics(text);
  const lineStart = starts[row] ?? 0;

  if (clamped <= lineStart) {
    return { text, offset: clamped };
  }

  return {
    text: text.slice(0, lineStart) + text.slice(clamped),
    offset: lineStart,
  };
}

/**
 * 删除当前光标到当前行行尾的内容 (Ctrl+K)
 * 若已在行尾且存在下一行，则删除换行符合并下一行
 */
export function deleteToLineEnd(text: string, offset: number): TextEditResult {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const { row } = offsetToRowCol(text, clamped);
  const { ends, lines } = getLineMetrics(text);
  const lineEnd = ends[row] ?? text.length;

  if (clamped < lineEnd) {
    return {
      text: text.slice(0, clamped) + text.slice(lineEnd),
      offset: clamped,
    };
  }

  if (clamped === lineEnd && row < lines.length - 1) {
    return {
      text: text.slice(0, clamped) + text.slice(clamped + 1),
      offset: clamped,
    };
  }

  return { text, offset: clamped };
}

/**
 * 删除光标前的一个单词 (Ctrl+W)
 */
export function deleteWordBefore(text: string, offset: number): TextEditResult {
  const clamped = Math.max(0, Math.min(offset, text.length));
  if (clamped === 0) return { text, offset: 0 };

  let i = clamped;
  while (i > 0 && (text[i - 1] === ' ' || text[i - 1] === '\t')) {
    i--;
  }

  if (i === 0 || text[i - 1] === '\n') {
    return {
      text: text.slice(0, i) + text.slice(clamped),
      offset: i,
    };
  }

  const isWordChar = (ch: string) => /[\w\p{L}\p{N}_]/u.test(ch);
  if (isWordChar(text[i - 1] ?? '')) {
    while (i > 0 && isWordChar(text[i - 1] ?? '')) {
      i--;
    }
  } else {
    while (
      i > 0 &&
      !isWordChar(text[i - 1] ?? '') &&
      text[i - 1] !== ' ' &&
      text[i - 1] !== '\t' &&
      text[i - 1] !== '\n'
    ) {
      i--;
    }
  }

  return {
    text: text.slice(0, i) + text.slice(clamped),
    offset: i,
  };
}

/**
 * 根据光标所在行计算可见视口窗口
 */
export function getVisibleLinesWindow(
  lines: string[],
  cursorRow: number,
  maxRows: number,
  prevStartLineIndex?: number
): VisibleLinesResult {
  const maxR = Math.max(1, maxRows);
  const total = lines.length;

  if (total <= maxR) {
    return {
      visibleLines: [...lines],
      startLineIndex: 0,
    };
  }

  const clampedRow = Math.max(0, Math.min(cursorRow, total - 1));
  let start: number;

  if (prevStartLineIndex !== undefined) {
    start = prevStartLineIndex;
    if (clampedRow < start) {
      start = clampedRow;
    } else if (clampedRow >= start + maxR) {
      start = clampedRow - maxR + 1;
    }
  } else {
    if (clampedRow < maxR) {
      start = 0;
    } else {
      start = clampedRow - maxR + 1;
    }
  }

  start = Math.max(0, Math.min(start, total - maxR));

  return {
    visibleLines: lines.slice(start, start + maxR),
    startLineIndex: start,
  };
}
