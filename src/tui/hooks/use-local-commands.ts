/**
 * use-local-commands.ts - TUI 本地命令处理 Hook
 *
 * 使用共享的 executeLocalCommand() 函数处理 TUI 中的本地命令。
 */

import { useCallback } from 'react';
import { executeLocalCommand } from '@core/shared/local-commands.js';
import type { SkillExecutor } from '@core/skills/skill-executor.js';

/**
 * useLocalCommands 参数
 */
type UseLocalCommandsParams = {
  /** 技能执行器（可选） */
  skillExecutor?: SkillExecutor;
  /** 命令输出回调 */
  onOutput?: (output: string) => void;
  /** 退出回调 */
  onExit?: () => void;
  /** 清屏回调 */
  onClear?: () => void;
};

/**
 * useLocalCommands 返回值
 */
type UseLocalCommandsReturn = {
  /**
   * 执行本地命令
   *
   * @param command - 用户输入的命令
   * @returns 是否处理了该命令
   */
  executeCommand: (command: string) => boolean;
};

/**
 * TUI 本地命令处理 Hook
 *
 * 使用共享的 executeLocalCommand() 函数处理 TUI 中的本地命令。
 *
 * @param params - 参数
 * @returns executeCommand 函数
 */
export function useLocalCommands(params: UseLocalCommandsParams): UseLocalCommandsReturn {
  const { skillExecutor, onOutput, onExit, onClear } = params;

  const executeCommand = useCallback(
    (command: string): boolean => {
      const result = executeLocalCommand({
        command,
        skillExecutor,
      });

      if (!result.handled) {
        return false;
      }

      // 处理输出
      if (result.output && onOutput) {
        onOutput(result.output);
      }

      // 处理退出
      if (result.action === 'exit' && onExit) {
        onExit();
      }

      // 处理清屏
      if (result.action === 'clear' && onClear) {
        onClear();
      }

      return true;
    },
    [skillExecutor, onOutput, onExit, onClear]
  );

  return { executeCommand };
}
