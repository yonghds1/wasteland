/**
 * input-adapter.ts - 输入适配器接口
 *
 * 定义 InputAdapter 接口，用于抽象 CLI 和 TUI 的输入差异。
 * CLI 使用 readline，TUI 使用 React Subject，但都输出相同的 ChatInputTurn 格式。
 */

import type { Observable } from 'rxjs';
import type { ChatInputTurn } from '../runtime/event-types.js';

/**
 * 输入适配器接口
 *
 * 抽象用户输入的来源，统一为 ChatInputTurn Observable。
 * CLI 和 TUI 各自实现此接口，但输出格式相同。
 */
export interface InputAdapter {
  /**
   * 用户输入流
   * 每次用户提交输入时，发出一个 ChatInputTurn
   */
  readonly input$: Observable<ChatInputTurn>;

  /**
   * 销毁适配器，清理资源
   */
  destroy(): void;
}
