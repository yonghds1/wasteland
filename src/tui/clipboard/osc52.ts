
/**
 * src/tui/clipboard/osc52.ts
 *
 * OSC 52 穿透系统剪贴板实现与文本/代码块提取工具
 */

import { Buffer } from 'node:buffer';

/**
 * 将文本通过 OSC 52 转义序列写入终端或目标流，支持 tmux 与 screen 穿透。
 */
export function writeOsc52Clipboard(text: string, stream?: NodeJS.WriteStream): boolean {
  try {
    const b64 = Buffer.from(text, 'utf-8').toString('base64');
    let seq = `\x1b]52;c;${b64}\x07`;

    if (process.env.TMUX) {
      seq = `\x1bPtmux;\x1b${seq.replaceAll('\x1b', '\x1b\x1b')}\x1b\\`;
    } else if (process.env.TERM?.startsWith('screen') || process.env.STY) {
      seq = `\x1bP${seq}\x1b\\`;
    }

    const target = stream ?? process.stdout;
    const result = target.write(seq);
    return result !== false;
  } catch {
    return false;
  }
}

/**
 * 提取文本中最后一个 ``` 代码块的正文，若不存在代码块则返回 null。
 */
export function extractLastCodeBlock(text: string): string | null {
  const regex = /```[^\r\n]*\r?\n([\s\S]*?)\r?\n```/g;
  const matches = Array.from(text.matchAll(regex));
  if (matches.length > 0) {
    const last = matches[matches.length - 1];
    return last?.[1] ?? null;
  }

  const fallback = Array.from(text.matchAll(/```[^\r\n]*\r?\n([\s\S]*?)```/g));
  if (fallback.length > 0) {
    const last = fallback[fallback.length - 1];
    return last?.[1] ?? null;
  }

  return null;
}

/**
 * 过滤文本中的 <think>...</think> 标签，返回纯净正文。
 */
export function extractCleanText(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}
