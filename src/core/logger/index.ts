/**
 * index.ts - 日志子系统 barrel 导出
 *
 * 单一入口，避免调用方散落导入。后续 PR（FileSink / redact / TUI 集成）会
 * 继续在这里追加导出。
 */

export type {
  LogEntry,
  LogEntryInput,
  LogEntryParsed,
  LogError,
  LogErrorInput,
  LogLevel,
  LogScope,
  LogTimings,
  LogUsage,
} from './types.js';

export { LOG_LEVEL_RANK, logEntrySchema } from './types.js';

export { LogBus } from './log-bus.js';
export type { SubscribeOptions } from './log-bus.js';

export { Logger } from './logger.js';

export { ChildLogger } from './child-logger.js';
export type { ChildLoggerContext } from './child-logger.js';

export { createLogEvents, logError } from './log-events.js';
export type {
  LogEvents,
  ToolEvents,
  SkillEvents,
  PermissionEvents,
  ProviderEvents,
} from './log-events.js';

export { MemorySink } from './memory-sink.js';
export type { LogSink } from './memory-sink.js';
