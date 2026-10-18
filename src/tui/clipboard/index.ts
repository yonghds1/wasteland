/**
 * src/tui/clipboard/index.ts
 *
 * 剪贴板模块统一导出
 */

import { writeOsc52Clipboard, extractCleanText, extractLastCodeBlock } from './osc52.js';

export interface CopyToClipboardOptions {
  codeOnly?: boolean;
  stream?: NodeJS.WriteStream;
}

/**
 * 复制文本到系统剪贴板（基于 OSC 52 协议）。
 * - 默认过滤 <think> 思考标签，复制纯净正文；
 * - 若指定 codeOnly: true，则仅提取并复制最后一个代码块，无代码块时返回 false。
 */
export function copyToClipboard(text: string, options?: CopyToClipboardOptions): boolean {
  const clean = extractCleanText(text);

  if (options?.codeOnly) {
    const code = extractLastCodeBlock(clean);
    if (code === null) {
      return false;
    }
    return writeOsc52Clipboard(code, options?.stream);
  }

  if (!clean) {
    return false;
  }

  return writeOsc52Clipboard(clean, options?.stream);
}

export { writeOsc52Clipboard, extractLastCodeBlock, extractCleanText } from './osc52.js';
