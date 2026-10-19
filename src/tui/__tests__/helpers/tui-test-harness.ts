import type React from 'react';
import { Readable, Writable } from 'node:stream';
import { render, type Instance } from 'ink';
import { InputPipeline } from '../../input/input-pipeline.js';

/**
 * ANSI 转义码匹配正则（覆盖光标移动、颜色、SGR 与 OSC 序列）
 */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[@-Z\\-_]/g;

/**
 * 剥离文本中的 ANSI 转义序列，获得虚拟屏幕纯文本
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

/**
 * 按键定义输入类型
 */
export interface KeyInput {
  name?: string;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
}

/**
 * 虚拟标准输入流，支持 Raw 模式与标准按键及扩展终端序列注入
 */
export class VirtualStdin extends Readable {
  isTTY = true;
  private pipeline: InputPipeline;

  constructor() {
    super();
    this.pipeline = new InputPipeline();
    this.pipeline.attach(this as unknown as NodeJS.ReadStream);
  }

  setRawMode(_mode: boolean): this {
    return this;
  }

  _read(): void {}

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  setEncoding(_encoding: BufferEncoding): this {
    return this;
  }

  /**
   * 写入按键序列或字符
   */
  writeKey(key: string | KeyInput): void {
    if (typeof key === 'string') {
      const lower = key.toLowerCase();
      switch (lower) {
        case 'return':
        case 'enter':
          this.push('\r');
          break;
        case 'backspace':
          this.push('\x7f');
          break;
        case 'tab':
          this.push('\t');
          break;
        case 'escape':
        case 'esc':
          this.push('\x1b');
          break;
        case 'ctrl+z':
          this.push('\x1a');
          break;
        case 'ctrl+y':
          this.push('\x19');
          break;
        case 'ctrl+c':
          this.push('\x03');
          break;
        case 'shift+return':
        case 'shift+enter':
          this.push('\x1b[13;2u');
          break;
        case 'up':
          this.push('\x1b[A');
          break;
        case 'down':
          this.push('\x1b[B');
          break;
        case 'right':
          this.push('\x1b[C');
          break;
        case 'left':
          this.push('\x1b[D');
          break;
        default:
          this.push(key);
          break;
      }
      return;
    }

    const name = key.name?.toLowerCase();
    if ((name === 'return' || name === 'enter') && (key.shift || key.meta)) {
      this.push('\x1b[13;2u');
    } else if (key.ctrl && name === 'z') {
      this.push('\x1a');
    } else if (key.ctrl && name === 'y') {
      this.push('\x19');
    } else if (key.ctrl && name === 'c') {
      this.push('\x03');
    } else if (name === 'return' || name === 'enter') {
      this.push('\r');
    } else if (name === 'backspace') {
      this.push('\x7f');
    } else if (name === 'tab') {
      this.push(key.shift ? '\x1b[Z' : '\t');
    } else if (name === 'escape') {
      this.push('\x1b');
    } else if (name === 'up') {
      this.push('\x1b[A');
    } else if (name === 'down') {
      this.push('\x1b[B');
    } else if (name === 'right') {
      this.push('\x1b[C');
    } else if (name === 'left') {
      this.push('\x1b[D');
    } else if (key.name) {
      this.push(key.name);
    }
  }
}

/**
 * 虚拟标准输出流，维护尺寸与最新渲染帧缓存
 */
export class VirtualStdout extends Writable {
  isTTY = true;
  columns: number;
  rows: number;
  output = '';
  lastFrame = '';
  private currentFrame = '';

  constructor(options?: { columns?: number; rows?: number }) {
    super();
    this.columns = options?.columns ?? 120;
    this.rows = options?.rows ?? 30;
  }

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void): void {
    const text = chunk.toString();
    this.output += text;

    if (text.includes('\x1b[?2026h')) {
      const parts = text.split('\x1b[?2026h');
      this.currentFrame = parts[parts.length - 1] ?? '';
    } else {
      this.currentFrame += text;
    }

    if (this.currentFrame.includes('\x1b[?2026l')) {
      const frameContent = this.currentFrame.slice(
        0,
        this.currentFrame.lastIndexOf('\x1b[?2026l')
      );
      this.lastFrame = frameContent;
      this.currentFrame = this.currentFrame.slice(
        this.currentFrame.lastIndexOf('\x1b[?2026l') + 6
      );
    } else if (!this.output.includes('\x1b[?2026h')) {
      this.lastFrame = this.output;
    }

    callback();
  }

  clear(): void {
    this.output = '';
    this.lastFrame = '';
    this.currentFrame = '';
  }
}

export interface TuiTestHarness {
  stdin: VirtualStdin;
  stdout: VirtualStdout;
  instance: Instance;
  pressKey: (key: string | KeyInput) => Promise<void>;
  typeText: (text: string) => Promise<void>;
  lastFrame: () => string;
  waitForFrame: (matcher: string | RegExp, timeoutMs?: number) => Promise<string>;
  unmount: () => void;
  rerender: (element: React.ReactElement) => void;
}

/**
 * 创建 TUI 虚拟测试驾驶舱
 */
export function createTuiTestHarness<T extends React.ReactElement>(
  element: T,
  options?: { columns?: number; rows?: number }
): TuiTestHarness {
  const stdin = new VirtualStdin();
  const stdout = new VirtualStdout(options);

  const instance = render(element, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  const getRawFrame = (): string => {
    return stdout.lastFrame || stdout.output;
  };

  const getLastFrame = (): string => {
    return stripAnsi(getRawFrame());
  };

  const pressKey = async (key: string | KeyInput): Promise<void> => {
    stdin.writeKey(key);
    await new Promise((r) => setTimeout(r, 40));
  };

  const typeText = async (text: string): Promise<void> => {
    for (const char of text) {
      stdin.writeKey(char);
      await new Promise((r) => setTimeout(r, 20));
    }
    await new Promise((r) => setTimeout(r, 40));
  };

  const waitForFrame = async (
    matcher: string | RegExp,
    timeoutMs = 2000
  ): Promise<string> => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const frame = getLastFrame();
      const matched = typeof matcher === 'string'
        ? frame.includes(matcher)
        : matcher.test(frame);
      if (matched) {
        return frame;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    const finalFrame = getLastFrame();
    throw new Error(
      `Timed out waiting for frame matching ${matcher} after ${timeoutMs}ms.\nLast frame captured:\n${finalFrame}`
    );
  };

  return {
    stdin,
    stdout,
    instance,
    pressKey,
    typeText,
    lastFrame: getLastFrame,
    waitForFrame,
    unmount: () => {
      instance.unmount();
    },
    rerender: (el: React.ReactElement) => {
      instance.rerender(el);
    },
  };
}
