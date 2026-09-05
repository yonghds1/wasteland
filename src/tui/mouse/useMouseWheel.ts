/**
 * useMouseWheel.ts - React Hook for terminal mouse wheel events
 *
 * 自动向终端注册/注销 SGR 鼠标跟踪协议，并分发滚轮向上/向下滚动回调。
 */

import { useEffect } from 'react';
import { useStdin } from 'ink';
import {
  type MouseEvent,
} from './mouse-protocol.js';
import { inputPipeline } from '../input/input-pipeline.js';

export interface UseMouseWheelOptions {
  /** 是否启用鼠标监听（默认 true） */
  enabled?: boolean;
  /** 滚轮向上滚动回调 */
  onWheelUp?: () => void;
  /** 滚轮向下滚动回调 */
  onWheelDown?: () => void;
  /** 鼠标按下回调 */
  onMouseDown?: (x: number, y: number) => void;
  /** 鼠标拖拽回调 */
  onMouseDrag?: (x: number, y: number) => void;
  /** 鼠标释放回调 */
  onMouseUp?: (x: number, y: number) => void;
}

export function useMouseWheel({
  enabled = true,
  onWheelUp,
  onWheelDown,
  onMouseDown,
  onMouseDrag,
  onMouseUp,
}: UseMouseWheelOptions): void {
  const { stdin } = useStdin();

  useEffect(() => {
    if (!enabled || !stdin) return;

    // 1. 挂载底层拦截管道
    inputPipeline.attach(stdin);

    // 2. 监听强类型鼠标事件
    const handleMouse = (event: MouseEvent) => {
      const x = event.x ?? 0;
      const y = event.y ?? 0;

      if (event.kind === 'wheel-up') {
        onWheelUp?.();
      } else if (event.kind === 'wheel-down') {
        onWheelDown?.();
      } else if (event.kind === 'down') {
        onMouseDown?.(x, y);
      } else if (event.kind === 'drag') {
        onMouseDrag?.(x, y);
      } else if (event.kind === 'up') {
        onMouseUp?.(x, y);
      }
    };

    inputPipeline.on('mouse', handleMouse);

    // 3. 卸载或退出时，移除监听
    return () => {
      inputPipeline.off('mouse', handleMouse);
    };
  }, [enabled, stdin, onWheelUp, onWheelDown, onMouseDown, onMouseDrag, onMouseUp]);
}
