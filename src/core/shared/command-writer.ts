/**
 * command-writer.ts - 命令结果写入器抽象
 *
 * 从 `ui/cli-command-writer.ts` 上浮：`core/shared/intercept-commands.ts`
 * 依赖该接口做命令拦截，接口住 UI 层即构成 core→UI 反向依赖。
 * 实现（CliCommandWriter）仍在 UI 层，调用方注入。
 */

import type { SyncCommandResult } from './command-executor-sync.js';

/**
 * 命令结果写入器。
 *
 * 调用方只需 write(result)，不需要 if-else 分支。
 */
export interface CommandWriter {
  /** 写一条命令结果到输出 */
  write(result: SyncCommandResult): void;
}
