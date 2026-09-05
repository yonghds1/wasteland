/**
 * input-pipeline.ts - 统一输入流分流管道
 *
 * 在 process.stdin 最底层拦截并消费鼠标控制帧（SGR 协议），
 * 触发全局鼠标事件总线，同时阻断鼠标控制帧进入 React / Ink 键盘输入流，
 * 从根本上杜绝 ANSI 鼠标序列泄漏到聊天输入框或任何 UI 组件。
 */

import { EventEmitter } from 'node:events';
import type { MouseEvent, MouseEventKind } from '../mouse/mouse-protocol.js';

export interface InputPipelineEvents {
  mouse: (event: MouseEvent) => void;
}

/** SGR 鼠标序列正则表达式（全局匹配，含终端 ESC 控制字符，协议必需） */
// eslint-disable-next-line no-control-regex
const SGR_MOUSE_REGEX = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
/** 传统 X10 鼠标序列正则表达式 */
// eslint-disable-next-line no-control-regex
const X10_MOUSE_REGEX = /\x1b\[M([\s\S]{3})/g;

export class InputPipeline extends EventEmitter {
  private isAttached = false;
  private originalEmit?: typeof process.stdin.emit;
  private boundStdin?: NodeJS.ReadStream;
  private buffer = '';
  private flushTimer: NodeJS.Timeout | null = null;

  /**
   * 挂载到 stdin，拦截并分流鼠标事件
   *
   * @param stdin - 输入流（默认 process.stdin）
   */
  public attach(stdin: NodeJS.ReadStream = process.stdin): void {
    if (this.isAttached || !stdin) return;
    this.isAttached = true;
    this.boundStdin = stdin;

    const originalEmit = stdin.emit.bind(stdin);
    this.originalEmit = originalEmit;

    // 重写 stdin.emit，在 'data' 和 'keypress' 事件分发前精准识别并完全消化鼠标帧
    // 用箭头函数保持 InputPipeline 的 this 绑定，避免 self 别名
    stdin.emit = (event: string | symbol, ...args: unknown[]): boolean => {
      // 1. 拦截下游 readline 产生的 keypress 鼠标泄漏残片
      if (event === 'keypress') {
        const [char, key] = args as [unknown, { sequence?: string; code?: string } | undefined];
        if (
          (key && (key.sequence?.startsWith('\x1b[<') || key.sequence?.startsWith('\x1b[M') || key.code === '[<')) ||
          (typeof char === 'string' && (char.includes('\x1b[<') || char.includes('[<')))
        ) {
          return true; // 拦截 keypress 鼠标泄漏
        }
        return originalEmit(event, ...args);
      }

      // 2. 拦截原始底层 data 字节流
      if (event === 'data' && args.length > 0) {
        const chunk = args[0];
        const str = typeof chunk === 'string' ? chunk : chunk instanceof Buffer ? chunk.toString('utf8') : '';

        if (str && (str.includes('\x1b[<') || str.includes('\x1b[M') || str.includes('[<') || this.buffer.length > 0)) {
          this.buffer += str;

          // (1) 全局提取并广播所有 SGR 鼠标事件
          let match: RegExpExecArray | null;
          SGR_MOUSE_REGEX.lastIndex = 0;
          while ((match = SGR_MOUSE_REGEX.exec(this.buffer)) !== null) {
            const buttonStr = match[1];
            const xStr = match[2];
            const yStr = match[3];
            const action = match[4];
            if (buttonStr === undefined || xStr === undefined || yStr === undefined || action === undefined) continue;
            const button = parseInt(buttonStr, 10);
            const x = parseInt(xStr, 10);
            const y = parseInt(yStr, 10);
            let kind: MouseEventKind = 'other';
            if (button === 64) kind = 'wheel-up';
            else if (button === 65) kind = 'wheel-down';
            else if (action === 'm') kind = 'up';
            else if (button === 0 && action === 'M') kind = 'down';
            else if (button === 32 && action === 'M') kind = 'drag';

            this.emit('mouse', { kind, x, y });
          }

          // (2) 全局提取并广播传统 X10 鼠标事件
          X10_MOUSE_REGEX.lastIndex = 0;
          while ((match = X10_MOUSE_REGEX.exec(this.buffer)) !== null) {
            const payload = match[1];
            if (payload === undefined) continue;
            const b = payload.charCodeAt(0) - 32;
            const x = payload.charCodeAt(1) - 32;
            const y = payload.charCodeAt(2) - 32;
            let kind: MouseEventKind = 'other';
            if (b === 64) kind = 'wheel-up';
            else if (b === 65) kind = 'wheel-down';
            else if (b === 0) kind = 'down';
            else if (b === 32) kind = 'drag';
            else if (b === 3) kind = 'up';

            this.emit('mouse', { kind, x, y });
          }

          // (3) 从 buffer 中彻底剔除所有完整鼠标 ANSI 序列
          this.buffer = this.buffer
            .replace(SGR_MOUSE_REGEX, '')
            .replace(/\[<\d+;\d+;\d+[Mm]/g, '') // 容错：已丢失 \x1b 前缀的裸残片
            .replace(X10_MOUSE_REGEX, '');

          // 如果 buffer 还有不完整的鼠标头（如 ESC[< 或 [<），暂存等待后续 chunk 拼合
          // eslint-disable-next-line no-control-regex -- 鼠标协议不完整帧头检测，ESC 必需
          if (/\x1b\[<?\d*;?\d*;?\d*$/.test(this.buffer) || /\[<\d*;?\d*;?\d*$/.test(this.buffer)) {
            if (this.flushTimer) clearTimeout(this.flushTimer);
            this.flushTimer = setTimeout(() => {
              if (this.buffer && !this.buffer.startsWith('\x1b[<') && !this.buffer.startsWith('[<')) {
                const out = this.buffer;
                this.buffer = '';
                originalEmit('data', out);
              } else {
                this.buffer = '';
              }
            }, 30);
            return true;
          }

          const cleanStr = this.buffer;
          this.buffer = '';

          // 如果剔除后为空，则完全消化该数据帧，不向下游 Ink / useInput 泄漏任何字符
          if (!cleanStr) {
            return true;
          }

          // 若混有普通键盘输入，仅透传纯净的键盘内容
          const remainingChunk = chunk instanceof Buffer ? Buffer.from(cleanStr, 'utf8') : cleanStr;
          return originalEmit(event, remainingChunk, ...args.slice(1));
        }
      }

      return originalEmit(event, ...args);
    };
  }

  /**
   * 卸载拦截，恢复 stdin 原始行为
   */
  public detach(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.buffer = '';
    if (!this.isAttached || !this.boundStdin || !this.originalEmit) return;
    this.boundStdin.emit = this.originalEmit;
    this.isAttached = false;
    this.boundStdin = undefined;
    this.originalEmit = undefined;
  }
}

/** 全局单例输入管道 */
export const inputPipeline = new InputPipeline();
