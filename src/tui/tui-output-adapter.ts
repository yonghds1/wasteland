/**
 * tui-output-adapter.ts - TUI 输出适配器
 *
 * 封装 React 状态更新逻辑，实现 OutputAdapter 接口。
 * 处理 RuntimeEvent 并更新 TUI 状态。
 */

import type { Observable } from 'rxjs';

import type { RuntimeEvent } from '@core/runtime/event-types.js';
import type { OutputAdapter, DisplayEvent } from '@core/adapters/output-adapter.js';

// ============================================================
// Types
// ============================================================

/**
 * TuiOutputAdapter 参数
 */
export type TuiOutputAdapterParams = {
  /** 事件回调，用于更新 TUI 状态 */
  onEvent: (event: DisplayEvent) => void;
  /** 错误回调 */
  onError?: (error: Error) => void;
};

// ============================================================
// TuiOutputAdapter
// ============================================================

/**
 * TUI 输出适配器
 *
 * 封装 React 状态更新逻辑，实现 OutputAdapter 接口。
 * 处理 RuntimeEvent 并更新 TUI 状态。
 */
export class TuiOutputAdapter implements OutputAdapter {
  private onEvent: (event: DisplayEvent) => void;
  private onError?: (error: Error) => void;

  constructor(params: TuiOutputAdapterParams) {
    this.onEvent = params.onEvent;
    this.onError = params.onError;
  }

  /**
   * 处理运行时事件，返回显示事件
   *
   * 这是 OutputAdapter 接口的方法，用于事件转换。
   */
  processEvent(event: RuntimeEvent): DisplayEvent {
    // 简单的 1:1 映射
    return event as unknown as DisplayEvent;
  }

  /**
   * 处理事件流并更新 TUI 状态
   *
   * 这是 TUI 特有的方法，用于订阅事件流并更新状态。
   *
   * @param events$ - 运行时事件流
   * @returns Promise，在流完成时 resolve
   */
  async handleEvents(events$: Observable<RuntimeEvent>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const subscription = events$.subscribe({
        next: (event) => {
          const displayEvent = this.processEvent(event);
          this.onEvent(displayEvent);
        },
        error: (error) => {
          if (this.onError) {
            this.onError(error);
          }
          reject(error);
        },
        complete: () => {
          resolve();
        },
      });

      // 清理函数（可选）
      return () => {
        subscription.unsubscribe();
      };
    });
  }
}
