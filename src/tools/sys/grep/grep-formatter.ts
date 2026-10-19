/**
 * grep-formatter.ts - Grep 结果解析与格式化输出
 */

import type { SearchEngineType } from './search-engine-detector.js';

export const MAX_LINE_LENGTH = 500;

export interface GrepLineItem {
  lineNum: number;
  isMatch: boolean;
  content: string;
}

export interface FileGrepResult {
  filePath: string;
  lines: GrepLineItem[];
}

export function truncateLine(line: string): string {
  if (line.length <= MAX_LINE_LENGTH) {
    return line;
  }
  return line.slice(0, MAX_LINE_LENGTH) + '…';
}

export function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

/**
 * 解析 ripgrep 或 git-grep 的标准输出
 */
export function parseRawGrepOutput(
  rawStdout: string,
  maxMatches: number,
  includePattern?: string,
): FileGrepResult[] {
  const fileMap = new Map<string, GrepLineItem[]>();
  let totalMatchCount = 0;
  const includeRegex = includePattern ? globToRegex(includePattern) : null;

  const rawLines = rawStdout.split('\n');
  for (const rawLine of rawLines) {
    if (!rawLine || rawLine === '--') {
      continue;
    }

    const matched = rawLine.match(/^(.*?)([:-])(\d+)\2(.*)$/);
    if (!matched) {
      continue;
    }

    const [, filePath, sep, lineNumStr, content] = matched;
    const isMatch = sep === ':';

    if (includeRegex) {
      const fileName = filePath.split('/').pop() ?? filePath;
      if (!includeRegex.test(fileName) && !includeRegex.test(filePath)) {
        continue;
      }
    }

    if (isMatch) {
      if (totalMatchCount >= maxMatches) {
        continue;
      }
      totalMatchCount++;
    }

    let items = fileMap.get(filePath);
    if (!items) {
      items = [];
      fileMap.set(filePath, items);
    }

    const lineNum = parseInt(lineNumStr, 10);
    const existing = items.find((i) => i.lineNum === lineNum);
    if (existing) {
      if (isMatch) {
        existing.isMatch = true;
      }
    } else {
      items.push({
        lineNum,
        isMatch,
        content: truncateLine(content),
      });
    }
  }

  const results: FileGrepResult[] = [];
  for (const [filePath, lines] of fileMap.entries()) {
    if (lines.some((l) => l.isMatch)) {
      lines.sort((a, b) => a.lineNum - b.lineNum);
      results.push({ filePath, lines });
    }
  }
  return results;
}

/**
 * 格式化搜索结果并生成统计摘要
 */
export function formatGrepOutput(
  results: FileGrepResult[],
  engine: SearchEngineType,
): string {
  let totalMatches = 0;
  for (const file of results) {
    for (const line of file.lines) {
      if (line.isMatch) {
        totalMatches++;
      }
    }
  }

  const fileCount = results.length;
  const header = `Found ${totalMatches} matches in ${fileCount} files (using ${engine} engine)`;

  if (totalMatches === 0 || fileCount === 0) {
    return header;
  }

  const blocks: string[] = [];
  for (const file of results) {
    const linesOut: string[] = [];
    let prevLineNum = -1;

    for (const item of file.lines) {
      if (prevLineNum !== -1 && item.lineNum > prevLineNum + 1) {
        linesOut.push('--');
      }
      prevLineNum = item.lineNum;

      const sep = item.isMatch ? ':' : '-';
      linesOut.push(item.content ? `${item.lineNum}${sep} ${item.content}` : `${item.lineNum}${sep}`);
    }

    blocks.push(`${file.filePath}\n${linesOut.join('\n')}`);
  }

  return `${header}\n\n${blocks.join('\n\n')}`;
}
