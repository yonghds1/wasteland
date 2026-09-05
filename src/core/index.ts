/**
 * core/index.ts - 核心模块导出
 *
 * 导出所有核心业务逻辑，供 CLI 和 TUI 使用。
 */

// 运行时初始化
export { initializeRuntime, type RuntimeEnvironment, type InitializeRuntimeParams } from './shared/initialize-runtime.js';

// 命令管理
export { CommandManager, createCommandManager, getCommandManager, setCommandManager, resetCommandManager, type CommandDefinition, type CommandExecutionContext, type CommandResult } from './shared/command-manager.js';
export { builtinCommands } from './shared/command-definitions.js';
export { executeCommand, isLocalCommand, type ExtendedCommandResult, type ActionResult, type OutputResult, type ErrorResult } from './shared/command-executor.js';
export { executeCommandSync, isLocalCommandSync, isExitCommandSync, type SyncCommandResult, type SyncActionResult, type SyncOutputResult, type SyncErrorResult } from './shared/command-executor-sync.js';

// 适配器接口
export type { InputAdapter } from './input-adapter.js';
export { DefaultOutputAdapter, type OutputAdapter, type DisplayEvent } from './output-adapter.js';
