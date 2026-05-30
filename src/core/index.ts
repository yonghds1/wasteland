/**
 * core/index.ts - 核心模块导出
 *
 * 导出所有核心业务逻辑，供 CLI 和 TUI 使用。
 */

// 运行时初始化
export { initializeRuntime, type RuntimeEnvironment, type InitializeRuntimeParams } from './shared/initialize-runtime.js';

// 本地命令处理
export { executeLocalCommand, isLocalCommand, isExitCommand, type LocalCommandResult, type ExecuteLocalCommandParams } from './shared/local-commands.js';

// 适配器接口
export type { InputAdapter } from './adapters/input-adapter.js';
export { DefaultOutputAdapter, type OutputAdapter, type DisplayEvent } from './adapters/output-adapter.js';
