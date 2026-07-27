/**
 * cli-output-adapter.ts - CLI 输出适配器
 *
 * 封装 terminal-renderer 逻辑，实现 OutputAdapter 接口。
 * 处理 RuntimeEvent 并渲染到终端。
 */

import type { Writable } from 'node:stream';
import type { Observable } from 'rxjs';

import type { RuntimeEvent } from '@core/runtime/event-types.js';
import type { OutputAdapter, DisplayEvent } from '@core/adapters/output-adapter.js';
import { renderRuntimeEvents } from './terminal-renderer.js';

// ============================================================
// Types
// ============================================================

/**
 * CliOutputAdapter 参数
 */
export type CliOutputAdapterParams = {
  /** 输出流（默认 process.stdout） */
  stdout?: Writable;
  /** 错误输出流（默认 process.stderr） */
  stderr?: Writable;
  /** 显示样式 */
  style?: 'classic' | 'interactive';
  /** 轮次完成回调 */
  onTurnComplete?: () => void;
  /** 是否展示思考块，默认 true */
  showThinking?: boolean;
};

// ============================================================
// CliOutputAdapter
// ============================================================

/**
 * CLI 输出适配器
 *
 * 封装 terminal-renderer 逻辑，实现 OutputAdapter 接口。
 * 处理 RuntimeEvent 并渲染到终端。
 */
export class CliOutputAdapter implements OutputAdapter {
  private stdout: Writable;
  private stderr: Writable;
  private style: 'classic' | 'interactive';
  private onTurnComplete?: () => void;
  private showThinking: boolean;

  constructor(params?: CliOutputAdapterParams) {
    this.stdout = params?.stdout ?? process.stdout;
    this.stderr = params?.stderr ?? process.stderr;
    this.style = params?.style ?? 'classic';
    this.onTurnComplete = params?.onTurnComplete;
    this.showThinking = params?.showThinking ?? true;
  }

  /**
   * 处理运行时事件，返回显示事件
   *
   * 这是 OutputAdapter 接口的方法，用于事件转换。
   * 实际的渲染由 handleEvents 方法完成。
   */
  processEvent(event: RuntimeEvent): DisplayEvent {
    // 简单的 1:1 映射
    return event as unknown as DisplayEvent;
  }

  /**
   * 处理事件流并渲染到终端
   *
   * 这是 CLI 特有的方法，用于订阅事件流并渲染。
   *
   * @param events$ - 运行时事件流
   * @returns Promise，在流完成时 resolve
   */
  async handleEvents(events$: Observable<RuntimeEvent>): Promise<void> {
    return renderRuntimeEvents(events$, {
      stdout: this.stdout,
      stderr: this.stderr,
      style: this.style,
      onTurnComplete: this.onTurnComplete,
      showThinking: this.showThinking,
    });
  }

  /**
   * 更新轮次完成回调
   *
   * @param callback - 新的回调函数
   */
  setOnTurnComplete(callback: () => void): void {
    this.onTurnComplete = callback;
  }

  /**
   * 更新显示样式
   *
   * @param style - 新的显示样式
   */
  setStyle(style: 'classic' | 'interactive'): void {
    this.style = style;
  }
}
