/**
 * mouse-protocol.ts - 终端鼠标协议支持（SGR 1000/1006 与 X10 协议）
 *
 * 为全屏 TUI 提供标准鼠标滚轮与点击事件解析，并管理终端鼠标模式的开启与恢复。
 */

/** Claude Code 模式：默认不开启 DEC 鼠标捕获，将鼠标左键 100% 留给终端原生划词复制 */
export const ENABLE_MOUSE_TRACKING = '';

/** 关闭鼠标跟踪模式，归还终端默认行为 */
export const DISABLE_MOUSE_TRACKING = '\x1b[?1006l\x1b[?1002l\x1b[?1000l';

export type MouseEventKind = 'wheel-up' | 'wheel-down' | 'down' | 'drag' | 'up' | 'other';

export interface MouseEvent {
  kind: MouseEventKind;
  x?: number;
  y?: number;
}

/**
 * 解析输入流中的鼠标 ANSI 序列
 *
 * 支持：
 * 1. SGR 协议：\x1b[<button;x;y(M|m)
 * 2. 传统 X10 协议：\x1b[M(cb)(cx)(cy)
 *
 * @param data - 输入字符或 ANSI 序列
 * @returns 解析出的鼠标事件，若非鼠标序列则返回 null
 */
export function parseMouseEvent(data: string): MouseEvent | null {
  if (!data || typeof data !== 'string') return null;

  // 1. SGR 协议匹配（标准现代终端模式）
  // SGR 鼠标协议必须匹配 ESC (0x1b)，属于终端协议必需的控制字符
  // eslint-disable-next-line no-control-regex
  const sgrMatch = data.charCodeAt(0) === 27 ? data.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/) : null;
  if (sgrMatch) {
    const buttonStr = sgrMatch[1];
    const xStr = sgrMatch[2];
    const yStr = sgrMatch[3];
    const action = sgrMatch[4];
    if (buttonStr === undefined || xStr === undefined || yStr === undefined || action === undefined) return null;
    const button = parseInt(buttonStr, 10);
    const x = parseInt(xStr, 10);
    const y = parseInt(yStr, 10);

    // button 64 为滚轮向上，65 为滚轮向下
    if (button === 64) {
      return { kind: 'wheel-up', x, y };
    }
    if (button === 65) {
      return { kind: 'wheel-down', x, y };
    }
    // 鼠标释放 (action 'm')
    if (action === 'm') {
      return { kind: 'up', x, y };
    }
    // 鼠标左键按下 (button 0, action 'M')
    if (button === 0 && action === 'M') {
      return { kind: 'down', x, y };
    }
    // 鼠标左键拖拽移动 (button 32, action 'M')
    if (button === 32 && action === 'M') {
      return { kind: 'drag', x, y };
    }
    return { kind: 'other', x, y };
  }

  // 2. 传统 X10 协议匹配
  if (data.startsWith('\x1b[M') && data.length >= 6) {
    const b = data.charCodeAt(3) - 32;
    const x = data.charCodeAt(4) - 32;
    const y = data.charCodeAt(5) - 32;
    if (b === 64) {
      return { kind: 'wheel-up', x, y };
    }
    if (b === 65) {
      return { kind: 'wheel-down', x, y };
    }
    if (b === 0) {
      return { kind: 'down', x, y };
    }
    if (b === 32) {
      return { kind: 'drag', x, y };
    }
    if (b === 3) {
      return { kind: 'up', x, y };
    }
    return { kind: 'other', x, y };
  }

  return null;
}
