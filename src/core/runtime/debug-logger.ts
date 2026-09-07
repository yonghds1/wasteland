/**
 * debug-logger.ts - FileSink 启动装配入口
 *
 * 提供从 env 变量装配 FileSink 的启动函数：
 * - `initializeFileSinkFromEnv()`: 在 cli 启动路径调用，幂等
 * - `enableDebugLog()`: 切换到 debug level
 *
 * 设计：
 * - 与 Logger 解耦：只负责 sink 装配；日志写入走 Logger 门面
 * - env 解析：WASTELAND_LOG_DIR / WASTELAND_LOG_LEVEL / WASTELAND_LOG_REDACT /
 *   WASTELAND_LOG_TAIL_LINES / WASTELAND_DEBUG
 */


import { getLoadedSettings } from '@config/loaded-settings.js';
import { resolveDefaultLogDir } from '@config/paths.js';

import { Logger } from '@core/logger/index.js';
import type { LogLevel } from '@core/logger/index.js';
import { LogBus } from '@core/logger/index.js';
import { FileSink } from '@core/logger/file-sink.js';
import type { LogSink } from '@core/logger/memory-sink.js';
import { defaultRedactionRules } from '@core/logger/redactor.js';

// ============================================================
// 内部状态
// ============================================================

/** FileSink 是否已注入（避免重复装配） */
let fileSinkInstalled = false;

/** 当前 LogBus 单例（setBus 后赋值） */
let activeBus: LogBus | null = null;

// ============================================================
// 公开 API
// ============================================================

/**
 * 启用 debug 日志写入。
 *
 * 行为：把 Logger level 设为 'debug'；若 FileSink 尚未注入，按 env 自动装配。
 *
 * 通常由 CLI 启动路径调用（chat / resume / tui）。
 */
export function enableDebugLog(): void {
  ensureFileSink();
  // 显式覆盖 ensureFileSink 内的 env-based level
  Logger.setLevel('debug');
}

/**
 * 从 WASTELAND_LOG_* env 启动 logger bus + FileSink。
 *
 * 推荐在 cli.ts / chat.ts 启动路径开头调用一次。
 * 该函数幂等：已装配则直接返回。
 */
export function initializeFileSinkFromEnv(params?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): void {
  const env = params?.env ?? process.env;
  const level = parseLevel(env.WASTELAND_LOG_LEVEL, env.WASTELAND_DEBUG);

  // 1) 装配 FileSink（写盘 + redaction）
  ensureFileSink(params);

  // 2) Logger.setEnv 记录当前生效 env
  const envCwd = params?.cwd ?? process.cwd();
  Logger.setEnv({
    level,
    redact: parseBoolean(env.WASTELAND_LOG_REDACT, true),
    dir: resolveLogDir(envCwd, env),
    tailLines: parseInt(env.WASTELAND_LOG_TAIL_LINES, 50),
  });
}

// ============================================================
// 启动装配
// ============================================================

/**
 * 装配默认 FileSink（按 env 解析路径 / 轮转策略）。
 *
 * 通常由 `initializeFileSinkFromEnv()` 在 cli.ts / chat.ts 启动路径调用。
 * 重复调用安全：仅在未注入过时创建新 sink。
 */
export function ensureFileSink(options?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): void {
  if (fileSinkInstalled) return;
  const cwd = options?.cwd ?? process.cwd();
  const env = options?.env ?? process.env;

  const dir = resolveLogDir(cwd, env);

  // Logger 内部 redact 开关（FileSink 的规则由其构造参数决定）
  const redact = parseBoolean(env.WASTELAND_LOG_REDACT, true);
  const level = parseLevel(env.WASTELAND_LOG_LEVEL, env.WASTELAND_DEBUG);
  const tailLines = parseInt(env.WASTELAND_LOG_TAIL_LINES, 50);

  // 始终使用默认 redaction 规则；FileSink 在构造时拿这组规则去 redactObject
  // （详见 file-sink.ts:write 与 redactor.ts:ADR-4）
  const rules = defaultRedactionRules();

  const sink = new FileSink({
    dir,
    policy: {
      maxSizeBytes: 10 * 1024 * 1024,
      maxFiles: 5,
      maxAgeDays: 7,
      // 目录级体积控制：sessions/ 总大小与文件数上限，超出由每日维护清理最旧文件
      maxTotalSizeBytes: 100 * 1024 * 1024,
      maxTotalFiles: 1000,
    },
    redactionRules: rules,
  });

  installSink(sink, level, tailLines, dir, redact);
}

// ============================================================
// 内部工具
// ============================================================

/**
 * 创建 LogBus 单例 + 注入 FileSink + 记录环境配置。
 */
function installSink(
  sink: LogSink,
  level: LogLevel,
  tailLines: number,
  dir: string,
  redact: boolean,
): void {
  if (!activeBus) {
    activeBus = new LogBus();
    Logger.setBus(activeBus);
  }
  activeBus.subscribe(sink);
  Logger.setLevel(level);
  Logger.setEnv({ level, dir, redact, tailLines });
  fileSinkInstalled = true;
}

function resolveLogDir(cwd: string, env: NodeJS.ProcessEnv): string {
  return resolveDefaultLogDir({
    cwd,
    env,
    projectConfigDir: getLoadedSettings()?.projectConfigDir ?? null,
  });
}

/**
 * 解析 level；`WASTELAND_LOG_LEVEL` 优先，`WASTELAND_DEBUG=1` 等价 debug。
 * 非法值回退 info。
 */
function parseLevel(
  levelEnv: string | undefined,
  debugEnv: string | undefined,
): LogLevel {
  if (typeof levelEnv === 'string') {
    const lower = levelEnv.trim().toLowerCase();
    if (lower === 'debug' || lower === 'info' || lower === 'warn' || lower === 'error') {
      return lower;
    }
  }
  if (typeof debugEnv === 'string' && parseBoolean(debugEnv, false)) {
    return 'debug';
  }
  return 'info';
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (typeof value !== 'string') return fallback;
  const lower = value.trim().toLowerCase();
  if (lower === '1' || lower === 'true' || lower === 'yes' || lower === 'on') return true;
  if (lower === '0' || lower === 'false' || lower === 'no' || lower === 'off') return false;
  return fallback;
}

function parseInt(value: string | undefined, fallback: number): number {
  if (typeof value !== 'string') return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return n;
}

/**
 * 内部辅助：导出以便测试断言。
 * @internal
 */
export function _resetForTest(): void {
  fileSinkInstalled = false;
  activeBus = null;
  Logger.reset();
}